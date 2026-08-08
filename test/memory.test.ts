// Память мира: после сжатия истории должны выжить нить, долги и лица с причинами.
import { test } from "node:test"
import assert from "node:assert/strict"
import { applyDelta } from "../src/engine.ts"
import { renderDigest } from "../src/render.ts"
import { base } from "./helpers.ts"

test("причина изменения отношения остаётся в состоянии, а не только в прозе", () => {
	const r = applyDelta(base(), {
		time: { minutes: 10 },
		npc: [{ name: "Ганс", attitudeStep: -1, reason: "ты не пришёл на встречу у пристани" }],
	})
	const npc = r.state.npcs.find((n) => n.name === "Ганс")
	assert.ok(npc)
	assert.equal(npc!.lastReason, "ты не пришёл на встречу у пристани")
	assert.equal(npc!.lastReasonTurn, r.state.clock.turn)
})

test("дайджест помнит нить, долги и почему на тебя так смотрят", () => {
	const s = base()
	s.goals = ["выкупить закладную на мастерскую"]
	s.obligations = [{ what: "долг ростовщику", amount: 40, dueDay: 9 }]
	s.npcs = [
		{
			name: "Ганс",
			attitude: 1,
			lastContactTurn: 0,
			promises: ["принести инструмент до субботы"],
			lastReason: "ты врал про цену железа",
			lastReasonTurn: 4,
		},
	]
	s.clock.turn = 28
	s.ledger = [{ turn: 27, text: "отдал половину долга" }]

	const d = renderDigest(s)
	assert.match(d, /Нить: .*закладную/)
	assert.match(d, /Долги и обещания: .*ростовщику/)
	assert.match(d, /обещано Ганс: принести инструмент/)
	assert.match(d, /Ганс: .*потому что ты врал про цену железа/)
	assert.match(d, /молчание 28 ходов/)
	assert.match(d, /отдал половину долга/)
})

test("пустая нить — это задание модели, а не прочерк", () => {
	const s = base()
	s.goals = []
	s.fronts = []
	s.npcs = []
	s.obligations = []
	const d = renderDigest(s)
	assert.match(d, /Нить: не заявлена/)
	assert.match(d, /ничего не висит/)
})
