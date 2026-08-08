// Типы состояния симуляции V13.1.
// Состояние — единственный источник истины. Модель его не хранит.
// Файл изоморфный: ни fs, ни path, ни process.

export type WorldLevel = "щадящий" | "суровый" | "беспощадный"
export type Channel = "зрение" | "звук" | "тело" | "запах" | "вкус"

export type Skill = { name: string; rank: number } // индекс в LADDERS.skill
export type Wound = { zone: string; rank: number }
export type Item = { name: string; qty: number; wear: number }
export type Effect = { name: string; expiresAtTurn: number | null }

export type Npc = {
	name: string
	attitude: number // индекс в LADDERS.attitude
	lastContactTurn: number
	promises: string[]
	/** Почему отношение такое. Переживает сжатие истории. */
	lastReason?: string
	lastReasonTurn?: number
	hidden?: { wants?: string; fears?: string; lever?: string; secret?: string }
}

/**
 * E. Фронт двигается только по проверяемому условию.
 * advanceCondition — человекочитаемая формулировка события.
 * advanceOnDay — календарная дата. Если она задана и наступила, условие
 * проверяет сам движок, и подтверждение модели уже не требуется.
 */
export type Front = {
	name: string
	goal: string
	progress: number // 0..5
	nextAction: string
	advanceCondition: string
	advanceOnDay?: number | null
}

export type Hook = {
	text: string
	sownTurn: number
	window: number
	sleeping?: boolean
	/** Ход, на котором окно истекло. Нужен движку для календарного давления (D). */
	expiredTurn?: number
}

export type Consequence = { what: string; cause: string; window: number; addedTurn: number }
export type Obligation = { what: string; amount?: number; dueDay?: number }

export type Stress = { level: number; segments: number } // level: индекс в LADDERS.stress

/** B. Озарения как шкалы больше нет. Остался редкий факт биографии. */
export type RevelationCriterion = "model_broken" | "near_death" | "own_failure_analyzed"
export type Revelation = { turn: number; criterion: RevelationCriterion; what: string }

export type State = {
	version: "13.1"
	meta: {
		character: string
		setting: string
		worldLevel: WorldLevel
		toneOff: string[]
		specialRule?: string
		currency: string
	}
	clock: { turn: number; day: number; minuteOfDay: number }
	snapshotSeq: number
	dead: boolean
	scene: { location: string; posture: string; light: string; participants: string[] }
	constants: { str: number; dex: number; int: number; cha: number; wil: number }
	skills: Skill[]
	condition: {
		health: number // индекс в LADDERS.health
		wounds: Wound[]
		bleed: number
		fatigue: number // 0..3
		hunger: number // 0..3
		thirst: number // 0..3
		stress: Stress
	}
	effects: Effect[]
	milestones: number // 0..5
	revelations: Revelation[]
	inventory: Item[]
	money: number
	obligations: Obligation[]
	capital: string[]
	npcs: Npc[]
	consequences: Consequence[]
	fronts: Front[]
	hooks: Hook[]
	unknowns: string[]
	/** F. Ход, на котором реестр неустановленного пополнялся в последний раз. */
	lastUnknownAddTurn: number
	precedents: string[]
	goals: string[]
	channelHistory: Channel[]
	ledger: { turn: number; text: string }[]
	economy: { anchors: Record<string, number>; regionMultiplier: number }
}

// ---- Дельта, которую возвращает модель ----

export type Delta = {
	time?: { minutes?: number; days?: number }
	channel?: Channel
	scene?: Partial<State["scene"]>
	stress?: { segments: number; reason?: string }
	fatigue?: { step: number }
	hunger?: { step: number }
	thirst?: { step: number }
	health?: { step: number; cause?: string }
	wounds?: { zone: string; step: number; cause?: string }[]
	bleed?: { step: number; cause?: string }
	money?: { delta: number; reason?: string }
	inventory?: {
		add?: { name: string; qty?: number; wear?: string }[]
		remove?: { name: string; qty?: number }[]
		wear?: { name: string; step: number }[]
	}
	npc?: {
		name: string
		attitudeStep?: number
		reason?: string
		promise?: string
		promiseKept?: string
	}[]
	skills?: { name: string; step: number; justification?: string }[]
	milestone?: { granted: boolean; criterion?: string }
	/** B. Разовая пометка о переломе вместо шкалы озарения. */
	revelation?: { criterion: string; what: string }
	effects?: { add?: { name: string; expiresInTurns?: number }[]; remove?: string[] }
	trace?: string
	hooks?: { add?: { text: string; window?: number }[]; resolve?: string[]; sleep?: string[] }
	consequences?: { add?: { what: string; cause: string; window?: number }[]; fire?: string[] }
	fronts?: {
		name: string
		progressStep: number
		advanceConditionMet?: boolean
		justification?: string
	}[]
	/** D. Обязательства — календарь, из которого движок делает давление. */
	obligations?: { add?: { what: string; amount?: number; dueDay?: number }[]; settle?: string[] }
	unknowns?: { add?: string[]; resolve?: string[] }
	goals?: { add?: string[]; done?: string[] }
	precedent?: string
	terminal?: { kind: "death" | "coma"; cause: string }
	note?: string
}

/**
 * Единый список ключей дельты. Из него генерируется JSON Schema для
 * structured output (пункт J), поэтому он обязан совпадать с `keyof Delta`.
 * Совпадение проверяется компилятором ниже и тестом test/schema.test.ts.
 */
export const DELTA_KEYS = [
	"time",
	"channel",
	"scene",
	"stress",
	"fatigue",
	"hunger",
	"thirst",
	"health",
	"wounds",
	"bleed",
	"money",
	"inventory",
	"npc",
	"skills",
	"milestone",
	"revelation",
	"effects",
	"trace",
	"hooks",
	"consequences",
	"fronts",
	"obligations",
	"unknowns",
	"goals",
	"precedent",
	"terminal",
	"note",
] as const

export type DeltaKey = (typeof DELTA_KEYS)[number]

// Компилятор падает, если списки разошлись в любую сторону.
type _MissingInList = Exclude<keyof Delta, DeltaKey>
type _ExtraInList = Exclude<DeltaKey, keyof Delta>
type _Assert<T extends never> = T
export type _DeltaKeysAreExhaustive = _Assert<_MissingInList | _ExtraInList>

// ---- Что движок возвращает наверх ----

/**
 * A. Отклонённая правка — это событие мира, а не ошибка.
 * kind: "rejection" — движок не дал сделать то, что просила модель;
 *       "limit"     — превышен структурный лимит мира;
 *       "clamp"     — правка применена, но урезана (правило одной ступени);
 *       "event"     — движок сам породил факт (перелом, дрейф отношений).
 * forModel — уходит ли факт в следующий системный блок для модели.
 */
export type EngineFactKind = "rejection" | "limit" | "clamp" | "event"

export type EngineFact = {
	kind: EngineFactKind
	code: string
	text: string
	forModel: boolean
}

/** D/F. Обязательное к отработке в текущем ходу, посчитанное по календарю. */
export type Directive = { code: string; text: string }

export type ApplyResult = {
	state: State
	facts: EngineFact[]
	/** Совместимый со старым ядром плоский вид на facts. */
	warnings: string[]
	/** G. Что реально применилось — построчно, для панели отладки. */
	applied: string[]
	microLog: string
	due: {
		consequences: Consequence[]
		hooksExpiring: Hook[]
		frontsReady: Front[]
		obligations: Obligation[]
	}
}
