// Настройка вкуса партии. Изоморфно: ни fs, ни path, ни process.
//
// Правило этого файла одно и оно жёсткое: **ни одна строчка кода снаружи не читает
// `state.tuning` напрямую**. Читают только через `tuningOf`, который никогда не падает.
// Причина простая: старые сейвы блока настроек не имеют вовсе, а тесты собирают
// состояние руками. Настройка вкуса не имеет права убить загрузку партии.
//
// Второе правило: настройки живут в состоянии партии, а не в настройках приложения.
// Две партии идут по разным правилам, и экспорт везёт правила с собой.

/** Как мир обращается со сроками, ошибками и телом. */
export type SceneLength = "короткая" | "средняя" | "длинная"
export type DeathRule = "смерть" | "шрам"

export type Tuning = {
	/** 1 — мир терпит, 5 — мир не ждёт. Из этого считается вся эскалация. */
	worldPressure: number
	/** Ориентир длины одного хода: минуты и объём прозы. */
	sceneLength: SceneLength
	/** Что делает движок, когда причина смерти уже стоит в состоянии. */
	deathRule: DeathRule
	/** Игровых дней без контакта до одного шага дрейфа отношения к нейтралитету. */
	bondCoolDays: number
	/** Ходов без пополнения реестра неустановленного до напоминания. */
	unknownsPatience: number
}

export type TuningPresetId = "calm" | "balanced" | "harsh"
/** Ярлык, который видит игрок: имя пресета или «Своё». */
export type TuningLabel = TuningPresetId | "custom"

export type TuningPreset = {
	id: TuningPresetId
	title: string
	blurb: string
	values: Tuning
}

export const TUNING_PRESETS: TuningPreset[] = [
	{
		id: "calm",
		title: "Спокойная история",
		blurb: "Мир терпит долго, сцены длинные, смерть заменена необратимым шрамом.",
		values: {
			worldPressure: 1,
			sceneLength: "длинная",
			deathRule: "шрам",
			bondCoolDays: 12,
			unknownsPatience: 16,
		},
	},
	{
		id: "balanced",
		title: "Сбалансированно",
		blurb: "Срок даёт второй шанс, но не третий. Ошибка стоит денег, времени и лица.",
		values: {
			worldPressure: 3,
			sceneLength: "средняя",
			deathRule: "смерть",
			bondCoolDays: 6,
			unknownsPatience: 10,
		},
	},
	{
		id: "harsh",
		title: "Суровый мир",
		blurb: "Второго шанса нет: просрочил — мир пришёл сам. Сцены короткие, счёт быстрый.",
		values: {
			worldPressure: 5,
			sceneLength: "короткая",
			deathRule: "смерть",
			bondCoolDays: 3,
			unknownsPatience: 6,
		},
	},
]

export const DEFAULT_PRESET: TuningPresetId = "balanced"

export function presetById(id: string): TuningPreset | null {
	return TUNING_PRESETS.find((p) => p.id === id) ?? null
}

export function defaultTuning(): Tuning {
	return { ...(presetById(DEFAULT_PRESET) as TuningPreset).values }
}

const SCENE_LENGTHS: SceneLength[] = ["короткая", "средняя", "длинная"]
const DEATH_RULES: DeathRule[] = ["смерть", "шрам"]

/** Границы ручек. UI берёт их отсюда, чтобы не разъехаться с разбором. */
export const TUNING_LIMITS = {
	worldPressure: { min: 1, max: 5 },
	bondCoolDays: { min: 1, max: 30 },
	unknownsPatience: { min: 3, max: 40 },
} as const

function clampInt(x: unknown, min: number, max: number, fallback: number): number {
	const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : Number.NaN
	if (!Number.isFinite(n)) return fallback
	return Math.max(min, Math.min(max, Math.round(n)))
}

function oneOf<T extends string>(x: unknown, allowed: T[], fallback: T): T {
	return typeof x === "string" && (allowed as string[]).includes(x) ? (x as T) : fallback
}

/**
 * Разбор, который **никогда не падает**: из `undefined`, из старого сейва, из мусора,
 * из массива, из строки — всегда полный набор настроек.
 */
export function readTuning(raw: unknown): Tuning {
	const base = defaultTuning()
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base
	const o = raw as Record<string, unknown>
	// Ярлык пресета внутри блока — подсказка, а не истина: значения всё равно перечитываются.
	const seed = typeof o.preset === "string" ? presetById(o.preset)?.values ?? base : base
	return {
		worldPressure: clampInt(
			o.worldPressure,
			TUNING_LIMITS.worldPressure.min,
			TUNING_LIMITS.worldPressure.max,
			seed.worldPressure,
		),
		sceneLength: oneOf(o.sceneLength, SCENE_LENGTHS, seed.sceneLength),
		deathRule: oneOf(o.deathRule, DEATH_RULES, seed.deathRule),
		bondCoolDays: clampInt(
			o.bondCoolDays,
			TUNING_LIMITS.bondCoolDays.min,
			TUNING_LIMITS.bondCoolDays.max,
			seed.bondCoolDays,
		),
		unknownsPatience: clampInt(
			o.unknownsPatience,
			TUNING_LIMITS.unknownsPatience.min,
			TUNING_LIMITS.unknownsPatience.max,
			seed.unknownsPatience,
		),
	}
}

/** Единственный способ достать настройки из состояния. Работает и на `{}`, и на `null`. */
export function tuningOf(state: unknown): Tuning {
	if (!state || typeof state !== "object") return defaultTuning()
	return readTuning((state as { tuning?: unknown }).tuning)
}

export function sameTuning(a: Tuning, b: Tuning): boolean {
	return (
		a.worldPressure === b.worldPressure &&
		a.sceneLength === b.sceneLength &&
		a.deathRule === b.deathRule &&
		a.bondCoolDays === b.bondCoolDays &&
		a.unknownsPatience === b.unknownsPatience
	)
}

/**
 * Ярлык для интерфейса: совпало с пресетом — имя пресета, иначе «Своё».
 * Крутнул ручку — ярлык меняется сам; вернул значение — возвращается имя пресета.
 */
export function labelOf(t: Tuning): TuningLabel {
	for (const p of TUNING_PRESETS) if (sameTuning(p.values, t)) return p.id
	return "custom"
}

export function labelTitle(label: TuningLabel): string {
	return label === "custom" ? "Своё" : presetById(label)?.title ?? "Своё"
}

/** Из чисел настроек — рабочие пороги движка. Чистая функция, тестируется отдельно. */
export type PressureProfile = {
	/**
	 * Дней просрочки до каждой из трёх ступеней:
	 * косвенный сигнал → прямая угроза → мир действует сам.
	 */
	overdueStages: [number, number, number]
	/** Сколько ходов движок повторяет одну директиву, прежде чем перестать её требовать. */
	directivePatience: number
	/** Ориентир длины хода в минутах: от, обычно, до. */
	sceneMinutes: { min: number; base: number; max: number }
	/** Множитель цены ошибки: на нём стоят стресс и износ в своём движке. */
	costFactor: number
}

// Дней просрочки до каждой ступени. Просрочка начинается с первого дня,
// поэтому первая ступень всегда 1: раньше просрочки просто нет.
// Суровый мир проскакивает косвенный сигнал: сразу требование, на второй день — действие.
const OVERDUE_LADDER: Record<number, [number, number, number]> = {
	1: [1, 6, 12],
	2: [1, 5, 10],
	3: [1, 3, 6],
	4: [1, 2, 4],
	5: [1, 1, 2],
}

const SCENE_MINUTES: Record<SceneLength, { min: number; base: number; max: number }> = {
	"короткая": { min: 5, base: 20, max: 90 },
	"средняя": { min: 10, base: 40, max: 240 },
	"длинная": { min: 15, base: 75, max: 480 },
}

export function pressureProfile(t: Tuning): PressureProfile {
	const p = clampInt(t.worldPressure, 1, 5, 3)
	return {
		overdueStages: OVERDUE_LADDER[p] ?? OVERDUE_LADDER[3],
		// Суровый мир не уговаривает: он быстрее перестаёт напоминать и действует сам.
		directivePatience: 8 - p,
		sceneMinutes: SCENE_MINUTES[t.sceneLength] ?? SCENE_MINUTES["средняя"],
		costFactor: 0.6 + p * 0.2,
	}
}

/** Человеческое описание настроек — для панели состояния, снапшота и экспорта. */
export function describeTuning(t: Tuning): string {
	const prof = pressureProfile(t)
	return [
		`давление ${t.worldPressure}/5`,
		`сцена ${t.sceneLength}`,
		`правило смерти: ${t.deathRule}`,
		`отношения остывают за ${t.bondCoolDays} дн.`,
		`вопросы напоминают через ${t.unknownsPatience} ходов`,
		`просрочка: ступени на ${prof.overdueStages.join("/")} дн.`,
	].join(" · ")
}
