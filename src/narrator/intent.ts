// Разбор реплики игрока без нейросети. Изоморфно: ни fs, ни path, ни process.
//
// Задача узкая и потому решаемая: не «понять текст», а выбрать одно из двадцати с чем-то
// намерений и найти в реплике адресата. Разбор идёт по корням слов, а не по точным формам,
// поэтому «поговорю», «поговорить», «говорю» — одно и то же намерение.
// Если ничего не узналось, это не ошибка: есть намерение «своё», и мир всё равно ответит.

import type { State } from "../types.ts"
import type { Flavor } from "./flavor.ts"

export type IntentKind = "social" | "body" | "mind" | "money" | "move" | "rest" | "risk"
export type StatKey = "str" | "dex" | "int" | "cha" | "wil"

export type IntentSpec = {
	id: string
	/** Что это действие называется по-человечески: идёт в колоду действий 2D-режима. */
	label: string
	stems: string[]
	/** Корни, по которым подбирается подходящий навык персонажа. */
	tags: string[]
	stat: StatKey
	/** Множитель к базовой длине сцены из настройки вкуса. */
	minutes: number
	kind: IntentKind
}

export const INTENTS: IntentSpec[] = [
	{
		id: "говорить",
		label: "Поговорить",
		stems: ["говор", "поговор", "беседов", "обсуд", "объясн", "расскаж", "скаж", "отвеч", "здоров", "поприветств"],
		tags: ["люд", "чтение люд", "уговор", "торг", "разговор"],
		stat: "cha",
		minutes: 0.5,
		kind: "social",
	},
	{
		id: "спросить",
		label: "Расспросить",
		stems: ["спрос", "спрош", "расспрос", "узна", "выясн", "вопрос", "интересу", "допрос", "выспрос"],
		tags: ["люд", "чтение люд", "разговор", "бумаг"],
		stat: "int",
		minutes: 0.6,
		kind: "mind",
	},
	{
		id: "убедить",
		label: "Убедить",
		stems: ["убед", "уговор", "упрос", "выпрос", "договор", "убеж", "склон", "попрос"],
		tags: ["уговор", "торг", "чтение люд", "люд"],
		stat: "cha",
		minutes: 0.7,
		kind: "social",
	},
	{
		id: "угрожать",
		label: "Надавить",
		stems: ["угрож", "пугн", "запуг", "надав", "прижа", "пригроз", "шантаж"],
		tags: ["бой", "оруж", "чтение люд"],
		stat: "wil",
		minutes: 0.4,
		kind: "risk",
	},
	{
		id: "соврать",
		label: "Соврать",
		stems: ["совр", "врат", "обман", "прикин", "притвор", "выдум", "наплет"],
		tags: ["чтение люд", "уговор", "торг"],
		stat: "cha",
		minutes: 0.5,
		kind: "social",
	},
	{
		id: "купить",
		label: "Купить",
		stems: ["куп", "покуп", "приобрет", "выкуп", "закуп", "торгов", "торгу", "цен"],
		tags: ["торг", "уговор", "счёт"],
		stat: "cha",
		minutes: 0.6,
		kind: "money",
	},
	{
		id: "продать",
		label: "Продать",
		stems: ["прода", "продав", "сбы", "сдат", "заложи", "загна"],
		tags: ["торг", "уговор", "счёт"],
		stat: "cha",
		minutes: 0.6,
		kind: "money",
	},
	{
		id: "заплатить",
		label: "Заплатить долг",
		stems: ["заплат", "плат", "отда", "верн", "рассчит", "расплат", "погас", "долг"],
		tags: ["счёт", "торг"],
		stat: "wil",
		minutes: 0.4,
		kind: "money",
	},
	{
		id: "работать",
		label: "Взяться за работу",
		stems: ["работ", "заработ", "подработ", "наня", "нанима", "труд", "смен", "подряд"],
		tags: ["руки", "сила", "ремонт", "груз", "бумаг"],
		stat: "str",
		minutes: 4,
		kind: "body",
	},
	{
		id: "починить",
		label: "Починить",
		stems: ["починит", "чин", "ремонт", "исправ", "подправ", "залат", "наладит", "смаз"],
		tags: ["ремонт", "механизм", "замк", "руки", "инструм", "сет", "узл"],
		stat: "dex",
		minutes: 1.5,
		kind: "body",
	},
	{
		id: "взломать",
		label: "Вскрыть замок",
		stems: ["взлом", "вскры", "отмычк", "подобр ключ", "выломат", "отпер"],
		tags: ["замк", "механизм", "инструм", "руки"],
		stat: "dex",
		minutes: 0.8,
		kind: "risk",
	},
	{
		id: "украсть",
		label: "Взять чужое",
		stems: ["укра", "воров", "стащ", "своро", "прикарман", "обчист", "залез в", "стян"],
		tags: ["замк", "ловкост", "молчан"],
		stat: "dex",
		minutes: 0.6,
		kind: "risk",
	},
	{
		id: "искать",
		label: "Поискать",
		stems: ["иска", "поиск", "разыск", "ищ", "обыск", "порыт", "пошар", "разузна", "выслед", "просле", "разобра"],
		tags: ["чтение люд", "бумаг", "лес", "внимани"],
		stat: "int",
		minutes: 1.2,
		kind: "mind",
	},
	{
		id: "осмотреть",
		label: "Осмотреться",
		stems: ["осмотр", "смотр", "гляд", "разгляд", "оглян", "изуч", "прислуш", "принюх", "проверит"],
		tags: ["внимани", "чтение люд", "бумаг"],
		stat: "int",
		minutes: 0.25,
		kind: "mind",
	},
	{
		id: "идти",
		label: "Пойти",
		stems: ["ид", "пойд", "пойти", "отправ", "напряв", "напра", "шага", "дойт", "верну", "уйт", "уход", "прийт", "добра", "загля"],
		tags: ["ходьб", "лес", "дорог"],
		stat: "str",
		minutes: 1.2,
		kind: "move",
	},
	{
		id: "прятаться",
		label: "Спрятаться",
		stems: ["прята", "спрят", "укры", "затаи", "переждат", "залеч"],
		tags: ["молчан", "ловкост"],
		stat: "dex",
		minutes: 0.8,
		kind: "risk",
	},
	{
		id: "драться",
		label: "Драка",
		stems: ["дра", "бит", "уда", "напад", "атак", "защища", "отбива", "нож", "кула"],
		tags: ["бой", "оруж", "сила"],
		stat: "str",
		minutes: 0.3,
		kind: "risk",
	},
	{
		id: "отдыхать",
		label: "Отдохнуть",
		stems: ["отдых", "отдохн", "спат", "усн", "ноч", "приле", "передохн", "выспат"],
		tags: [],
		stat: "wil",
		minutes: 8,
		kind: "rest",
	},
	{
		id: "есть",
		label: "Поесть",
		stems: ["ес", "поес", "еда", "покуша", "перекус", "хлеб", "обеда", "ужина", "завтрак"],
		tags: [],
		stat: "wil",
		minutes: 0.6,
		kind: "rest",
	},
	{
		id: "пить",
		label: "Напиться воды",
		stems: ["напит", "выпит", "вод", "фляг", "жажд", "пью", "пить"],
		tags: [],
		stat: "wil",
		minutes: 0.25,
		kind: "rest",
	},
	{
		id: "лечить",
		label: "Заняться раной",
		stems: ["леч", "перевяз", "промы", "бинт", "рану", "рана", "фельдшер", "врач", "знахар"],
		tags: ["лечен", "руки"],
		stat: "int",
		minutes: 1,
		kind: "body",
	},
	{
		id: "дать",
		label: "Отдать своё",
		stems: ["дат", "отдат", "подар", "передат", "вручит", "угост", "поделит"],
		tags: ["люд", "уговор"],
		stat: "cha",
		minutes: 0.4,
		kind: "social",
	},
	{
		id: "помочь",
		label: "Помочь",
		stems: ["помо", "выруч", "поддерж", "подсоб", "спас"],
		tags: ["руки", "люд", "сила"],
		stat: "cha",
		minutes: 1.2,
		kind: "social",
	},
	{
		id: "ждать",
		label: "Подождать",
		stems: ["жда", "подожд", "выжид", "постоят", "посид", "наблюда", "караул"],
		tags: ["внимани", "молчан"],
		stat: "wil",
		minutes: 1,
		kind: "rest",
	},
	{
		id: "думать",
		label: "Подумать",
		stems: ["дума", "разобрат", "вспомн", "план", "решит", "прикин", "посчита", "сообраз"],
		tags: ["счёт", "бумаг", "внимани"],
		stat: "int",
		minutes: 0.5,
		kind: "mind",
	},
]

export const FALLBACK_INTENT: IntentSpec = {
	id: "своё",
	label: "Своё действие",
	stems: [],
	tags: [],
	stat: "wil",
	minutes: 0.8,
	kind: "body",
}

export type ParsedInput = {
	spec: IntentSpec
	/** Насколько уверенно узнали намерение: 0 — не узнали вовсе. */
	confidence: number
	raw: string
	npc?: string
	item?: string
	place?: string
	/** Число из реплики: «отдам сорок» — сумма, а не украшение. */
	amount?: number
	/** Реплика узнана как обращение к конкретному человеку. */
	addressed: boolean
}

export function normalizeInput(text: string): string {
	return text
		.toLowerCase()
		.replace(/ё/g, "е")
		.replace(/[^\p{L}\p{N}\s-]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim()
}

function tokens(text: string): string[] {
	return normalizeInput(text).split(" ").filter(Boolean)
}

/** Корень слова, устойчивый к падежам: для сопоставления имён и предметов. */
export function rootOf(word: string): string {
	const w = normalizeInput(word)
	if (w.length <= 4) return w
	// Чем длиннее слово, тем больше у него хвоста, который меняется по падежам:
	// «рыночная» и «рыночную» сходятся только на пятой букве.
	if (w.length <= 6) return w.slice(0, w.length - 1)
	return w.slice(0, Math.max(4, w.length - 3))
}

function mentions(hay: string, name: string): boolean {
	const parts = normalizeInput(name).split(" ").filter((p) => p.length >= 3)
	return parts.some((p) => hay.includes(rootOf(p)))
}

/**
 * Единственная точка разбора. Ничего не выбрасывает: на пустой строке,
 * на эмодзи, на латинице — всегда вернёт намерение, пусть и «своё».
 */
export function parseInput(input: string, state: State, flavor: Flavor): ParsedInput {
	const raw = input.trim()
	const hay = normalizeInput(raw)
	const words = tokens(raw)

	let best: { spec: IntentSpec; score: number } | null = null
	for (const spec of INTENTS) {
		let score = 0
		for (const stem of spec.stems) {
			const s = stem.replace(/ё/g, "е")
			if (s.includes(" ")) {
				if (hay.includes(s)) score += s.length
				continue
			}
			for (const w of words) {
				if (w.startsWith(s)) {
					// Длинный корень — более уверенное попадание, чем короткий.
					score += s.length + (w === s ? 1 : 0)
					break
				}
			}
		}
		if (score > 0 && (!best || score > best.score)) best = { spec, score }
	}

	const npc = state.npcs.find((n) => mentions(hay, n.name))?.name
	const item = state.inventory.find((i) => mentions(hay, i.name))?.name
	const place =
		flavor.places.find((p) => mentions(hay, p)) ??
		(mentions(hay, state.scene.location) ? state.scene.location : undefined)
	const amountMatch = hay.match(/\d+/)
	const amount = amountMatch ? Number(amountMatch[0]) : undefined

	const spec = best?.spec ?? FALLBACK_INTENT
	return {
		spec,
		confidence: best ? Math.min(1, best.score / 12) : 0,
		raw,
		npc,
		item,
		place,
		amount: Number.isFinite(amount) ? amount : undefined,
		addressed: Boolean(npc),
	}
}

/** Навык персонажа, который здесь уместен. Ищется по корням, а не по точному имени. */
export function skillFor(state: State, spec: IntentSpec): { name: string; rank: number } | null {
	let best: { name: string; rank: number } | null = null
	for (const skill of state.skills) {
		const hay = normalizeInput(skill.name)
		const hit = spec.tags.some((tag) => hay.includes(normalizeInput(tag)))
		if (!hit) continue
		if (!best || skill.rank > best.rank) best = { name: skill.name, rank: skill.rank }
	}
	return best
}
