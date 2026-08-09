// Что именно случилось за ход: дельта для движка и биты для прозы.
// Изоморфно: ни fs, ни path, ни process.
//
// Правило дома: своя дельта не имеет права быть отклонённой движком.
// У рассказчика-модели отклонение — законное событие мира, потому что модель
// не видит арифметики. Свой движок видит всё состояние, поэтому если денег нет,
// он не «пробует списать», а рассказывает отказ. Это проверяется эталонным прогоном:
// после сотен ходов в фактах не должно быть ни одного rejection.
import { LADDERS } from "../ladders.ts"
import { pressureProfile, tuningOf } from "../tuning.ts"
import type { Channel, Delta, Directive, EngineFact, State } from "../types.ts"
import { flavorFor, sensoryBank, TIME_LINES } from "./flavor.ts"
import type { Flavor } from "./flavor.ts"
import { parseInput } from "./intent.ts"
import type { ParsedInput } from "./intent.ts"
import { ATTEMPT, CLOSE, COST, NPC_REACTION, OUTCOME, WORLD, wealthWord } from "./phrases.ts"
import { OUTCOME_RANK, resolveAttempt } from "./resolve.ts"
import type { Resolution } from "./resolve.ts"
import { Rng, hash32 } from "./rng.ts"
import { phaseOf } from "../ladders.ts"

export type BeatRole = "sense" | "attempt" | "outcome" | "cost" | "npc" | "world" | "close"
export type Beat = { role: BeatRole; text: string; key: string }

/** Память рассказчика живёт в записи партии: состояние меняет только applyDelta. */
export type NarratorMemory = { recent: string[] }

export const EMPTY_MEMORY: NarratorMemory = { recent: [] }

export function readMemory(raw: unknown): NarratorMemory {
	if (!raw || typeof raw !== "object") return { recent: [] }
	const r = (raw as { recent?: unknown }).recent
	const recent = Array.isArray(r) ? r.filter((x): x is string => typeof x === "string") : []
	return { recent: recent.slice(-40) }
}

export type PlanContext = {
	state: State
	input: string
	/** Что движок требует отработать в этом ходу. Свой движок отрабатывает всё. */
	directives: Directive[]
	/** Что движок сообщил по итогам прошлого хода. */
	facts: EngineFact[]
	memory: NarratorMemory
}

export type TurnPlan = {
	delta: Delta
	beats: Beat[]
	resolution: Resolution
	parsed: ParsedInput
	memory: NarratorMemory
	/** Строка для отладочной панели: почему получилось так. */
	trace: string
}

/* ────────────────────────── экономика мира ────────────────────────── */

type Anchors = { dayFood: number; bed: number; tool: number; entries: [string, number][] }

function anchorsOf(state: State): Anchors {
	const m = state.economy.regionMultiplier || 1
	const entries = Object.entries(state.economy.anchors)
		.map(([k, v]) => [k, Math.max(1, Math.round(v * m))] as [string, number])
		.sort((a, b) => a[1] - b[1])
	const find = (...roots: string[]): number | null => {
		for (const [k, v] of entries) {
			const key = k.toLowerCase()
			if (roots.some((r) => key.includes(r))) return v
		}
		return null
	}
	const dayFood = find("еда", "хлеб", "прокорм") ?? entries[0]?.[1] ?? 1
	return {
		dayFood,
		bed: find("ночл", "постой", "комнат", "кров") ?? dayFood * 8,
		tool: find("инструм", "снаряж", "экипир") ?? dayFood * 30,
		entries,
	}
}

/* ────────────────────────── вспомогательное ────────────────────────── */

function capitalize(s: string): string {
	return s ? s[0].toUpperCase() + s.slice(1) : s
}

/** Канал восприятия: три хода подряд один и тот же движок считает нарушением. */
function pickChannel(state: State, rng: Rng): Channel {
	const last = state.channelHistory.slice(-2)
	const all: Channel[] = ["звук", "тело", "запах", "вкус", "зрение"]
	const free = all.filter((c) => c !== last[last.length - 1])
	const weights = free.map((c) => ({
		value: c,
		// Зрение — самый ленивый канал, поэтому он реже других.
		weight: c === "зрение" ? 1 : last.includes(c) ? 2 : 4,
	}))
	return rng.weighted(weights)
}

function minutesFor(state: State, parsed: ParsedInput, rng: Rng): number {
	const prof = pressureProfile(tuningOf(state))
	// Длина сцены — вкусовая настройка, но два дела живут по собственным часам:
	// работа идёт смену, а сон — до утра. Иначе «отдохнуть до утра» стоило бы двадцать минут.
	const scale = prof.sceneMinutes.base / 40
	if (parsed.spec.id === "работать") {
		return Math.round((rng.range(240, 480) * Math.max(0.6, Math.min(1.3, scale))) / 5) * 5
	}
	if (parsed.spec.id === "отдыхать") {
		const morning = 7 * 60
		const now = state.clock.minuteOfDay
		const till = now < morning ? morning - now : 1440 - now + morning
		return Math.max(240, Math.round(till / 5) * 5)
	}
	const raw = prof.sceneMinutes.base * parsed.spec.minutes * rng.range(0.75, 1.3)
	return Math.max(prof.sceneMinutes.min, Math.round(raw / 5) * 5)
}

/* ────────────────────────── планирование хода ────────────────────────── */

export function planTurn(ctx: PlanContext): TurnPlan {
	const state = ctx.state
	const tuning = tuningOf(state)
	const flavor = flavorFor(state.meta.setting, state.meta.specialRule)
	const parsed = parseInput(ctx.input, state, flavor)
	// Зерно — из состояния и реплики: тот же ход даст тот же результат.
	const rng = new Rng(
		hash32(`${state.clock.turn}|${state.clock.day}|${state.clock.minuteOfDay}|${parsed.raw}|${state.meta.character}`),
	)
	const resolution = resolveAttempt(state, parsed, tuning, rng)
	const anchors = anchorsOf(state)
	const used: string[] = []
	const beats: Beat[] = []
	const delta: Delta = {}

	const say = (role: BeatRole, bank: readonly string[], keyPrefix: string): string => {
		const idx = bank.indexOf(rng.pickFresh(bank, ctx.memory.recent, (x) => `${keyPrefix}:${bank.indexOf(x)}`))
		const text = bank[idx < 0 ? 0 : idx]
		const key = `${keyPrefix}:${idx < 0 ? 0 : idx}`
		used.push(key)
		beats.push({ role, text, key })
		return text
	}

	const channel = pickChannel(state, rng)
	delta.channel = channel
	const minutes = minutesFor(state, parsed, rng)
	delta.time = { minutes }

	// ── 1. Место и канал восприятия.
	// Название места повторять каждый ход нельзя: через три хода это уже не сцена,
	// а шапка документа. Поэтому место звучит, когда сменилось или давно не звучало.
	const placeKey = `place:${state.scene.location}`
	// Хвост памяти длиннее одного хода: за ход набегает несколько ключей.
	const placeFresh = !ctx.memory.recent.slice(-14).includes(placeKey)
	const timeLine = rng.pick(TIME_LINES[phaseOf(state.clock.minuteOfDay)] ?? TIME_LINES["день"])
	beats.push({
		role: "sense",
		text: placeFresh ? `${capitalize(state.scene.location)}. ${timeLine}` : timeLine,
		key: placeKey,
	})
	used.push(placeKey)
	say("sense", sensoryBank(flavor, channel), `sense:${flavor.id}:${channel}`)

	// ── 2. Попытка
	say("attempt", ATTEMPT[parsed.spec.id] ?? ATTEMPT["своё"], `attempt:${parsed.spec.id}`)
	if (parsed.spec.id === "своё" && parsed.raw.length <= 90 && parsed.raw.length > 2) {
		// Единственное место, где реплика игрока звучит его же словами:
		// когда движок честно не понял намерения, притворяться хуже, чем повторить.
		beats.push({ role: "attempt", text: `То, что ты решил, звучит так: «${parsed.raw}».`, key: "echo" })
	}

	// ── 3. Исход и цена
	// Общая фраза исхода нужна там, где итог — это оценка попытки. Там, где итог
	// считается по состоянию (заплатил, купил, дошёл), она врёт, и её снимают.
	const bank = OUTCOME[parsed.spec.kind] ?? OUTCOME.body
	say("outcome", bank[resolution.outcome], `outcome:${parsed.spec.kind}:${resolution.outcome}`)
	const genericOutcome = beats[beats.length - 1]

	const costs: string[] = []
	const addCost = (kind: keyof typeof COST): void => {
		if (costs.includes(kind)) return
		costs.push(kind)
		say("cost", COST[kind], `cost:${kind}`)
	}

	const concrete = { value: false }
	applyIntent({ state, parsed, resolution, delta, anchors, flavor, rng, addCost, beats, minutes, say, concrete })
	if (concrete.value) {
		const at = beats.indexOf(genericOutcome)
		if (at >= 0) beats.splice(at, 1)
	}
	applyUpkeep({ state, parsed, delta, minutes, addCost })

	// ── 4. Мир: факты движка и обязательные директивы
	applyWorld({ state, ctx, delta, flavor, rng, say, anchors })

	// ── 5. Закрытие сцены
	if (!state.dead) say("close", CLOSE, "close")

	const note = `${parsed.spec.id}/${resolution.outcome}`
	delta.note = note

	const trace = [
		`намерение: ${parsed.spec.id} (уверенность ${Math.round(parsed.confidence * 100)}%)`,
		parsed.npc ? `адресат: ${parsed.npc}` : "",
		`исход: ${resolution.outcome} (сумма ${resolution.score})`,
		resolution.drivers.join(", "),
		`время: ${minutes} мин, канал: ${channel}`,
		`достаток: ${wealthWord(state.money, anchors.dayFood)}`,
	]
		.filter(Boolean)
		.join(" · ")

	return {
		delta,
		beats,
		resolution,
		parsed,
		memory: { recent: [...ctx.memory.recent, ...used].slice(-40) },
		trace,
	}
}

/* ────────────────────────── намерения ────────────────────────── */

type IntentArgs = {
	state: State
	parsed: ParsedInput
	resolution: Resolution
	delta: Delta
	anchors: Anchors
	flavor: Flavor
	rng: Rng
	addCost: (kind: keyof typeof COST) => void
	beats: Beat[]
	minutes: number
	say: (role: BeatRole, bank: readonly string[], keyPrefix: string) => string
	/** Поднять, если исход рассказан по состоянию: общая фраза тогда лишняя. */
	concrete: { value: boolean }
}

function npcBeat(a: IntentArgs, mood: "warm" | "cold" | "neutral" | "absent"): void {
	const name = a.parsed.npc
	if (mood === "absent" || !name) {
		a.beats.push({ role: "npc", text: a.rng.pick(NPC_REACTION.absent), key: "npc:absent" })
		return
	}
	const text = a.rng.pick(NPC_REACTION[mood]).replace("{npc}", name)
	a.beats.push({ role: "npc", text, key: `npc:${mood}` })
}

function pushNpc(delta: Delta, entry: NonNullable<Delta["npc"]>[number]): void {
	delta.npc = [...(delta.npc ?? []), entry]
}

function pushUnknown(delta: Delta, question: string): void {
	const add = delta.unknowns?.add ?? []
	if (add.includes(question)) return
	delta.unknowns = { ...(delta.unknowns ?? {}), add: [...add, question] }
}

function pushHook(delta: Delta, text: string, window: number): void {
	const add = delta.hooks?.add ?? []
	delta.hooks = { ...(delta.hooks ?? {}), add: [...add, { text, window }] }
}

function pushConsequence(delta: Delta, what: string, cause: string, window: number): void {
	const add = delta.consequences?.add ?? []
	delta.consequences = { ...(delta.consequences ?? {}), add: [...add, { what, cause, window }] }
}

function applyIntent(a: IntentArgs): void {
	const rank = OUTCOME_RANK[a.resolution.outcome]
	const good = rank > 0
	const bad = rank < 0
	const id = a.parsed.spec.id
	const s = a.state

	switch (id) {
		case "говорить":
		case "убедить":
		case "помочь":
		case "соврать": {
			if (a.parsed.npc) {
				if (good) {
					pushNpc(a.delta, {
						name: a.parsed.npc,
						attitudeStep: 1,
						reason:
							id === "помочь"
								? "вы помогли, ничего не попросив взамен"
								: id === "соврать"
									? "вы сказали то, что этому человеку хотелось услышать"
									: "разговор пошёл на пользу обоим",
					})
					npcBeat(a, "warm")
				} else if (bad) {
					pushNpc(a.delta, {
						name: a.parsed.npc,
						attitudeStep: -1,
						reason: id === "соврать" ? "ложь не сошлась с тем, что человек знал" : "разговор кончился хуже, чем начался",
					})
					npcBeat(a, "cold")
					a.addCost("stress")
					a.delta.stress = { segments: 1, reason: "разговор пошёл не туда" }
				} else {
					pushNpc(a.delta, { name: a.parsed.npc, reason: "разговор был, но ничего не решил" })
					npcBeat(a, "neutral")
				}
				if (id === "соврать" && bad) a.delta.trace = "здесь запомнили, что вы говорите не то, что есть"
			} else {
				npcBeat(a, "absent")
			}
			if (good && a.rng.chance(0.4)) pushUnknown(a.delta, a.rng.pick(a.flavor.questions))
			break
		}

		case "спросить":
		case "искать":
		case "осмотреть":
		case "думать": {
			if (good) {
				// Успешный расспрос даёт зацепку, а не ответ: ответы добываются в сцене.
				if (s.unknowns.length > 5 && a.rng.chance(0.5)) {
					const oldest = s.unknowns[0]
					a.delta.unknowns = { ...(a.delta.unknowns ?? {}), resolve: [oldest] }
					a.beats.push({
						role: "outcome",
						text: `То, что мучило тебя дольше всего, объясняется проще: за этим стоит человек, а не сила. «${oldest}» — больше не вопрос.`,
						key: "resolve-unknown",
					})
				}
				pushUnknown(a.delta, a.rng.pick(a.flavor.questions))
				if (a.rng.chance(0.5)) {
					pushHook(a.delta, `${a.rng.pick(a.flavor.people)} знает больше, чем сказал`, 6)
				}
				if (a.parsed.npc) npcBeat(a, "neutral")
			} else if (bad) {
				a.delta.stress = { segments: 1, reason: "искал не там и понял это поздно" }
				a.addCost("stress")
				if (a.parsed.spec.kind === "mind" && a.rng.chance(0.4)) {
					pushConsequence(a.delta, "о твоих расспросах узнают не те люди", "ты спрашивал слишком открыто", 3)
					a.addCost("trace")
					a.delta.trace = "твои вопросы запомнили"
				}
			}
			break
		}

		case "угрожать": {
			if (a.parsed.npc) {
				pushNpc(a.delta, {
					name: a.parsed.npc,
					attitudeStep: good ? -1 : -1,
					reason: "вы перешли к угрозам",
				})
				npcBeat(a, "cold")
			}
			a.delta.stress = { segments: good ? 1 : 2, reason: "разговор на грани драки" }
			a.addCost("stress")
			a.delta.trace = "здесь видели, как вы давите на человека"
			if (bad) pushConsequence(a.delta, "тебе отвечают тем же и не поодиночке", "ты пригрозил тому, кто не один", 3)
			break
		}

		case "купить": {
			a.concrete.value = true
			const wanted = pickPurchase(a)
			if (!wanted) {
				a.beats.push({ role: "outcome", text: "Покупать нечего: здесь не торгуют тем, что тебе нужно.", key: "buy-none" })
				break
			}
			const price = Math.max(1, Math.round(wanted.price * (good ? 0.85 : bad ? 1.25 : 1)))
			if (price > a.state.money) {
				a.beats.push({
					role: "outcome",
					text: `Цену называют вслух, и она выше того, что у тебя есть. ${capitalize(wealthWord(a.state.money, a.anchors.dayFood))}.`,
					key: "buy-poor",
				})
				a.delta.stress = { segments: 1, reason: "денег не хватило на нужное" }
				break
			}
			a.delta.money = { delta: -price, reason: `покупка: ${wanted.label}` }
			a.addCost("money")
			if (wanted.kind === "еда") {
				if (a.state.condition.hunger > 0) a.delta.hunger = { step: -1 }
				a.beats.push({ role: "outcome", text: "Еда простая и горячая, и этого достаточно.", key: "buy-food" })
			} else if (wanted.kind === "ночлег") {
				a.beats.push({ role: "outcome", text: "Место для сна есть, и дверь закрывается изнутри.", key: "buy-bed" })
			} else {
				a.delta.inventory = {
					...(a.delta.inventory ?? {}),
					add: [...(a.delta.inventory?.add ?? []), { name: wanted.label, qty: 1 }],
				}
				a.beats.push({ role: "outcome", text: `Теперь при тебе — ${wanted.label}.`, key: "buy-item" })
			}
			break
		}

		case "продать": {
			a.concrete.value = true
			const item = a.parsed.item
				? a.state.inventory.find((i) => i.name === a.parsed.item)
				: [...a.state.inventory].sort((x, y) => y.wear - x.wear)[0]
			if (!item) {
				a.beats.push({ role: "outcome", text: "Продавать нечего: всё, что при тебе, нужно тебе самому.", key: "sell-none" })
				break
			}
			const base = a.anchors.dayFood * a.rng.range(2, 6) * (1 - item.wear * 0.25)
			const price = Math.max(1, Math.round(base * (good ? 1.2 : bad ? 0.6 : 1)))
			a.delta.money = { delta: price, reason: `продажа: ${item.name}` }
			a.delta.inventory = {
				...(a.delta.inventory ?? {}),
				remove: [...(a.delta.inventory?.remove ?? []), { name: item.name, qty: 1 }],
			}
			a.beats.push({
				role: "outcome",
				text: `${capitalize(item.name)} уходит из рук, и в кармане становится тяжелее.`,
				key: "sell-done",
			})
			break
		}

		case "заплатить": {
			a.concrete.value = true
			const target =
				a.state.obligations.find((o) => (a.parsed.npc ? o.what.includes(a.parsed.npc) : false)) ??
				[...a.state.obligations].sort((x, y) => (x.dueDay ?? 999) - (y.dueDay ?? 999))[0]
			if (!target) {
				a.beats.push({ role: "outcome", text: "Платить некому: за тобой сейчас ничего не висит.", key: "pay-none" })
				break
			}
			const owed = typeof target.amount === "number" ? target.amount : a.anchors.dayFood * 10
			if (a.state.money >= owed) {
				a.delta.money = { delta: -owed, reason: `закрыт долг: ${target.what}` }
				a.delta.obligations = { ...(a.delta.obligations ?? {}), settle: [target.what] }
				a.addCost("money")
				a.beats.push({
					role: "outcome",
					text: `Долг закрыт целиком, и это слышно по тому, как меняется чужой голос: «${target.what}» больше за тобой не висит.`,
					key: "pay-full",
				})
				if (a.parsed.npc) {
					// Бросок решает не «получилось ли отдать», а как это приняли.
					pushNpc(a.delta, {
						name: a.parsed.npc,
						attitudeStep: good ? 1 : 0,
						reason: good
							? "долг закрыт без напоминаний"
							: "долг закрыт, но позже, чем обещано",
					})
					npcBeat(a, good ? "warm" : "neutral")
				}
			} else if (a.state.money > 0) {
				const part = Math.max(1, Math.floor(a.state.money * 0.8))
				a.delta.money = { delta: -part, reason: `часть долга: ${target.what}` }
				a.delta.obligations = {
					add: [
						{
							what: target.what,
							amount: Math.max(1, owed - part),
							dueDay: a.state.clock.day + 2,
						},
					],
					settle: [target.what],
				}
				a.beats.push({
					role: "outcome",
					text: "Ты отдаёшь то, что есть, и слышишь новый срок. Он короче прежнего.",
					key: "pay-part",
				})
			} else {
				a.beats.push({
					role: "outcome",
					text: "Платить нечем, и это приходится сказать вслух. Тебя выслушивают молча, и молчание хуже крика.",
					key: "pay-empty",
				})
				a.delta.stress = { segments: 2, reason: "пришёл платить с пустыми руками" }
				a.addCost("stress")
			}
			break
		}

		case "работать": {
			a.concrete.value = true
			const offer = pickWork(a)
			// Плата привязана к двум якорям пака и к реально потраченному времени:
			// полный день работы должен покрывать еду и почти покрывать ночлег.
			// Так формула работает и в грошах, и в кронах, и в любом придуманном мире.
			const fullDay = a.anchors.dayFood * 3 + a.anchors.bed * 0.5
			// Умение стоит денег: это единственный способ выбраться из поденщины.
			const mastery = 1 + (a.resolution.skill?.rank ?? 0) * 0.25
			const quality = (good ? 1.15 : bad ? 0.6 : 0.9) * mastery
			const share = Math.min(1.2, a.minutes / 480)
			const pay = Math.max(1, Math.round(fullDay * share * quality * a.rng.range(0.85, 1.15)))
			a.delta.money = { delta: pay, reason: `плата за работу: ${offer.what}` }
			a.beats.push({
				role: "outcome",
				text: good
					? `Работа была такая: ${offer.what}. Ты делаешь её чисто, и платят без спора.`
					: bad
						? `Работа была такая: ${offer.what}. Выходит хуже, чем ждали, и платят соответственно.`
						: `Работа была такая: ${offer.what}. Сделано ровно настолько, чтобы заплатили.`,
				key: "work-pay",
			})
			a.addCost("fatigue")
			if (bad && a.rng.chance(0.5)) {
				a.delta.wounds = [{ zone: a.rng.pick(["левая кисть", "правое плечо", "колено", "спина"]), step: 1, cause: "сорвался на чужой работе" }]
				a.addCost("pain")
			}
			if (a.resolution.skill && good && a.rng.chance(0.35)) {
				a.delta.skills = [
					{
						name: a.resolution.skill.name,
						step: 1,
						justification: "третий заход в работе с риском и разбор того, что в прошлый раз не держалось",
					},
				]
			}
			break
		}

		case "починить":
		case "лечить": {
			a.concrete.value = true
			const item = a.parsed.item ? a.state.inventory.find((i) => i.name === a.parsed.item) : undefined
			if (id === "лечить") {
				const wound = [...a.state.condition.wounds].sort((x, y) => y.rank - x.rank)[0]
				if (!wound && a.state.condition.bleed === 0) {
					a.beats.push({ role: "outcome", text: "Лечить нечего: тело целое, и это стоит запомнить.", key: "heal-none" })
					break
				}
				if (a.state.condition.bleed > 0) a.delta.bleed = { step: -1, cause: "перевязка" }
				if (good && wound) a.delta.wounds = [{ zone: wound.zone, step: -1, cause: "промыл и перевязал" }]
				if (bad) {
					a.delta.stress = { segments: 1, reason: "боль вышла сильнее ожидаемой" }
					a.addCost("pain")
				}
				a.beats.push({
					role: "outcome",
					text: good
						? "Кровь останавливается, и края стягиваются как надо."
						: "Ты делаешь что можешь, и на этом всё.",
					key: "heal-done",
				})
				break
			}
			if (item && item.wear > 0 && good) {
				a.delta.inventory = {
					...(a.delta.inventory ?? {}),
					wear: [...(a.delta.inventory?.wear ?? []), { name: item.name, step: -1 }],
				}
				a.beats.push({ role: "outcome", text: `${capitalize(item.name)} снова держит.`, key: "fix-item" })
			} else if (bad && item) {
				a.delta.inventory = {
					...(a.delta.inventory ?? {}),
					wear: [...(a.delta.inventory?.wear ?? []), { name: item.name, step: 1 }],
				}
				a.addCost("wear")
			}
			if (good && a.rng.chance(0.4)) {
				a.delta.money = { delta: Math.round(a.anchors.dayFood * a.rng.range(1, 3)), reason: "за починку заплатили" }
			}
			a.addCost("fatigue")
			break
		}

		case "взломать":
		case "украсть": {
			if (good) {
				const loot = a.rng.pick(LOOT)
				a.delta.inventory = {
					...(a.delta.inventory ?? {}),
					add: [...(a.delta.inventory?.add ?? []), { name: `чужое: ${loot}`, qty: 1 }],
				}
				a.delta.trace = "замок открыт не своим ключом, и это видно вблизи"
				pushHook(a.delta, "пропажу заметят и начнут искать своими путями", 5)
				a.delta.stress = { segments: 1, reason: "чужое в руках" }
				a.addCost("trace")
			} else {
				a.delta.stress = { segments: 2, reason: "почти попался" }
				a.addCost("stress")
				if (a.parsed.npc) {
					pushNpc(a.delta, { name: a.parsed.npc, attitudeStep: -1, reason: "вас застали за чужим" })
					npcBeat(a, "cold")
				}
				pushConsequence(a.delta, "тебя ищут по описанию", "тебя видели там, где ты был не по делу", 3)
			}
			break
		}

		case "идти": {
			// Куда игрок сказал, туда он и приходит: мир мешает ценой, а не подменой цели.
			const asked = a.parsed.place
			const place = asked ?? a.rng.pick(a.flavor.places)
			a.concrete.value = true
			a.delta.scene = {
				location: place,
				posture: "стоишь",
				light: phaseOf(a.state.clock.minuteOfDay + a.minutes),
				participants: [],
			}
			a.beats.push({
				role: "outcome",
				text: good
					? `Дорога проходит без встреч. Теперь ты здесь: ${place}.`
					: bad
						? `Ты доходишь, но дольше и не тем путём, каким хотел. Теперь ты здесь: ${place}.`
						: `Путь занимает больше, чем стоило. Теперь ты здесь: ${place}.`,
				key: "move-place",
			})
			a.addCost("fatigue")
			if (bad && a.rng.chance(0.5)) a.delta.trace = "тебя видели по дороге"
			break
		}

		case "прятаться":
		case "ждать": {
			if (good) {
				a.delta.stress = { segments: -1, reason: "переждал и не наделал глупостей" }
				a.addCost("calm")
				if (a.rng.chance(0.5)) pushUnknown(a.delta, a.rng.pick(a.flavor.questions))
			} else {
				a.delta.stress = { segments: 1, reason: "ожидание вымотало сильнее дела" }
				a.addCost("stress")
			}
			break
		}

		case "драться": {
			const zone = a.rng.pick(["левая кисть", "правое плечо", "бок", "лицо", "колено"])
			if (good) {
				a.delta.stress = { segments: 1, reason: "драка кончилась в твою пользу" }
				if (a.rng.chance(0.6)) {
					a.delta.wounds = [{ zone, step: 1, cause: "чужой удар всё-таки дошёл" }]
					a.addCost("pain")
				}
				a.delta.trace = "после драки остаётся то, что видели все"
			} else {
				a.delta.wounds = [{ zone, step: 1, cause: "пропустил удар" }]
				a.delta.stress = { segments: 2, reason: "драка пошла не так" }
				a.addCost("pain")
				if (a.state.condition.wounds.some((w) => w.rank >= 2) || a.rng.chance(0.35)) {
					a.delta.bleed = { step: 1, cause: "рассечено" }
					a.addCost("blood")
				}
				pushConsequence(a.delta, "тебе не забудут этой драки", "ты ударил первым при свидетелях", 4)
			}
			// Смерть или шрам — только если причина уже стоит в теле. Правило выбирает партия.
			const lethal =
				a.state.condition.bleed >= 3 ||
				a.state.condition.health >= 3 ||
				a.state.condition.wounds.some((w) => w.rank >= 3)
			if (lethal && a.resolution.outcome === "провал с ценой") {
				a.delta.terminal = { kind: "death", cause: "тело не выдержало ещё одного удара" }
			}
			break
		}

		case "отдыхать": {
			if (a.state.condition.fatigue > 0) a.delta.fatigue = { step: -1 }
			a.delta.stress = { segments: -1, reason: "сон сделал своё" }
			a.addCost("calm")
			break
		}

		case "есть": {
			a.concrete.value = true
			const food = a.state.inventory.find((i) => /еда|хлеб|припас|сухар|рыб|сыр/i.test(i.name))
			if (food) {
				a.delta.inventory = {
					...(a.delta.inventory ?? {}),
					remove: [...(a.delta.inventory?.remove ?? []), { name: food.name, qty: 1 }],
				}
				if (a.state.condition.hunger > 0) a.delta.hunger = { step: -1 }
				a.beats.push({ role: "outcome", text: `Свои припасы кончаются быстрее, чем хотелось: ${food.name}.`, key: "eat-own" })
			} else if (a.state.money >= a.anchors.dayFood) {
				a.delta.money = { delta: -a.anchors.dayFood, reason: "еда на день" }
				if (a.state.condition.hunger > 0) a.delta.hunger = { step: -1 }
				a.addCost("money")
			} else {
				a.beats.push({
					role: "outcome",
					text: "Еды нет ни при тебе, ни за твои деньги. Приходится обойтись водой и терпением.",
					key: "eat-none",
				})
				if (a.state.condition.hunger < 3) a.delta.hunger = { step: 1 }
				a.addCost("hunger")
			}
			break
		}

		case "пить": {
			a.concrete.value = true
			if (a.state.condition.thirst > 0) a.delta.thirst = { step: -1 }
			a.beats.push({ role: "outcome", text: "Вода тёплая и отдаёт жестью, но горло отпускает.", key: "drink" })
			break
		}

		case "дать": {
			const item = a.parsed.item ? a.state.inventory.find((i) => i.name === a.parsed.item) : undefined
			if (item) {
				a.delta.inventory = {
					...(a.delta.inventory ?? {}),
					remove: [...(a.delta.inventory?.remove ?? []), { name: item.name, qty: 1 }],
				}
			} else if (a.state.money >= a.anchors.dayFood) {
				a.delta.money = { delta: -a.anchors.dayFood, reason: "отдал деньгами" }
				a.addCost("money")
			}
			if (a.parsed.npc) {
				pushNpc(a.delta, {
					name: a.parsed.npc,
					attitudeStep: 1,
					reason: "вы отдали своё, не выторговав ничего взамен",
					promiseKept: a.state.npcs.find((n) => n.name === a.parsed.npc)?.promises[0],
				})
				npcBeat(a, "warm")
			}
			break
		}

		default: {
			// «Своё»: мир отвечает на попытку, но ничего не выдумывает за игрока.
			if (bad) {
				a.delta.stress = { segments: 1, reason: "вышло не так, как задумано" }
				a.addCost("stress")
			} else if (good && a.rng.chance(0.35)) {
				pushUnknown(a.delta, a.rng.pick(a.flavor.questions))
			}
			break
		}
	}
}

/** Что вообще имеет смысл унести. Декорации мира для этого не годятся. */
const LOOT = [
	"узел с чужой тканью",
	"жестяная коробка с мелочью",
	"кошель без метки",
	"связка ключей не от твоих дверей",
	"пакет с бумагами",
	"нож в чужих ножнах",
	"склянка с чем-то дорогим",
]

function pickPurchase(a: IntentArgs): { kind: string; label: string; price: number } | null {
	const hay = a.parsed.raw.toLowerCase()
	const byWord = (roots: string[]): boolean => roots.some((r) => hay.includes(r))
	if (byWord(["ед", "хлеб", "поест", "прокорм", "обед", "ужин"])) {
		return { kind: "еда", label: "еда на день", price: a.anchors.dayFood }
	}
	if (byWord(["ночл", "комнат", "постой", "кров", "спат"])) {
		return { kind: "ночлег", label: "ночлег", price: a.anchors.bed }
	}
	// Иначе — самое дешёвое из того, чем этот мир вообще торгует.
	const affordable = a.anchors.entries.filter(([, price]) => price <= Math.max(a.state.money, a.anchors.dayFood))
	const choice = affordable.length ? a.rng.pick(affordable) : a.anchors.entries[0]
	if (!choice) return null
	const [label, price] = choice
	const kind = /еда|хлеб/i.test(label) ? "еда" : /ночл|постой/i.test(label) ? "ночлег" : "вещь"
	return { kind, label, price }
}

function pickWork(a: IntentArgs): { what: string; pay: [number, number] } {
	const mine = a.flavor.work.filter((w) =>
		w.tags.some((tag) => a.state.skills.some((s) => s.name.toLowerCase().includes(tag))),
	)
	const pool = mine.length ? mine : a.flavor.work
	const offer = a.rng.pick(pool)
	return { what: offer.what, pay: offer.pay }
}

/* ────────────────────────── расход времени ────────────────────────── */

function applyUpkeep(args: {
	state: State
	parsed: ParsedInput
	delta: Delta
	minutes: number
	addCost: (kind: keyof typeof COST) => void
}): void {
	const { state, delta, minutes, parsed } = args
	const c = state.condition
	const rest = parsed.spec.kind === "rest"
	if (!rest && minutes >= 150 && c.fatigue < 3 && !delta.fatigue) {
		delta.fatigue = { step: 1 }
		args.addCost("fatigue")
	}
	if (minutes >= 240 && c.thirst < 3 && !delta.thirst) {
		delta.thirst = { step: 1 }
		args.addCost("thirst")
	}
	if (minutes >= 300 && c.hunger < 3 && !delta.hunger) {
		delta.hunger = { step: 1 }
		args.addCost("hunger")
	}
	// Кровь не останавливается сама: если её не унять, она стоит здоровья.
	if (c.bleed >= 2 && !delta.bleed && !delta.health) {
		delta.health = { step: 1, cause: "кровопотеря не остановлена" }
		args.addCost("blood")
	}
}

/* ────────────────────────── мир делает свой шаг ────────────────────────── */

function applyWorld(args: {
	state: State
	ctx: PlanContext
	delta: Delta
	flavor: Flavor
	rng: Rng
	say: (role: BeatRole, bank: readonly string[], keyPrefix: string) => string
	anchors: Anchors
}): void {
	const { state, ctx, delta, flavor, rng, say } = args

	// Факты движка с прошлого хода: их надо отыграть, а не пересказать.
	for (const f of ctx.facts) {
		if (!f.forModel) continue
		if (f.code === "attitude_drift") say("world", WORLD.drift, "world:drift")
		else if (f.code === "scar_instead_of_death") say("world", WORLD.scar, "world:scar")
		else if (f.code === "overdue_world_acts") say("world", WORLD.obligation_due_3, "world:overdue3")
		else if (f.code === "directive_retired") say("world", WORLD.directive_retired, "world:retired")
	}

	for (const d of ctx.directives) {
		switch (d.code) {
			case "obligation_overdue": {
				const stage = d.stage ?? 1
				say("world", WORLD[`obligation_due_${Math.min(3, Math.max(1, stage))}`], `world:od${stage}`)
				if (stage >= 2 && rng.chance(0.5)) {
					delta.stress = delta.stress ?? { segments: 1, reason: "долг требуют вслух" }
				}
				break
			}
			case "obligation_due":
				say("world", WORLD.obligation_today, "world:today")
				break
			case "consequence_due": {
				if (d.subject) {
					delta.consequences = {
						...(delta.consequences ?? {}),
						fire: [...(delta.consequences?.fire ?? []), d.subject],
					}
				}
				say("world", WORLD.consequence_due, "world:conseq")
				break
			}
			case "hook_expired":
				say("world", WORLD.hook_expired, "world:hook")
				break
			case "front_date_due":
			case "front_ready": {
				const front = state.fronts.find((f) => f.name === d.subject)
				if (front && front.progress < 5) {
					delta.fronts = [
						...(delta.fronts ?? []),
						{
							name: front.name,
							progressStep: 1,
							advanceConditionMet: true,
							justification: `мир сделал свой шаг: ${front.nextAction}`,
						},
					]
				}
				say("world", WORLD.front_step, "world:front")
				break
			}
			case "unknowns_stale": {
				pushUnknown(delta, rng.pick(flavor.questions))
				say("world", WORLD.unknowns_stale, "world:unknown")
				break
			}
			default:
				break
		}
	}

	// Мир живёт и без директив: изредка мимо проходит чужая жизнь.
	if (!ctx.directives.length && rng.chance(0.35)) {
		const who = rng.pick(flavor.people)
		args.say("world", [`Мимо проходит ${who} и смотрит на тебя дольше, чем нужно.`, `${capitalize(who)} появляется не вовремя и не объясняет, зачем.`], "world:passer")
	}

	if (state.dead) return
	// Ступени лестниц не называются вслух: тело говорит само.
	const c = state.condition
	if (c.stress.level >= 2 && rng.chance(0.5)) {
		args.say("world", [`Руки не держат ровно, и это заметно не только тебе.`], "world:stress")
	}
	if (c.health >= 2 && rng.chance(0.5)) {
		args.say("world", [`Каждый шаг стоит дороже, чем стоил утром.`], "world:health")
	}
	void LADDERS
}
