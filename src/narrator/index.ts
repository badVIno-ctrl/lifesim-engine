// Свой движок повествования: рассказчик без нейросети и без ключей.
// Изоморфно: ни fs, ни path, ни process.
//
// Зачем он есть. Игра, которая требует чужой API-ключ, начинается с барьера:
// человек приходит играть, а попадает в форму для токена. Здесь рассказчик —
// это код: он видит всё состояние, поэтому не выдумывает чисел, всегда двигает
// время и всегда отрабатывает требования движка. Он не пишет как писатель,
// зато не врёт и не стоит денег.
//
// Устройство: разбор реплики (intent) → модель исхода (resolve) → план хода
// (plan: дельта плюс биты) → сборка прозы (narrate). Случайность детерминирована
// зерном из состояния, поэтому эталонный прогон воспроизводим.
import type { Delta, Directive, EngineFact, State } from "../types.ts"
import { EMPTY_MEMORY, planTurn, readMemory } from "./plan.ts"
import type { NarratorMemory } from "./plan.ts"
import { renderProse } from "./narrate.ts"
import { DEAD_LINE } from "./phrases.ts"
import { flavorFor } from "./flavor.ts"
import { INTENTS } from "./intent.ts"
import type { IntentSpec } from "./intent.ts"
import { Rng, hash32 } from "./rng.ts"

export type NarratorInput = {
	state: State
	input: string
	directives: Directive[]
	facts: EngineFact[]
	memory?: NarratorMemory | null
}

export type NarratorOutput = {
	prose: string
	delta: Delta
	memory: NarratorMemory
	/** Почему получилось именно так: показывается в режиме отладки. */
	trace: string
}

export type Narrator = (input: NarratorInput) => NarratorOutput

export const EPILOGUE_COMMAND = "((эпилог))"

/** Собирает рассказчика. Функция чистая: одно и то же на входе — одно и то же на выходе. */
export function createLocalNarrator(): Narrator {
	return function narrate(input: NarratorInput): NarratorOutput {
		const memory = readMemory(input.memory ?? EMPTY_MEMORY)
		const state = input.state

		if (state.dead) {
			return { prose: DEAD_LINE, delta: {}, memory, trace: "персонаж мёртв: ход не выполняется" }
		}

		if (input.input.trim() === EPILOGUE_COMMAND) {
			return epilogue(state, memory)
		}

		const plan = planTurn({
			state,
			input: input.input,
			directives: input.directives,
			facts: input.facts,
			memory,
		})
		return {
			prose: renderProse(plan.beats),
			delta: plan.delta,
			memory: plan.memory,
			trace: plan.trace,
		}
	}
}

/** Закрывающая сцена: без морали и без новых загадок, как и требует CORE. */
function epilogue(state: State, memory: NarratorMemory): NarratorOutput {
	const rng = new Rng(hash32(`эпилог|${state.clock.turn}|${state.meta.character}`))
	const flavor = flavorFor(state.meta.setting, state.meta.specialRule)
	const open = state.obligations.length
		? "За тобой остаётся то, что осталось: долги не исчезают от того, что история кончилась."
		: "За тобой не висит ничего, и это редкость."
	const people = state.npcs.length
		? `${state.npcs[0].name} остаётся здесь и будет вспоминать тебя по-своему.`
		: "Никто не выйдет проводить, и это тоже итог."
	const place = `${state.scene.location} остаётся таким же, каким было до тебя.`
	const last = rng.pick([
		"Ты уходишь, и мир не делает паузы.",
		"Дальше идёт обычный день, и он идёт без тебя.",
		`${rng.pick(flavor.people)} занимает твоё место у стены прежде, чем ты сворачиваешь за угол.`,
	])
	return {
		prose: [place, open, people, last].join(" "),
		delta: { time: { minutes: 30 }, channel: "зрение", note: "эпилог" },
		memory,
		trace: "эпилог: состояние закрывается, новых крючков не сеется",
	}
}

/**
 * Действия, которые имеют смысл в этой сцене прямо сейчас, готовыми фразами.
 * Из этого 2D-режим собирает колоду: человек играет, ничего не печатая.
 */
export type SuggestedAction = {
	id: string
	label: string
	/** Что уйдёт в ход как реплика игрока. */
	text: string
	/** Почему это предложено: подсказка в интерфейсе. */
	hint: string
	tone: "мир" | "люди" | "тело" | "деньги" | "риск"
}

const intentById = (id: string): IntentSpec => INTENTS.find((i) => i.id === id) as IntentSpec

export function suggestActions(state: State, limit = 8): SuggestedAction[] {
	const flavor = flavorFor(state.meta.setting, state.meta.specialRule)
	const out: SuggestedAction[] = []
	const push = (a: SuggestedAction): void => {
		if (out.some((x) => x.id === a.id)) return
		out.push(a)
	}

	// Люди рядом важнее всего остального: с ними и происходит игра.
	const near = state.npcs.filter((n) => state.scene.participants.some((p) => p.includes(n.name)))
	const people = (near.length ? near : state.npcs).slice(0, 2)
	for (const n of people) {
		push({
			id: `talk:${n.name}`,
			label: `Поговорить: ${n.name}`,
			text: `поговорить с ${n.name}`,
			hint: n.promises.length ? `вы обещали: ${n.promises[0]}` : "разговор ничего не стоит, кроме времени",
			tone: "люди",
		})
		push({
			id: `ask:${n.name}`,
			label: `Расспросить: ${n.name}`,
			text: `спросить ${n.name} о том, что здесь происходит`,
			hint: "вопросы дают зацепки, а не ответы",
			tone: "люди",
		})
	}

	const debt = [...state.obligations].sort((a, b) => (a.dueDay ?? 999) - (b.dueDay ?? 999))[0]
	if (debt) {
		push({
			id: "pay",
			label: "Заплатить по долгу",
			text: `заплатить по долгу: ${debt.what}`,
			hint:
				typeof debt.dueDay === "number" && debt.dueDay < state.clock.day
					? "срок уже прошёл, и мир это помнит"
					: "закрыть раньше дешевле, чем позже",
			tone: "деньги",
		})
	}

	push({
		id: "work",
		label: "Взяться за работу",
		text: "взяться за работу, какая найдётся",
		hint: "время в обмен на деньги",
		tone: "деньги",
	})

	push({
		id: "look",
		label: "Осмотреться",
		text: "осмотреться внимательно",
		hint: "самое дешёвое действие в игре",
		tone: "мир",
	})

	if (state.unknowns.length) {
		push({
			id: "dig",
			label: "Разузнать",
			text: `поискать ответ: ${state.unknowns[0]}`,
			hint: state.unknowns[0],
			tone: "мир",
		})
	}

	const c = state.condition
	if (c.hunger >= 1) {
		push({ id: "eat", label: "Поесть", text: "поесть", hint: "голод мешает всему", tone: "тело" })
	}
	if (c.thirst >= 1) {
		push({ id: "drink", label: "Напиться", text: "напиться воды", hint: "сухость в горле", tone: "тело" })
	}
	if (c.wounds.length || c.bleed > 0) {
		push({
			id: "heal",
			label: "Заняться раной",
			text: "перевязать рану",
			hint: c.bleed > 0 ? "кровь сама не остановится" : "рана мешает работать",
			tone: "тело",
		})
	}
	if (c.fatigue >= 2 || c.stress.level >= 2) {
		push({ id: "rest", label: "Отдохнуть", text: "отдохнуть до утра", hint: "мир за это время сдвинется", tone: "тело" })
	}

	const rng = new Rng(hash32(`действия|${state.clock.turn}|${state.scene.location}`))
	const place = rng.pick(flavor.places.filter((p) => p !== state.scene.location))
	push({
		id: "go",
		label: `Пойти: ${place}`,
		text: `пойти в ${place}`,
		hint: "дорога стоит времени и сил",
		tone: "мир",
	})

	const front = state.fronts.find((f) => f.progress >= 3) ?? state.fronts[0]
	if (front) {
		push({
			id: "front",
			label: "Вмешаться в то, что идёт без тебя",
			text: `разобраться с тем, что происходит: ${front.name}`,
			hint: front.nextAction,
			tone: "риск",
		})
	}

	void intentById
	return out.slice(0, limit)
}
