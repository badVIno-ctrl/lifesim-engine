// Регрессия ядра v13. Все 25 исходных проверок сохранены.
// Изменены только две и только там, где этого требует техзадание (пункты A и B) — см. REPORT.md.
import test from "node:test"
import assert from "node:assert/strict"
import { LIMITS, applyDelta, audit, clone } from "../src/engine.ts"
import { parseTurn } from "../src/session.ts"
import { base, firstFront, firstNpc, hasCode } from "./helpers.ts"

test("время и счётчик ходов двигаются движком", () => {
	const s0 = base()
	const { state } = applyDelta(s0, { time: { minutes: 90 }, channel: "звук" })
	assert.equal(state.clock.turn, s0.clock.turn + 1)
	assert.equal(state.clock.minuteOfDay, (s0.clock.minuteOfDay + 90) % 1440)
})

test("макро-тик в днях перекатывает сутки", () => {
	const s0 = base()
	const { state } = applyDelta(s0, { time: { days: 2 }, channel: "зрение" })
	assert.equal(state.clock.day, s0.clock.day + 2)
})

test("деньги считает движок", () => {
	const s0 = base()
	const { state } = applyDelta(s0, {
		time: { minutes: 5 },
		channel: "зрение",
		money: { delta: -20, reason: "задаток" },
	})
	assert.equal(state.money, s0.money - 20)
})

// ИЗМЕНЁН (A): отклонение теперь — факт с кодом, а не строка «недостаточно средств».
test("касса не уходит в минус", () => {
	const s0 = base()
	const { state, facts } = applyDelta(s0, {
		time: { minutes: 5 },
		channel: "зрение",
		money: { delta: -100000 },
	})
	assert.equal(state.money, s0.money)
	assert.ok(hasCode(facts, "money_insufficient"))
})

test("отношение NPC двигается не больше чем на ступень", () => {
	const s0 = base()
	const name = firstNpc()
	const before = s0.npcs[0].attitude
	const { state, warnings } = applyDelta(s0, {
		time: { minutes: 10 },
		channel: "звук",
		npc: [{ name, attitudeStep: -3, reason: "скандал" }],
	})
	assert.equal(state.npcs.find((n) => n.name === name)!.attitude, Math.max(0, before - 1))
	assert.ok(warnings.some((w) => w.includes("одной ступени")))
})

test("стресс копится сегментами и переходит уровень", () => {
	const s0 = base()
	s0.condition.stress = { level: 1, segments: 3 }
	const { state } = applyDelta(s0, {
		time: { minutes: 10 },
		channel: "тело",
		stress: { segments: 2, reason: "погоня" },
	})
	assert.equal(state.condition.stress.level, 2)
	assert.equal(state.condition.stress.segments, 0)
})

test("стресс не перепрыгивает более одного уровня за ход", () => {
	const s0 = base()
	s0.condition.stress = { level: 0, segments: 4 }
	const { state } = applyDelta(s0, { time: { minutes: 10 }, channel: "тело", stress: { segments: 3 } })
	assert.equal(state.condition.stress.level, 1)
})

test("фронт не двигается без выполненного условия", () => {
	const s0 = base()
	const name = firstFront()
	const before = s0.fronts[0].progress
	const { state, warnings } = applyDelta(s0, {
		time: { minutes: 10 },
		channel: "зрение",
		fronts: [{ name, progressStep: 1 }],
	})
	assert.equal(state.fronts.find((f) => f.name === name)!.progress, before)
	assert.ok(warnings.some((w) => w.includes("условие продвижения")))
})

test("фронт двигается при подтверждённом условии", () => {
	const s0 = base()
	const name = firstFront()
	const before = s0.fronts[0].progress
	const { state } = applyDelta(s0, {
		time: { minutes: 10 },
		channel: "зрение",
		fronts: [{ name, progressStep: 1, advanceConditionMet: true, justification: "свидетель" }],
	})
	assert.equal(state.fronts.find((f) => f.name === name)!.progress, Math.min(5, before + 1))
})

test("крючок засыпает по истечении окна", () => {
	let s = base()
	s.hooks = [{ text: "след сапога у люка", sownTurn: s.clock.turn, window: 3 }]
	for (let i = 0; i < 4; i++) {
		s = applyDelta(s, { time: { minutes: 30 }, channel: i % 2 ? "звук" : "зрение" }).state
	}
	assert.ok(s.hooks[0].sleeping)
})

test("последствие созревает через своё окно", () => {
	let s = applyDelta(base(), {
		time: { minutes: 10 },
		channel: "зрение",
		consequences: { add: [{ what: "гильдия узнаёт", cause: "свидетель", window: 2 }] },
	}).state
	let due: string[] = []
	for (let i = 0; i < 2; i++) {
		const r = applyDelta(s, { time: { minutes: 10 }, channel: i % 2 ? "звук" : "тело" })
		s = r.state
		due = r.due.consequences.map((c) => c.what)
	}
	assert.ok(due.includes("гильдия узнаёт"))
})

test("терминал требует установленной причины", () => {
	const { state, warnings } = applyDelta(base(), {
		time: { minutes: 1 },
		channel: "тело",
		terminal: { kind: "death", cause: "так вышло" },
	})
	assert.equal(state.dead, false)
	assert.ok(warnings.some((w) => w.includes("терминал отклонён")))
})

test("терминал принимается при смертельной кровопотере", () => {
	const s0 = base()
	s0.condition.bleed = 3
	const { state } = applyDelta(s0, {
		time: { minutes: 1 },
		channel: "тело",
		terminal: { kind: "death", cause: "кровопотеря без помощи" },
	})
	assert.equal(state.dead, true)
})

// ИЗМЕНЁН (B): было «веха и озарение требуют критерия». Шкалы озарения больше нет,
// проверка критерия перелома живёт в test/engine.v14.test.ts.
test("веха требует критерия из списка", () => {
	const s0 = base()
	const r = applyDelta(s0, {
		time: { minutes: 1 },
		channel: "тело",
		milestone: { granted: true, criterion: "просто так" },
	})
	assert.equal(r.state.milestones, s0.milestones)
	assert.ok(hasCode(r.facts, "milestone_criterion"))
	assert.ok(r.warnings.some((w) => w.includes("критерий")))
})

test("веха с верным критерием засчитывается", () => {
	const s0 = base()
	const { state } = applyDelta(s0, {
		time: { minutes: 1 },
		channel: "тело",
		milestone: { granted: true, criterion: "fear" },
	})
	assert.equal(state.milestones, s0.milestones + 1)
})

test("рост навыка без обоснования отклоняется", () => {
	const s0 = base()
	const skill = s0.skills[0]
	const { state, warnings } = applyDelta(s0, {
		time: { minutes: 1 },
		channel: "тело",
		skills: [{ name: skill.name, step: 1 }],
	})
	assert.equal(state.skills.find((s) => s.name === skill.name)!.rank, skill.rank)
	assert.ok(warnings.some((w) => w.includes("justification")))
})

test("списание отсутствующего предмета невозможно", () => {
	const { warnings } = applyDelta(base(), {
		time: { minutes: 1 },
		channel: "тело",
		inventory: { remove: [{ name: "арбалет-призрак" }] },
	})
	assert.ok(warnings.some((w) => w.includes("отсутствующий предмет")))
})

test("три одинаковых канала подряд дают предупреждение", () => {
	let s = base()
	s.channelHistory = []
	let last
	for (let i = 0; i < 3; i++) {
		last = applyDelta(s, { time: { minutes: 5 }, channel: "зрение" })
		s = last.state
	}
	assert.ok(last!.warnings.some((w) => w.includes("ротация каналов")))
})

test("стартовое состояние проходит сверку", () => {
	assert.deepEqual(audit(base()), [])
	assert.ok(base().fronts.length <= LIMITS.fronts)
})

test("unknowns добавляются и закрываются", () => {
	const s0 = base()
	const existing = s0.unknowns[0]
	const { state } = applyDelta(s0, {
		time: { minutes: 1 },
		channel: "запах",
		unknowns: { add: ["кто платит человеку в сером"], resolve: existing ? [existing] : [] },
	})
	assert.ok(state.unknowns.includes("кто платит человеку в сером"))
	if (existing) assert.ok(!state.unknowns.includes(existing))
})

test("parseTurn разделяет прозу и дельту", () => {
	const { prose, delta } = parseTurn('Дождь идёт.\n<delta>{"time":{"minutes":5},"channel":"звук"}</delta>')
	assert.equal(prose, "Дождь идёт.")
	assert.equal(delta!.channel, "звук")
})

test("parseTurn сообщает об отсутствующей дельте", () => {
	const { delta, error } = parseTurn("Просто текст без блока.")
	assert.equal(delta, null)
	assert.ok(error)
})

test("превышение лимита крючков замечается", () => {
	const { warnings } = applyDelta(base(), {
		time: { minutes: 1 },
		channel: "зрение",
		hooks: { add: Array.from({ length: 9 }, (_, i) => ({ text: `крючок ${i}` })) },
	})
	assert.ok(warnings.some((w) => w.includes("лимит крючков")))
})

test("после смерти дельты отклоняются", () => {
	const s = base()
	s.dead = true
	const turnBefore = s.clock.turn
	const { state, warnings } = applyDelta(s, { time: { minutes: 10 }, channel: "звук" })
	assert.equal(state.clock.turn, turnBefore)
	assert.ok(warnings.some((w) => w.includes("мёртв")))
})

test("applyDelta детерминирован и не мутирует вход", () => {
	const s = base()
	const snapshot = clone(s)
	const a = applyDelta(s, { time: { minutes: 20 }, channel: "вкус", money: { delta: -5 } })
	const b = applyDelta(s, { time: { minutes: 20 }, channel: "вкус", money: { delta: -5 } })
	assert.deepEqual(s, snapshot)
	assert.deepEqual(a.state, b.state)
})
