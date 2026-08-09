// Спринт 2. Давление мира и цена ошибки: эскалация просрочки, шрам вместо смерти,
// гаснущие директивы, дрейф отношений по игровым дням.
import test from "node:test"
import assert from "node:assert/strict"
import { applyDelta, calendarPressure, directiveKey, normalizeState, overdueStageFor } from "../src/engine.ts"
import { presetById, pressureProfile } from "../src/tuning.ts"
import type { Delta, State } from "../src/types.ts"
import { base, factText, hasCode } from "./helpers.ts"

const tick = (s: State, extra: Delta = {}): State =>
	applyDelta(s, { time: { minutes: 30 }, channel: "звук", ...extra }).state

function withPreset(id: string): State {
	const s = base()
	s.tuning = presetById(id)!.values
	return normalizeState(s)
}

/* ─────────── 1. Эскалация просрочки тремя ступенями ─────────── */

test("ступень просрочки считается по дням и по настройке партии", () => {
	const harsh = pressureProfile(presetById("harsh")!.values)
	const calm = pressureProfile(presetById("calm")!.values)
	assert.equal(overdueStageFor(0, harsh), 0, "срок сегодня — это ещё не просрочка")
	assert.equal(overdueStageFor(1, harsh), 2, "в суровом мире первый же день — прямая угроза")
	assert.equal(overdueStageFor(2, harsh), 3, "на второй день мир действует сам")
	assert.equal(overdueStageFor(1, calm), 1)
	assert.equal(overdueStageFor(5, calm), 1)
	assert.equal(overdueStageFor(6, calm), 2)
	assert.equal(overdueStageFor(12, calm), 3)
	assert.equal(overdueStageFor(-3, calm), 0)
})

test("три ступени приходят по очереди, а не одной фразой", () => {
	let s = withPreset("balanced")
	s.obligations = [{ what: "долг Марте за комнату", amount: 40, dueDay: 2 }]
	s.clock.day = 3
	s.npcs[0].name = "Марта"

	const seen: number[] = []
	for (let day = 3; day <= 9; day += 1) {
		s.clock.day = day
		const r = applyDelta(s, { time: { minutes: 10 }, channel: "тело" })
		s = r.state
		const stage = s.obligations[0]?.stage ?? 0
		if (!seen.includes(stage) && stage > 0) seen.push(stage)
	}
	assert.deepEqual(seen, [1, 2, 3], "косвенный сигнал, потом угроза, потом мир сам")
})

test("в спокойном мире мир терпит дольше, чем в суровом", () => {
	const make = (preset: string): State => {
		const s = withPreset(preset)
		s.obligations = [{ what: "долг Марте за комнату", amount: 40, dueDay: 2 }]
		s.clock.day = 4
		return s
	}
	const calm = applyDelta(make("calm"), { time: { minutes: 5 }, channel: "тело" }).state
	const harsh = applyDelta(make("harsh"), { time: { minutes: 5 }, channel: "тело" }).state
	assert.equal(calm.obligations[0].stage, 1)
	assert.equal(harsh.obligations[0].stage, 3)
})

test("на третьей ступени мир действует сам: последствие, прецедент, отношение", () => {
	const s = withPreset("harsh")
	s.obligations = [{ what: "долг Марте за комнату", amount: 40, dueDay: 1 }]
	s.clock.day = 5
	// День контакта — сегодняшний: проверяем эскалацию, а не дрейф отношений.
	s.npcs = [{ name: "Марта", attitude: 4, lastContactTurn: 0, lastContactDay: 5, promises: [] }]
	const r = applyDelta(s, { time: { minutes: 5 }, channel: "тело" })
	assert.ok(hasCode(r.facts, "overdue_world_acts"))
	assert.match(factText(r.facts, "overdue_world_acts"), /Марта/)
	assert.equal(r.state.npcs[0].attitude, 3, "кредитор больше не расположен")
	assert.ok(r.state.consequences.some((c) => c.what.includes("расплата")))
	assert.ok(r.state.precedents.some((p) => p.includes("не стал ждать")))
})

test("ступень не откатывается назад и не выдаётся дважды", () => {
	let s = withPreset("balanced")
	s.obligations = [{ what: "долг Кольбу", dueDay: 1 }]
	s.clock.day = 8
	const first = applyDelta(s, { time: { minutes: 5 }, channel: "тело" })
	s = first.state
	assert.equal(s.obligations[0].stage, 3)
	const second = applyDelta(s, { time: { minutes: 5 }, channel: "тело" })
	assert.ok(!hasCode(second.facts, "overdue_world_acts"), "второй раз мир не объявляет то же самое")
	assert.equal(second.state.consequences.filter((c) => c.what.includes("расплата")).length, 1)
})

test("директива просрочки называет ступень, а не повторяет одну фразу", () => {
	const s = withPreset("balanced")
	s.obligations = [{ what: "долг Марте", dueDay: 1 }]
	s.clock.day = 4
	const text = factText(calendarPressure(s), "obligation_overdue")
	assert.match(text, /Ступень 2 из 3/)
	assert.match(text, /требует вслух/)
})

/* ─────────── 2. Шрам вместо смерти ─────────── */

test("правило «шрам»: персонаж выживает, но платит необратимо", () => {
	const s = withPreset("calm")
	s.condition.bleed = 3
	s.condition.wounds = [{ zone: "левая кисть", rank: 3 }]
	const r = applyDelta(s, {
		time: { minutes: 5 },
		channel: "тело",
		terminal: { kind: "death", cause: "кровопотеря без помощи" },
	})
	assert.equal(r.state.dead, false, "партия продолжается")
	assert.equal(r.state.scars.length, 1)
	assert.match(r.state.scars[0].what, /левая кисть/)
	assert.ok(hasCode(r.facts, "scar_instead_of_death"))
	assert.match(factText(r.facts, "scar_instead_of_death"), /цену спасения/)
	assert.ok(r.state.precedents.some((p) => p.includes("увечьем")))
	assert.ok(r.state.condition.bleed < 3, "смертельной причины в теле больше нет")
	assert.ok(r.state.condition.wounds.every((w) => w.rank < 3))
})

test("шрам не лечится: ни дельта, ни нормализация его не убирают", () => {
	let s = withPreset("calm")
	s.condition.health = 3
	s = applyDelta(s, {
		time: { minutes: 5 },
		channel: "тело",
		terminal: { kind: "death", cause: "истощение" },
	}).state
	assert.equal(s.scars.length, 1)
	const scar = s.scars[0]

	// Всё, чем в принципе можно что-то убрать из состояния.
	s = tick(s, {
		health: { step: -1, cause: "отлежался" },
		wounds: [{ zone: "левая кисть", step: -1 }],
		effects: { remove: [scar.what] },
		inventory: { remove: [{ name: scar.what }] },
	}).valueOf() as State
	assert.equal(s.scars.length, 1)
	assert.deepEqual(s.scars[0], scar)
	assert.equal(normalizeState(s).scars.length, 1)
})

test("правило «смерть» работает как раньше", () => {
	const s = withPreset("balanced")
	s.condition.bleed = 3
	const r = applyDelta(s, {
		time: { minutes: 5 },
		channel: "тело",
		terminal: { kind: "death", cause: "кровопотеря" },
	})
	assert.equal(r.state.dead, true)
	assert.equal(r.state.scars.length, 0)
})

test("без установленной причины шрам тоже не выдаётся", () => {
	const s = withPreset("calm")
	const r = applyDelta(s, {
		time: { minutes: 5 },
		channel: "тело",
		terminal: { kind: "death", cause: "просто так" },
	})
	assert.equal(r.state.scars.length, 0)
	assert.equal(r.state.dead, false)
	assert.ok(hasCode(r.facts, "terminal_no_cause"))
})

/* ─────────── 3. Директивы гаснут ─────────── */

test("журнал директив пишет выдачу и отметку о выполнении", () => {
	let s = withPreset("balanced")
	s.obligations = [{ what: "долг Марте", amount: 10, dueDay: 1 }]
	s.clock.day = 1
	s = tick(s)
	const key = directiveKey({ code: "obligation_due", subject: "долг Марте" })
	const issuedRec = s.directiveLog.find((r) => r.key === key)
	assert.ok(issuedRec, "требование записано")
	assert.equal(issuedRec!.attempts, 1)
	assert.equal(issuedRec!.satisfiedTurn, null)

	s = tick(s, { obligations: { settle: ["долг Марте"] } })
	const done = s.directiveLog.find((r) => r.key === key)
	assert.ok(done && done.satisfiedTurn !== null, "выполнение отмечено")
})

test("неотработанная директива гаснет, и движок перестаёт её требовать", () => {
	let s = withPreset("balanced")
	const patience = pressureProfile(s.tuning).directivePatience
	s.lastUnknownAddTurn = -s.tuning.unknownsPatience
	let retired = false
	for (let i = 0; i < patience + 1; i += 1) {
		const r = applyDelta(s, { time: { minutes: 10 }, channel: "зрение" })
		s = r.state
		if (hasCode(r.facts, "directive_retired")) retired = true
	}
	assert.ok(retired, "движок сам снял требование")
	const rec = s.directiveLog.find((r) => r.code === "unknowns_stale")
	assert.ok(rec && rec.retiredTurn !== null)
	assert.ok(
		!hasCode(calendarPressure(s).map((d) => ({ code: d.code, text: d.text })), "unknowns_stale"),
		"снятая директива молчит",
	)
})

test("снятая директива возвращается после остывания — вопрос не забыт", () => {
	let s = withPreset("balanced")
	const patience = pressureProfile(s.tuning).directivePatience
	s.lastUnknownAddTurn = -s.tuning.unknownsPatience
	for (let i = 0; i < patience; i += 1) s = tick(s)
	assert.ok(s.directiveLog.some((r) => r.code === "unknowns_stale" && r.retiredTurn !== null))
	for (let i = 0; i < patience + 1; i += 1) s = tick(s)
	assert.ok(
		calendarPressure(s).some((d) => d.code === "unknowns_stale"),
		"мир снова спрашивает",
	)
})

test("в суровом мире терпения меньше, чем в спокойном", () => {
	const count = (preset: string): number => {
		let s = withPreset(preset)
		s.lastUnknownAddTurn = -s.tuning.unknownsPatience
		let turns = 0
		for (let i = 0; i < 12; i += 1) {
			const r = applyDelta(s, { time: { minutes: 10 }, channel: "зрение" })
			s = r.state
			turns += 1
			if (r.facts.some((f) => f.code === "directive_retired")) break
		}
		return turns
	}
	assert.ok(count("harsh") < count("calm"))
})

/* ─────────── 4. Дрейф отношений по игровым дням ─────────── */

test("отношение остывает по дням, а не по числу ходов", () => {
	const s = withPreset("balanced")
	s.npcs = [{ name: "Марта", attitude: 5, lastContactTurn: 0, lastContactDay: 1, promises: [] }]
	s.clock.day = 1

	// Сорок коротких ходов в один день — отношение не двигается.
	let many = s
	for (let i = 0; i < 40; i += 1) many = tick(many, { time: { minutes: 1 } })
	assert.equal(many.npcs[0].attitude, 5, "болтовня в один день ничего не остужает")

	// Один ход длиной в неделю — двигается.
	const long = applyDelta(s, { time: { days: 7 }, channel: "тело" })
	assert.equal(long.state.npcs[0].attitude, 4)
	assert.ok(hasCode(long.facts, "attitude_drift"))
	assert.match(factText(long.facts, "attitude_drift"), /дн\./)
})

test("порог остывания берётся из настройки партии", () => {
	const make = (preset: string): State => {
		const s = withPreset(preset)
		s.npcs = [{ name: "Кольб", attitude: 1, lastContactTurn: 0, lastContactDay: 1, promises: [] }]
		return s
	}
	const after = (preset: string): number =>
		applyDelta(make(preset), { time: { days: 4 }, channel: "тело" }).state.npcs[0].attitude
	assert.equal(after("calm"), 1, "спокойный мир помнит дольше")
	assert.equal(after("harsh"), 2, "суровый мир забывает быстрее")
})

test("контакт обновляет и день, и ход", () => {
	const s = withPreset("balanced")
	s.clock.day = 10
	const r = applyDelta(s, {
		time: { minutes: 20 },
		channel: "звук",
		npc: [{ name: s.npcs[0].name, attitudeStep: 1, reason: "помог с бумагами" }],
	})
	const npc = r.state.npcs.find((n) => n.name === s.npcs[0].name)!
	assert.equal(npc.lastContactDay, 10)
	assert.equal(npc.lastContactTurn, r.state.clock.turn)
})
