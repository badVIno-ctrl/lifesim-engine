// Канонические лестницы. Правило одной ступени живёт в коде, а не в промпте.
// Изоморфный модуль: ни fs, ни path, ни process.

export const LADDERS = {
	skill: ["не знаком", "знаком", "обучен", "опытен", "эксперт"],
	attitude: [
		"враждебность",
		"неприязнь",
		"настороженность",
		"нейтралитет",
		"расположение",
		"доверие",
		"преданность",
	],
	object: ["цело", "повреждено", "сломано"],
	health: ["устойчив", "ослаблен", "тяжёл", "критичен"],
	wound: ["нет", "поверхностная", "глубокая", "разрушительная"],
	bleed: ["нет", "малая", "значительная", "смертельная"],
	stress: ["спокоен", "напряжён", "на грани", "срыв"],
	fatigue: ["бодр", "лёгкая", "заметная", "изнеможен"],
	hunger: ["сыт", "лёгкий голод", "голоден", "истощён"],
	thirst: ["нет жажды", "сухость", "жажда", "обезвожен"],
	merchant: ["мошенник", "сомнительный", "неизвестный", "приличный", "надёжный партнёр"],
} as const

export type LadderName = keyof typeof LADDERS

export const PHASES = [
	"предрассвет",
	"рассвет",
	"утро",
	"полдень",
	"день",
	"вечер",
	"сумерки",
	"ночь",
] as const

export function phaseOf(minuteOfDay: number): string {
	const h = Math.floor((minuteOfDay % 1440) / 60)
	if (h < 5) return "ночь"
	if (h < 7) return "предрассвет"
	if (h < 9) return "рассвет"
	if (h < 12) return "утро"
	if (h < 14) return "полдень"
	if (h < 18) return "день"
	if (h < 21) return "вечер"
	if (h < 23) return "сумерки"
	return "ночь"
}

export function clockLabel(minuteOfDay: number): string {
	const m = ((minuteOfDay % 1440) + 1440) % 1440
	const h = Math.floor(m / 60)
	const mm = m % 60
	return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`
}

/** Правило одной ступени + границы лестницы. Возвращает новый индекс и предупреждение. */
export function stepLadder(
	ladder: LadderName,
	current: number,
	requestedStep: number,
	label: string,
): { value: number; warning?: string } {
	const max = LADDERS[ladder].length - 1
	let step = requestedStep
	let warning: string | undefined
	if (Math.abs(step) > 1) {
		warning = `правило одной ступени: ${label} запрошено ${step}, применено ${Math.sign(step)}`
		step = Math.sign(step)
	}
	const value = Math.max(0, Math.min(max, current + step))
	return { value, warning }
}

export function bar(filled: number, total = 5): string {
	const f = Math.max(0, Math.min(total, filled))
	return "█".repeat(f) + "░".repeat(total - f)
}
