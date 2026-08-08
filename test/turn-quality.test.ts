// Тесты на правки качества хода: стрим без служебного JSON, громкое no_time,
// неспамящий front_ready и экспорт, который не засоряет ленту.
import { test } from "node:test"
import assert from "node:assert/strict"
import { createProseStreamer } from "../src/llm.ts"
import { applyDelta, calendarPressure } from "../src/engine.ts"
import { Session, createGameRecord, exportFileName } from "../src/session.ts"
import { createMemoryStorage } from "../src/storage/memory.ts"
import { base, factText, fakeLlm, hasCode, reply } from "./helpers.ts"

const PROMPTS = { core: "CORE", schema: "SCHEMA" }

function collect(pieces: string[]): string {
	let out = ""
	const push = createProseStreamer((c) => {
		out += c
	})
	for (const p of pieces) push(p)
	return out
}

test("в ленту течёт только проза, а не сырой JSON схемы", () => {
	const text = collect(['{"pro', 'se": "Туман ', "лежит на гавани", '.", "delta": {"time": {"minutes": 30}}}'])
	assert.equal(text, "Туман лежит на гавани.")
})

test("кавычки и переносы раскодируются, даже если кусок оборван посреди escape", () => {
	const text = collect(['{"prose": "Он сказал \\', '"да\\" и ушёл.\\', 'nДверь хлопнула.", "delta": {}}'])
	assert.equal(text, 'Он сказал "да" и ушёл.\nДверь хлопнула.')
})

test("после конца прозы в ленту не попадает ни символа", () => {
	const text = collect(['{"prose": "Два слова.", "delta": {"money": ', '{"delta": -5}}}'])
	assert.equal(text, "Два слова.")
	assert.ok(!text.includes("delta"))
})

test("дельта без time — громкий факт для модели, а не тишина", () => {
	const r = applyDelta(base(), { channel: "звук" })
	const fact = r.facts.find((f) => f.code === "no_time")
	assert.ok(fact, "факт no_time должен быть")
	assert.equal(fact!.forModel, true)
	assert.match(fact!.text, /time\.minutes/)
})

test("разрешённый фронт больше не требует шага каждый ход", () => {
	const s = base()
	s.fronts[0].progress = 4
	assert.ok(hasCode(calendarPressure(s), "front_ready"))
	assert.match(factText(calendarPressure(s), "front_ready"), /пороге/)

	s.fronts[0].progress = 5
	assert.ok(!hasCode(calendarPressure(s), "front_ready"))
})

test("экспорт отдаёт короткую квитанцию, а не дамп в ленту", async () => {
	const storage = createMemoryStorage()
	const record = createGameRecord({
		id: "g1",
		title: "Ринген: первая зима",
		packId: "ringen",
		state: base(),
	})
	await storage.saveGame(record)
	const { call } = fakeLlm([reply("Сцена.", { time: { minutes: 10 } })])
	const session = new Session({ record, storage, prompts: PROMPTS, llm: call })

	const out = await session.turn("((экспорт))")
	const text = out.entries[0].text
	assert.ok(!text.includes('"transcript"'), "дамп в ленте недопустим")
	assert.ok(text.length < 200)
	assert.match(text, /КБ/)
	assert.match(text, /\.json/)
	// Сам JSON по-прежнему доступен — его берёт экран и сохраняет файлом.
	assert.ok(JSON.parse(session.exportJson()).state)
})

test("имя файла экспорта читаемо и без мусора", () => {
	assert.equal(exportFileName("Ринген: первая зима", 12), "ринген-первая-зима-ход-12.json")
	assert.equal(exportFileName("   ", 0), "sim-ход-0.json")
})
