// Новая логика ядра: пункты A, B, D, E, F.
// Каждый тест подписан буквой требования.
import test from "node:test"
import assert from "node:assert/strict"
import {
	REVELATION_COOLDOWN,
	UNKNOWNS_REMINDER_AFTER,
	applyDelta,
	audit,
	calendarPressure,
	normalizeState,
} from "../src/engine.ts"
import { renderEngineBlock, renderStateForModel } from "../src/render.ts"
import { base, factText, firstFront, hasCode } from "./helpers.ts"

/* ─────────────────── A. Отклонённая правка — событие мира ─────────────────── */

test("A: нехватка денег становится фактом с числами и уходит модели", () => {
	const s0 = base()
	const r = applyDelta(s0, { time: { minutes: 5 }, channel: "зрение", money: { delta: -(s0.money + 2) } })
	const f = r.facts.find((x) => x.code === "money_insufficient")!
	assert.ok(f, "факт money_insufficient обязателен")
	assert.equal(f.kind, "rejection")
	assert.equal(f.forModel, true)
	assert.ok(f.text.includes(String(s0.money)))
	assert.ok(f.text.includes(String(s0.money + 2)))
	assert.equal(r.state.money, s0.money)
})

test("A: факты для модели рендерятся как [движок: …] и запрещают переписывание прошлого", () => {
	const r = applyDelta(base(), {
		time: { minutes: 5 },
		channel: "зрение",
		money: { delta: -100000 },
	})
	const block = renderEngineBlock(
		r.facts.filter((f) => f.forModel),
		[],
	)
	assert.ok(block.includes("[движок: денег не хватило"))
	assert.ok(block.includes("не переписывай прошлое"))
})

test("A: урезание по лестнице не засоряет контекст модели", () => {
	const s0 = base()
	const r = applyDelta(s0, {
		time: { minutes: 5 },
		channel: "звук",
		npc: [{ name: s0.npcs[0].name, attitudeStep: -3, reason: "скандал" }],
	})
	const clampFact = r.facts.find((f) => f.code === "one_step")!
	assert.equal(clampFact.kind, "clamp")
	assert.equal(clampFact.forModel, false)
	assert.equal(renderEngineBlock(r.facts.filter((f) => f.forModel), []).includes("одной ступени"), false)
})

test("A: отклонённая правка не отменяет весь ход: остальное применяется", () => {
	const s0 = base()
	const r = applyDelta(s0, {
		time: { minutes: 30 },
		channel: "звук",
		money: { delta: -100000 },
		fatigue: { step: 1 },
	})
	assert.equal(r.state.clock.turn, s0.clock.turn + 1)
	assert.equal(r.state.condition.fatigue, s0.condition.fatigue + 1)
	assert.equal(r.state.money, s0.money)
})

test("A: отклонения попадают в журнал мира", () => {
	const r = applyDelta(base(), {
		time: { minutes: 5 },
		channel: "зрение",
		inventory: { remove: [{ name: "арбалет-призрак" }] },
	})
	assert.ok(r.state.ledger.some((l) => l.text.includes("отсутствующий предмет")))
})

/* ─────────────────── B. Озарения нет, есть редкий перелом ─────────────────── */

test("B: в состоянии нет поля insight даже после импорта старой сохранёнки 13.0", () => {
	const legacy = { ...base(), version: "13.0", insight: { level: 2, segments: 3 } }
	const s = normalizeState(legacy)
	assert.equal(s.version, "13.1")
	assert.equal("insight" in (s as Record<string, unknown>), false)
	assert.equal(JSON.stringify(s).includes("insight"), false)
	assert.ok(Array.isArray(s.revelations))
})

test("B: перелом требует критерия из списка", () => {
	const r = applyDelta(base(), {
		time: { minutes: 1 },
		channel: "тело",
		revelation: { criterion: "красивая сцена" as never, what: "осознал что-то" },
	})
	assert.ok(hasCode(r.facts, "revelation_criterion"))
	assert.equal(r.state.revelations.length, 0)
})

test("B: перелом пишется в журнал и один раз отдаётся модели как пометка", () => {
	const r = applyDelta(base(), {
		time: { minutes: 1 },
		channel: "тело",
		revelation: { criterion: "near_death", what: "нож прошёл в пальце от горла" },
	})
	assert.equal(r.state.revelations.length, 1)
	assert.equal(r.state.revelations[0].criterion, "near_death")
	assert.ok(r.state.ledger.some((l) => l.text.startsWith("перелом (near_death)")))
	const f = r.facts.find((x) => x.code === "revelation")!
	assert.equal(f.kind, "event")
	assert.equal(f.forModel, true)
	// Пометка не даёт никаких чисел: шкалы больше нет.
	assert.equal("insight" in (r.state as Record<string, unknown>), false)
})

test("B: второй перелом подряд отклоняется кодом, а не просьбой в промпте", () => {
	const first = applyDelta(base(), {
		time: { minutes: 1 },
		channel: "тело",
		revelation: { criterion: "model_broken", what: "стража и есть воры" },
	})
	const second = applyDelta(first.state, {
		time: { minutes: 1 },
		channel: "звук",
		revelation: { criterion: "own_failure_analyzed", what: "разобрал свой провал" },
	})
	assert.ok(hasCode(second.facts, "revelation_cooldown"))
	assert.equal(second.state.revelations.length, 1)
	assert.ok(factText(second.facts, "revelation_cooldown").includes(String(REVELATION_COOLDOWN)))
})

/* ─────────────────── D. Давление из календаря ─────────────────── */

test("D: наступивший срок обязательства становится директивой", () => {
	const s = base()
	s.obligations = [{ what: "долг Марте", amount: 40, dueDay: 4 }]
	s.clock.day = 4
	const due = calendarPressure(s)
	assert.ok(due.some((d) => d.code === "obligation_due"))
	s.clock.day = 6
	const late = calendarPressure(s)
	assert.ok(late.some((d) => d.code === "obligation_overdue"))
	assert.ok(late.find((d) => d.code === "obligation_overdue")!.text.includes("день 4"))
})

test("D: созревшее последствие и истёкший крючок — тоже директивы", () => {
	let s = applyDelta(base(), {
		time: { minutes: 10 },
		channel: "зрение",
		consequences: { add: [{ what: "гильдия узнаёт", cause: "свидетель", window: 1 }] },
	}).state
	s.hooks = [{ text: "след сапога", sownTurn: s.clock.turn, window: 1 }]
	s = applyDelta(s, { time: { minutes: 10 }, channel: "звук" }).state
	const pressure = calendarPressure(s)
	assert.ok(pressure.some((d) => d.code === "consequence_due"))
	assert.ok(pressure.some((d) => d.code === "hook_expired"))
})

test("D: директивы рендерятся как обязательные к отработке в этом ходу", () => {
	const s = base()
	s.clock.day = 9
	const block = renderEngineBlock([], calendarPressure(s))
	assert.ok(block.includes("обязательно отработать в этом ходу"))
})

test("D: calendarPressure чиста и детерминирована, мёртвый мир не давит", () => {
	const s = base()
	s.clock.day = 12
	assert.deepEqual(calendarPressure(s), calendarPressure(s))
	s.dead = true
	assert.deepEqual(calendarPressure(s), [])
})

/* ─────────────────── E. Фронты ─────────────────── */

test("E: продвижение без justification отклоняется отдельным кодом", () => {
	const s0 = base()
	const name = firstFront()
	const r = applyDelta(s0, {
		time: { minutes: 10 },
		channel: "зрение",
		fronts: [{ name, progressStep: 1, advanceConditionMet: true }],
	})
	assert.ok(hasCode(r.facts, "front_justification"))
	assert.equal(r.state.fronts.find((f) => f.name === name)!.progress, s0.fronts[0].progress)
})

test("E: неизвестный фронт не создаётся молча", () => {
	const r = applyDelta(base(), {
		time: { minutes: 10 },
		channel: "зрение",
		fronts: [{ name: "фронт-призрак", progressStep: 1, advanceConditionMet: true, justification: "так вышло" }],
	})
	assert.ok(hasCode(r.facts, "front_unknown"))
	assert.equal(r.state.fronts.length, base().fronts.length)
})

test("E: календарная дата фронта сама требует шага мира", () => {
	const s = base()
	const dated = s.fronts.find((f) => typeof f.advanceOnDay === "number")!
	assert.ok(dated, "в паке есть фронт с датой")
	s.clock.day = dated.advanceOnDay as number
	const pressure = calendarPressure(s)
	const hit = pressure.find((d) => d.code === "front_date_due")!
	assert.ok(hit)
	assert.ok(hit.text.includes(dated.name))
})

/* ─────────────────── F. Реестр неустановленного ─────────────────── */

test("F: после 10 ходов без новых вопросов движок сам напоминает", () => {
	let s = base()
	const channels = ["зрение", "звук", "тело"] as const
	for (let i = 0; i < UNKNOWNS_REMINDER_AFTER; i++) {
		s = applyDelta(s, { time: { minutes: 10 }, channel: channels[i % 3] }).state
	}
	const pressure = calendarPressure(s)
	assert.ok(pressure.some((d) => d.code === "unknowns_stale"))
})

test("F: добавленный вопрос сбрасывает напоминание", () => {
	let s = base()
	const channels = ["зрение", "звук", "тело"] as const
	for (let i = 0; i < UNKNOWNS_REMINDER_AFTER; i++) {
		s = applyDelta(s, { time: { minutes: 10 }, channel: channels[i % 3] }).state
	}
	s = applyDelta(s, {
		time: { minutes: 10 },
		channel: "запах",
		unknowns: { add: ["чей голос был за дверью"] },
	}).state
	assert.equal(s.lastUnknownAddTurn, s.clock.turn)
	assert.equal(calendarPressure(s).some((d) => d.code === "unknowns_stale"), false)
})

test("F: пустой реестр — дефект мира, сверка это видит", () => {
	const s = base()
	s.unknowns = []
	assert.ok(audit(s).includes("реестр неустановленного пуст"))
})

test("F: реестр всегда есть в компактном рендере для модели", () => {
	const text = renderStateForModel(base())
	assert.ok(text.includes("Неустановленное (не давать ответов)"))
	assert.ok(text.includes(base().unknowns[0]))
})
