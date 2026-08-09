// Модель исхода: чем кончается попытка. Изоморфно: ни fs, ни path, ни process.
//
// Здесь нет ни одной случайности «на глазок»: бросок один, он узкий, а решают
// константы, навык, состояние тела и настройка вкуса партии. Из этого следует
// главное свойство — умелый и здоровый человек обычно добивается своего,
// а голодный, раненый и неумелый обычно платит. Баланс держится числами,
// а не настроением рассказчика.
import type { State } from "../types.ts"
import { skillFor } from "./intent.ts"
import type { IntentSpec, ParsedInput } from "./intent.ts"
import type { Rng } from "./rng.ts"
import type { Tuning } from "../tuning.ts"
import { pressureProfile } from "../tuning.ts"
import type { OutcomeId } from "./phrases.ts"

export type Resolution = {
	outcome: OutcomeId
	score: number
	/** Из чего сложился исход — построчно, человеческим языком, для панели отладки. */
	drivers: string[]
	skill: { name: string; rank: number } | null
	/** Действие с ценой ошибки: провал здесь оставляет след в мире. */
	risky: boolean
}

const STAT_LABEL: Record<string, string> = {
	str: "сила",
	dex: "ловкость",
	int: "ум",
	cha: "обаяние",
	wil: "воля",
}

const SKILL_LABEL = ["не знаком", "знаком", "обучен", "опытен", "эксперт"]

/** Порог: чем выше сумма, тем лучше исход. Пороги фиксированы, меняются вклады. */
function outcomeFor(score: number): OutcomeId {
	if (score >= 12.5) return "успех"
	if (score >= 10.5) return "успех с ценой"
	if (score >= 8.5) return "частично"
	if (score >= 6.5) return "провал"
	return "провал с ценой"
}

export function resolveAttempt(
	state: State,
	parsed: ParsedInput,
	tuning: Tuning,
	rng: Rng,
): Resolution {
	const spec: IntentSpec = parsed.spec
	const drivers: string[] = []
	let score = 10.5

	const stat = state.constants[spec.stat] ?? 10
	const statBonus = (stat - 10) * 0.6
	if (Math.abs(statBonus) >= 0.6) {
		drivers.push(`${STAT_LABEL[spec.stat]} ${statBonus > 0 ? "помогает" : "мешает"}`)
	}
	score += statBonus

	const skill = skillFor(state, spec)
	if (skill) {
		score += skill.rank * 1.4
		drivers.push(`навык «${skill.name}» — ${SKILL_LABEL[skill.rank] ?? "знаком"}`)
	} else if (spec.tags.length) {
		score -= 0.8
		drivers.push("подходящего навыка нет")
	}

	const c = state.condition
	// Штрафы за тело ограничены сверху намеренно. Без потолка игра входит в спираль:
	// усталость даёт провалы, провалы дают стресс, стресс даёт усталость — и вылезти нельзя.
	// Потолок оставляет плохому состоянию вес, но не отнимает у игрока управление.
	const bodyPenalty = Math.min(
		3.5,
		c.fatigue * 0.7 + c.hunger * 0.5 + c.thirst * 0.5 + c.health * 1.2 + c.stress.level * 0.6,
	)
	const woundPenalty = Math.min(
		2.5,
		c.wounds.reduce((sum, w) => sum + w.rank * 0.6, 0) + (c.bleed > 0 ? c.bleed * 0.5 : 0),
	)
	if (bodyPenalty + woundPenalty >= 0.5) {
		score -= bodyPenalty + woundPenalty
		drivers.push("тело мешает работать")
	}
	// Необратимое увечье мешает всегда: это и есть цена, которую носят.
	if (state.scars.length) {
		score -= Math.min(2, state.scars.length * 0.8)
		drivers.push("старое увечье не даёт полного размаха")
	}

	if (spec.kind === "social" || spec.id === "заплатить") {
		const npc = parsed.npc ? state.npcs.find((n) => n.name === parsed.npc) : undefined
		if (npc) {
			const bonus = (npc.attitude - 3) * 0.7
			score += bonus
			drivers.push(`${npc.name}: отношение ${bonus >= 0 ? "за тебя" : "против тебя"}`)
		}
	}

	if (spec.kind === "risk") {
		score -= 1.2
		drivers.push("дело с ценой ошибки")
	}

	const prof = pressureProfile(tuning)
	const difficulty = (tuning.worldPressure - 3) * 0.5
	score -= difficulty
	if (Math.abs(difficulty) >= 0.7) {
		drivers.push(difficulty > 0 ? "мир не помогает" : "мир снисходителен")
	}

	// Реплика, из которой не понято намерение, идёт как обычная попытка,
	// но без бонуса уверенности: движок не притворяется, что понял.
	if (parsed.confidence === 0) {
		score -= 0.6
		drivers.push("замысел размыт")
	}

	const roll = rng.range(-2.2, 2.2)
	score += roll

	return {
		outcome: outcomeFor(score),
		score: Math.round(score * 100) / 100,
		drivers,
		skill,
		risky: spec.kind === "risk" || prof.costFactor >= 1.2,
	}
}

export const OUTCOME_RANK: Record<OutcomeId, number> = {
	"успех": 2,
	"успех с ценой": 1,
	"частично": 0,
	"провал": -1,
	"провал с ценой": -2,
}
