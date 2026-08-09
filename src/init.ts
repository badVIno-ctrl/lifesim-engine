// ИНИЦИАЦИЯ. Мастер из 8 шагов — источник истины здесь, в коде.
// prompt/INIT.md — человеческое описание тех же восьми шагов; test/init.test.ts сверяет списки.
// INIT.md никогда не попадает в контекст игры: Session собирает только CORE + DELTA-SCHEMA.
import { normalizeState } from "./engine.ts"
import { readTuning } from "./tuning.ts"
import { stateFromPack } from "./packs.ts"
import type { Pack } from "./packs.ts"
import type { Tuning } from "./tuning.ts"
import type { State, WorldLevel } from "./types.ts"

export type InitStepId =
	| "character"
	| "setting"
	| "worldLevel"
	| "money"
	| "constants"
	| "skills"
	| "bond"
	| "goal"

export type InitStep = {
	id: InitStepId
	title: string
	question: string
	hint: string
	examples: string[]
	kind: "text" | "choice" | "number"
	choices?: string[]
}

export const WORLD_LEVELS: WorldLevel[] = ["щадящий", "суровый", "беспощадный"]

export const INIT_STEPS: InitStep[] = [
	{
		id: "character",
		title: "Кто вы",
		question: "Кто персонаж: имя, возраст, ремесло?",
		hint: "Одна строка. Без героики — человек с руками и долгами.",
		examples: [
			"Мартин Вейс, 31, бывший армейский слесарь",
			"Анна Керш, 24, писарь на таможне",
			"Грегор Старый, 58, перевозчик с одной здоровой рукой",
		],
		kind: "text",
	},
	{
		id: "setting",
		title: "Где и когда",
		question: "Где и когда всё происходит?",
		hint: "Место и время одной строкой. Масштаб — город или район, не материк.",
		examples: [
			"Пограничный городок Грауберг, поздняя осень",
			"Порт Ринген, 1928, сезон штормов",
			"Шахтёрский посёлок в предгорьях, второй год засухи",
		],
		kind: "text",
	},
	{
		id: "worldLevel",
		title: "Жёсткость мира",
		question: "Насколько дорого обойдётся ошибка?",
		hint: "Это не сложность боёв, а скорость и цена последствий.",
		examples: ["щадящий", "суровый", "беспощадный"],
		kind: "choice",
		choices: WORLD_LEVELS,
	},
	{
		id: "money",
		title: "Деньги",
		question: "Сколько денег в кармане на старте?",
		hint: "Число в валюте пака. Ориентир — якорь «еда на день» в этом мире.",
		examples: ["58", "12 — живёте от заработка до заработка", "240 — есть запас на пару недель"],
		kind: "number",
	},
	{
		id: "constants",
		title: "Пять констант",
		question: "Сила, ловкость, ум, обаяние, воля — пять чисел от 8 до 16.",
		hint: "Через запятую в этом порядке. Константы не растут по ходу игры — растут навыки.",
		examples: ["13, 15, 12, 8, 14", "9, 11, 16, 14, 10", "16, 12, 9, 10, 13"],
		kind: "text",
	},
	{
		id: "skills",
		title: "Три навыка",
		question: "Три вещи, которые вы умеете руками.",
		hint: "Через запятую. Все три начнутся со ступени «знаком» — выше нужно заслужить.",
		examples: [
			"слесарное дело, чтение людей, ходьба по лесу",
			"торг, почерк, узлы",
			"латание сетей, гребля, молчание",
		],
		kind: "text",
	},
	{
		id: "bond",
		title: "Кто держит за горло",
		question: "Один человек, которому вы что-то должны, и что именно.",
		hint: "Формат: имя — долг. Можно добавить сумму и срок: день 4. Срок станет календарным давлением.",
		examples: [
			"Марта — постой за комнату, 40, день 4",
			"Десятник Кольб — обещанная починка замка, день 3",
			"Брат жены — старый долг, 90",
		],
		kind: "text",
	},
	{
		id: "goal",
		title: "Цель и темнота",
		question: "Чего вы хотите добиться — и чего про этот мир вы пока НЕ знаете?",
		hint: "Формат: цель — вопрос без ответа. Вопрос попадёт в реестр неустановленного.",
		examples: [
			"Выкупить мастерскую — кто скупает долги в городе",
			"Уйти за перевал до снега — почему закрыли северную дорогу",
			"Вернуть доброе имя — что было в той последней накладной",
		],
		kind: "text",
	},
]

/**
 * Заготовки характера. Нужны новичку: пять чисел и три навыка — это первое,
 * на чём человек закрывает вкладку. Выбор из четырёх понятных людей — не закрывает.
 */
export type Archetype = {
	id: string
	title: string
	blurb: string
	constants: string
	skills: string
}

export const ARCHETYPES: Archetype[] = [
	{
		id: "руки",
		title: "Человек рук",
		blurb: "Работает телом и инструментом. Договариваться не умеет и не любит.",
		constants: "14, 14, 11, 8, 13",
		skills: "ремонт и механизмы, поднять и унести, терпеть боль",
	},
	{
		id: "голова",
		title: "Человек бумаг",
		blurb: "Считает, читает и помнит. В драке бесполезен.",
		constants: "9, 11, 16, 12, 12",
		skills: "бумаги и почерки, счёт и цены, чтение людей",
	},
	{
		id: "язык",
		title: "Человек разговора",
		blurb: "Берёт словом и знакомствами. Работать руками придётся редко и плохо.",
		constants: "10, 12, 12, 16, 10",
		skills: "торг и уговор, чтение людей, слухи и знакомства",
	},
	{
		id: "воля",
		title: "Человек, который вытерпит",
		blurb: "Не самый умелый, зато не ломается там, где ломаются другие.",
		constants: "13, 11, 10, 9, 17",
		skills: "ближний бой, ходьба по лесу, молчание",
	},
]

export type InitAnswers = Partial<Record<InitStepId, string>>

function splitList(v: string): string[] {
	return v
		.split(/[,;\n]/)
		.map((x) => x.trim())
		.filter(Boolean)
}

function parseConstants(v: string): State["constants"] | null {
	const nums = (v.match(/-?\d+/g) ?? []).map(Number)
	if (nums.length < 5) return null
	const fit = (n: number): number => Math.max(3, Math.min(20, Math.round(n)))
	return { str: fit(nums[0]), dex: fit(nums[1]), int: fit(nums[2]), cha: fit(nums[3]), wil: fit(nums[4]) }
}

function splitDash(v: string): [string, string] {
	const parts = v.split(/\s+[—–-]\s+/)
	if (parts.length >= 2) return [parts[0].trim(), parts.slice(1).join(" — ").trim()]
	return [v.trim(), ""]
}

/** Кнопка «мне всё равно, реши сам»: ответ берётся из пака, без обращения к модели. */
export function defaultAnswer(step: InitStepId, pack: Pack): string {
	const s = pack.state
	switch (step) {
		case "character":
			return s.meta.character
		case "setting":
			return s.meta.setting
		case "worldLevel":
			return s.meta.worldLevel
		case "money":
			return String(s.money)
		case "constants": {
			const c = s.constants
			return `${c.str}, ${c.dex}, ${c.int}, ${c.cha}, ${c.wil}`
		}
		case "skills":
			return s.skills.map((x) => x.name).join(", ")
		case "bond": {
			const ob = s.obligations[0]
			if (ob) {
				const amount = typeof ob.amount === "number" ? `, ${ob.amount}` : ""
				const due = typeof ob.dueDay === "number" ? `, день ${ob.dueDay}` : ""
				const who = s.npcs[0]?.name ?? "Сосед"
				return `${who} — ${ob.what}${amount}${due}`
			}
			const npc = s.npcs[0]
			return npc ? `${npc.name} — мелкий долг без срока` : "Сосед — мелкий долг без срока"
		}
		case "goal": {
			const goal = s.goals[0] ?? "Дожить до конца месяца без новых долгов"
			const unk = s.unknowns[0] ?? ""
			return unk ? `${goal} — ${unk}` : goal
		}
	}
}

export function allDefaults(pack: Pack): InitAnswers {
	const out: InitAnswers = {}
	for (const step of INIT_STEPS) out[step.id] = defaultAnswer(step.id, pack)
	return out
}

function stripEmpty(a: InitAnswers): InitAnswers {
	const out: InitAnswers = {}
	for (const step of INIT_STEPS) {
		const v = a[step.id]
		if (typeof v === "string" && v.trim()) out[step.id] = v
	}
	return out
}

/**
 * Сборка валидного state по схеме src/types.ts.
 * Пак даёт каркас мира (якоря, фронты, крючки, unknowns), ответы игрока перекрывают личное.
 * Модель в этом не участвует: числа ставит код.
 */
export function buildStateFromAnswers(pack: Pack, answers: InitAnswers, tuning?: Tuning): State {
	const s = stateFromPack(pack)
	const a = { ...allDefaults(pack), ...stripEmpty(answers) }
	// Правила партии выбираются до первого хода и живут в состоянии, а не в настройках приложения.
	s.tuning = readTuning(tuning ?? s.tuning)

	s.meta.character = (a.character ?? "").trim()
	s.meta.setting = (a.setting ?? "").trim()
	const level = WORLD_LEVELS.find((l) => l === (a.worldLevel ?? "").trim())
	if (level) s.meta.worldLevel = level

	const money = Number.parseInt((a.money ?? "").replace(/[^\d-]/g, ""), 10)
	if (Number.isFinite(money)) s.money = Math.max(0, money)

	const consts = parseConstants(a.constants ?? "")
	if (consts) s.constants = consts

	const skills = splitList(a.skills ?? "")
	if (skills.length) {
		// Ранг 1 = «знаком». Выше на старте не выдаём: рост требует justification в applyDelta.
		s.skills = skills.slice(0, 6).map((name) => ({ name, rank: 1 }))
	}

	const [who, debt] = splitDash(a.bond ?? "")
	if (who) {
		if (!s.npcs.some((n) => n.name.toLowerCase() === who.toLowerCase())) {
			s.npcs.unshift({
				name: who,
				attitude: 3,
				lastContactTurn: 0,
				promises: [],
				hidden: { wants: "чтобы долг вернули в срок" },
			})
		}
		if (debt) {
			const amountMatch = debt.match(/(\d+)(?!.*\d)/)
			const dueMatch = debt.match(/день\s*(\d+)/i)
			const what = debt
				.replace(/,\s*день\s*\d+/i, "")
				.replace(/,\s*\d+\s*$/, "")
				.trim()
			const obligation: State["obligations"][number] = { what: `${who}: ${what || debt}` }
			if (dueMatch) obligation.dueDay = Number(dueMatch[1])
			else obligation.dueDay = s.clock.day + 3
			if (amountMatch && !dueMatch) obligation.amount = Number(amountMatch[1])
			else if (amountMatch && dueMatch && amountMatch[1] !== dueMatch[1]) {
				obligation.amount = Number(amountMatch[1])
			}
			s.obligations.unshift(obligation)
		}
	}

	const [goal, unknown] = splitDash(a.goal ?? "")
	if (goal) s.goals = [goal, ...s.goals.filter((g) => g !== goal)].slice(0, 5)
	if (unknown) s.unknowns = [unknown, ...s.unknowns.filter((u) => u !== unknown)]

	s.ledger = [{ turn: 0, text: `инициация: ${s.meta.character}, ${s.meta.setting}` }]
	return normalizeState(s)
}

/** Заголовок партии для списка на экране НАЧАЛО. */
export function titleFor(state: State): string {
	const who = state.meta.character.split(",")[0].trim()
	return `${who} — ${state.meta.setting}`
}
