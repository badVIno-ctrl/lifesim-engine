// Эталонные состояния и прогон по ним. Изоморфно: ни fs, ни path, ни process.
//
// Без этого любая правка промпта или движка — гадание. Здесь десять состояний,
// каждое из которых что-то ломало или может сломать, и один прогон, который
// отвечает на четыре вопроса про любого рассказчика:
//   1) выполняет ли он требования движка,
//   2) двигает ли время,
//   3) не выдумывает ли чисел,
//   4) не просит ли невозможного (отклонённая дельта — это дефект рассказчика).
//
// Прогон принимает любого рассказчика той же формы, что и свой движок,
// поэтому им можно мерить и модель за ключом, и код без ключа.
import { applyDelta, calendarPressure, audit, clone, normalizeState } from "./engine.ts"
import { presetById } from "./tuning.ts"
import type { Delta, EngineFact, State } from "./types.ts"
import type { NarratorMemory } from "./narrator/plan.ts"

export type GoldenNarrator = (args: {
	state: State
	input: string
	directives: { code: string; text: string; subject?: string; stage?: number }[]
	facts: EngineFact[]
	memory?: NarratorMemory | null
}) => { prose: string; delta: Delta; memory?: NarratorMemory; trace?: string }

export type GoldenCase = {
	id: string
	/** Что именно проверяет это состояние и что оно ломало раньше. */
	why: string
	build: (base: State) => State
	/** Реплики игрока, которые в этом состоянии осмысленны. */
	inputs: string[]
}

function withPreset(s: State, preset: string): State {
	const next = clone(s)
	next.tuning = presetById(preset)?.values ?? next.tuning
	return normalizeState(next)
}

export const GOLDEN_CASES: GoldenCase[] = [
	{
		id: "старт",
		why: "чистое начало партии: ничего не просрочено, тело целое, реестр полон",
		build: (b) => withPreset(b, "balanced"),
		inputs: ["осмотреться", "поговорить с тем, кто рядом", "взяться за работу"],
	},
	{
		id: "просрочка",
		why: "срок вышел давно: рассказчик обязан отработать эскалацию, а не повторять фразу",
		build: (b) => {
			const s = withPreset(b, "balanced")
			s.clock.day = 12
			s.obligations = [{ what: "долг Марте за комнату", amount: 40, dueDay: 4 }]
			return s
		},
		inputs: ["поговорить с Мартой", "осмотреться", "спрятаться и переждать"],
	},
	{
		id: "нет денег",
		why: "касса пуста: попытка купить или заплатить не должна давать отклонённой дельты",
		build: (b) => {
			const s = withPreset(b, "balanced")
			s.money = 0
			s.obligations = [{ what: "долг за постой", amount: 25, dueDay: 3 }]
			s.clock.day = 3
			return s
		},
		inputs: ["купить еды", "заплатить долг", "продать что-нибудь", "поесть"],
	},
	{
		id: "кровь",
		why: "смертельная причина уже в теле: терминал возможен, но только по правилу партии",
		build: (b) => {
			const s = withPreset(b, "balanced")
			s.condition.bleed = 3
			s.condition.wounds = [{ zone: "бок", rank: 3 }]
			s.condition.health = 2
			return s
		},
		inputs: ["перевязать рану", "подраться с тем, кто рядом", "отдохнуть"],
	},
	{
		id: "шрам вместо смерти",
		why: "правило «шрам»: партия обязана продолжиться, а увечье — остаться навсегда",
		build: (b) => {
			const s = withPreset(b, "calm")
			s.condition.bleed = 3
			s.condition.health = 3
			return s
		},
		inputs: ["подраться", "перевязать рану", "отдохнуть до утра"],
	},
	{
		id: "истощение",
		why: "голод, жажда и усталость на пределе: правило одной ступени не должно нарушаться",
		build: (b) => {
			const s = withPreset(b, "harsh")
			s.condition.hunger = 3
			s.condition.thirst = 3
			s.condition.fatigue = 3
			s.condition.stress = { level: 2, segments: 4 }
			return s
		},
		inputs: ["напиться воды", "поесть", "отдохнуть до утра", "взяться за работу"],
	},
	{
		id: "фронт на пороге",
		why: "фронт на четвёртой ступени и с наступившей датой: мир обязан сделать шаг",
		build: (b) => {
			const s = withPreset(b, "balanced")
			s.fronts = s.fronts.map((f, i) => ({ ...f, progress: i === 0 ? 4 : f.progress }))
			if (s.fronts[1]) s.fronts[1].advanceOnDay = 1
			return s
		},
		inputs: ["осмотреться", "разузнать, что происходит", "вмешаться"],
	},
	{
		id: "пустой реестр",
		why: "реестр неустановленного пуст — сверка считает это дефектом мира",
		build: (b) => {
			const s = withPreset(b, "balanced")
			s.unknowns = []
			s.lastUnknownAddTurn = -20
			return s
		},
		inputs: ["осмотреться", "спросить о том, что здесь было", "поискать след"],
	},
	{
		id: "обещания",
		why: "много людей и обещаний: отношения не должны двигаться без причины",
		build: (b) => {
			const s = withPreset(b, "calm")
			s.npcs = s.npcs.map((n, i) => ({
				...n,
				promises: i === 0 ? ["вернуть инструмент до вечера", "молчать о сундуке"] : n.promises,
				lastContactDay: 1,
			}))
			s.clock.day = 30
			return s
		},
		inputs: ["поговорить с тем, кому обещал", "отдать своё", "помочь"],
	},
	{
		id: "чужой мир",
		why: "сеттинг, которого движок не знает: вкус должен определиться общим слоем, а не упасть",
		build: (b) => {
			const s = withPreset(b, "balanced")
			s.meta.setting = "Орбитальный комплекс «Тишина», третий год консервации"
			s.meta.currency = "паёк"
			s.economy.anchors = { "еда на день": 2, "смена в шлюзе": 9, "инструмент": 50 }
			s.scene.location = "коридор жилого сектора"
			return s
		},
		inputs: ["осмотреться", "поговорить с тем, кто рядом", "починить то, что сломано", "взяться за работу"],
	},
]

export type GoldenIssue = { case: string; turn: number; code: string; detail: string }

export type GoldenReport = {
	turns: number
	cases: {
		id: string
		why: string
		turns: number
		/** Требований выдано и сколько из них рассказчик отработал в тот же ход. */
		directivesIssued: number
		directivesAnswered: number
		rejections: number
		outcomes: Record<string, number>
		finalAudit: string[]
		dead: boolean
	}[]
	issues: GoldenIssue[]
	ok: boolean
}

/** Требования, которые рассказчик закрывает своей дельтой, а не мир своим ходом. */
function answersDirective(code: string, delta: Delta, subject?: string): boolean {
	switch (code) {
		case "consequence_due":
			return (delta.consequences?.fire ?? []).includes(subject ?? "")
		case "front_ready":
		case "front_date_due":
			return (delta.fronts ?? []).some((f) => f.name === subject && f.progressStep > 0)
		case "unknowns_stale":
			return (delta.unknowns?.add ?? []).length > 0
		// Просрочку и истёкший крючок закрывает не рассказчик, а игрок или сам мир:
		// от рассказчика тут требуется отыграть их в прозе, что проверяется отдельно.
		default:
			return true
	}
}

const DIGITS = /\d/

export function runGolden(
	narrator: GoldenNarrator,
	baseState: State,
	turnsPerCase = 6,
	cases: GoldenCase[] = GOLDEN_CASES,
): GoldenReport {
	const issues: GoldenIssue[] = []
	const report: GoldenReport["cases"] = []
	let total = 0

	for (const gc of cases) {
		let state = gc.build(clone(baseState))
		let memory: NarratorMemory | null = null
		let facts: EngineFact[] = []
		const outcomes: Record<string, number> = {}
		let issued = 0
		let answered = 0
		let rejections = 0
		const seenProse = new Set<string>()
		const nameDigits = DIGITS.test(`${state.scene.location}${state.meta.setting}${state.meta.currency}`)

		for (let i = 0; i < turnsPerCase; i += 1) {
			if (state.dead) break
			const input = gc.inputs[i % gc.inputs.length]
			const directives = calendarPressure(state)
			const before = clone(state)
			let out: ReturnType<GoldenNarrator>
			try {
				out = narrator({ state, input, directives, facts, memory })
			} catch (e) {
				issues.push({
					case: gc.id,
					turn: state.clock.turn,
					code: "рассказчик упал",
					detail: e instanceof Error ? e.message : String(e),
				})
				break
			}
			memory = out.memory ?? memory
			total += 1

			if (!out.prose.trim()) {
				issues.push({ case: gc.id, turn: state.clock.turn, code: "пустая проза", detail: input })
			}
			if (!nameDigits && DIGITS.test(out.prose)) {
				issues.push({
					case: gc.id,
					turn: state.clock.turn,
					code: "цифра в прозе",
					detail: out.prose.slice(0, 120),
				})
			}
			if (seenProse.has(out.prose)) {
				issues.push({ case: gc.id, turn: state.clock.turn, code: "проза повторилась дословно", detail: input })
			}
			seenProse.add(out.prose)
			if (!out.delta.time || !(out.delta.time.minutes || out.delta.time.days)) {
				issues.push({ case: gc.id, turn: state.clock.turn, code: "время не сдвинуто", detail: input })
			}
			for (const d of directives) {
				issued += 1
				if (answersDirective(d.code, out.delta, d.subject)) answered += 1
				else {
					issues.push({
						case: gc.id,
						turn: state.clock.turn,
						code: "требование движка не отработано",
						detail: `${d.code}: ${d.text.slice(0, 90)}`,
					})
				}
			}

			const r = applyDelta(state, out.delta)
			const bad = r.facts.filter((f) => f.kind === "rejection")
			rejections += bad.length
			for (const f of bad) {
				issues.push({ case: gc.id, turn: state.clock.turn, code: `отклонено: ${f.code}`, detail: f.text })
			}
			if (r.state.clock.turn !== before.clock.turn + 1) {
				issues.push({ case: gc.id, turn: state.clock.turn, code: "ход не увеличился", detail: input })
			}
			const outcome = out.trace?.match(/исход: ([^(·]+)/)?.[1]?.trim() ?? "неизвестно"
			outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
			state = r.state
			facts = r.facts.filter((f) => f.forModel)
		}

		report.push({
			id: gc.id,
			why: gc.why,
			turns: state.clock.turn,
			directivesIssued: issued,
			directivesAnswered: answered,
			rejections,
			outcomes,
			finalAudit: audit(state),
			dead: state.dead,
		})
	}

	return { turns: total, cases: report, issues, ok: issues.length === 0 }
}

export function formatGoldenReport(r: GoldenReport): string {
	const out: string[] = []
	out.push(`Эталонный прогон: ${r.cases.length} состояний, ${r.turns} ходов`)
	out.push("")
	for (const c of r.cases) {
		const answered = c.directivesIssued ? `${c.directivesAnswered}/${c.directivesIssued}` : "—"
		out.push(`• ${c.id} — ${c.why}`)
		out.push(
			`  ходов ${c.turns} · требований отработано ${answered} · отклонений ${c.rejections}${c.dead ? " · персонаж мёртв" : ""}`,
		)
		const dist = Object.entries(c.outcomes)
			.map(([k, v]) => `${k} ${v}`)
			.join(", ")
		if (dist) out.push(`  исходы: ${dist}`)
		if (c.finalAudit.length) out.push(`  сверка: ${c.finalAudit.join("; ")}`)
	}
	out.push("")
	if (r.ok) out.push("Замечаний нет.")
	else {
		out.push(`Замечаний: ${r.issues.length}`)
		for (const i of r.issues.slice(0, 40)) out.push(`  ✗ [${i.case}, ход ${i.turn}] ${i.code} — ${i.detail}`)
	}
	return out.join("\n")
}
