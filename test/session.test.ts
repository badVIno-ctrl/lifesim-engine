// Контур хода: пункты A, C, G, H, J.
import test from "node:test"
import assert from "node:assert/strict"
import { HISTORY_TAIL, SNAPSHOT_EVERY } from "../src/engine.ts"
import { LlmError } from "../src/llm.ts"
import { Session, createGameRecord, isLocalCommand } from "../src/session.ts"
import { createMemoryStorage } from "../src/storage/memory.ts"
import { base, fakeLlm, reply } from "./helpers.ts"
import type { LlmCaller } from "../src/llm.ts"
import type { Storage } from "../src/storage/types.ts"

const PROMPTS = { core: "CORE-ТЕКСТ", schema: "SCHEMA-ТЕКСТ" }

function makeSession(llm: LlmCaller): { session: Session; storage: Storage } {
	const storage = createMemoryStorage()
	const record = createGameRecord({
		id: "g1",
		title: "тест",
		packId: "grauberg",
		state: base(),
		now: 1000,
	})
	let t = 1000
	let n = 0
	const session = new Session({
		record,
		storage,
		prompts: PROMPTS,
		llm,
		modelName: "test-model",
		now: () => (t += 1),
		newId: () => `id${(n += 1)}`,
	})
	return { session, storage }
}

const ok = (prose: string, extra: Record<string, unknown> = {}): string =>
	reply(prose, { time: { minutes: 10 }, channel: "зрение", ...extra })

/* ────────────── H. Сжатие контекста ────────────── */

test("H: в модель уходят CORE, схема и компактное состояние", () => {
	const { session } = makeSession(fakeLlm([ok("Сцена.")]).call)
	const msgs = session.buildMessages("иду к двери")
	assert.equal(msgs[0].role, "system")
	assert.ok(msgs[0].content.includes("CORE-ТЕКСТ"))
	assert.ok(msgs[0].content.includes("SCHEMA-ТЕКСТ"))
	assert.ok(msgs.some((m) => m.content.startsWith("СОСТОЯНИЕ (истина")))
	assert.equal(msgs[msgs.length - 1].role, "user")
	assert.equal(msgs[msgs.length - 1].content, "иду к двери")
})

test("H: в контекст попадают только последние 8 сообщений переписки", () => {
	const { session } = makeSession(fakeLlm([ok("Сцена.")]).call)
	for (let i = 0; i < 20; i++) {
		session.record.history.push({ role: i % 2 ? "assistant" : "user", content: `старое ${i}` })
	}
	const msgs = session.buildMessages("дальше")
	const historyLike = msgs.filter((m) => m.content.startsWith("старое "))
	assert.equal(historyLike.length, HISTORY_TAIL)
	assert.equal(historyLike[0].content, "старое 12")
	assert.equal(msgs.some((m) => m.content === "старое 0"), false)
})

test("H: раз в 7 ходов движок сам делает снапшот и сжимает им переписку", async () => {
	const { session } = makeSession(fakeLlm([ok("Шаг.")]).call)
	assert.equal(session.record.digest, null)
	for (let i = 0; i < SNAPSHOT_EVERY; i++) await session.turn(`ход ${i}`)
	assert.equal(session.state.clock.turn, SNAPSHOT_EVERY)
	const digest = session.record.digest
	assert.ok(digest)
	assert.ok(String(digest).includes("СНАПШОТ"))
	assert.equal(session.record.history.length, 2)
	const msgs = session.buildMessages("дальше")
	assert.ok(msgs.some((m) => m.content.startsWith("СЖАТАЯ ИСТОРИЯ")))
})

test("H: снапшот и сверку пишет код, а не модель", async () => {
	const spy = fakeLlm([ok("Шаг.")])
	const { session } = makeSession(spy.call)
	const before = session.state.snapshotSeq
	const out = await session.turn("((снапшот))")
	assert.equal(spy.calls.length, 0)
	assert.equal(session.state.snapshotSeq, before + 1)
	assert.ok(out.entries[0].text.includes("СНАПШОТ"))
	assert.equal(out.applied, false)
})

/* ────────────── A. Факты движка уходят модели ровно один раз ────────────── */

test("A: отклонение уходит следующим системным сообщением и не повторяется", async () => {
	const spy = fakeLlm([ok("Плачу за комнату.", { money: { delta: -100000 } }), ok("Следующая сцена.")])
	const { session } = makeSession(spy.call)
	await session.turn("плачу за комнату")
	assert.ok(session.record.pendingFacts.some((f) => f.code === "money_insufficient"))

	await session.turn("иду дальше")
	const second = spy.calls[1].messages
	assert.ok(second.some((m) => m.content.includes("[движок: денег не хватило")))
	// В третий раз того же факта уже нет: он отдан один раз.
	assert.equal(session.record.pendingFacts.some((f) => f.code === "money_insufficient"), false)
})

test("A: отклонение не вызывает ретрая — модель вызвана ровно один раз", async () => {
	const spy = fakeLlm([
		ok("Сцена.", {
			money: { delta: -100000 },
			fronts: [{ name: base().fronts[0].name, progressStep: 1 }],
			skills: [{ name: base().skills[0].name, step: 1 }],
		}),
	])
	const { session } = makeSession(spy.call)
	const out = await session.turn("пробую всё сразу")
	assert.equal(spy.calls.length, 1)
	assert.equal(out.applied, true)
})

/* ────────────── G. Режим отладки ────────────── */

test("G: рядом с ходом сохраняется сырая дельта, применённое, отклонённое и токены", async () => {
	const { session } = makeSession(fakeLlm([ok("Сцена.", { money: { delta: -100000 } })]).call)
	const out = await session.turn("плачу")
	const prose = out.entries.find((e) => e.kind === "prose")!
	const d = prose.debug!
	assert.ok(d.rawDelta!.includes("money"))
	assert.ok(d.applied.length > 0)
	assert.ok(d.rejected.some((r) => r.code === "money_insufficient"))
	assert.equal(d.usage!.total, 15)
	assert.equal(d.model, "test-model")
	assert.equal(d.retried, false)
	assert.ok(d.contextMessages > 0)
})

test("G: в ленту игрока попадает только проза, без JSON", async () => {
	const { session } = makeSession(fakeLlm([ok("Дождь бьёт в ставни.")]).call)
	const out = await session.turn("смотрю в окно")
	const prose = out.entries.find((e) => e.kind === "prose")!
	assert.equal(prose.text, "Дождь бьёт в ставни.")
	assert.equal(prose.text.includes("<delta>"), false)
	assert.equal(prose.text.includes("{"), false)
})

/* ────────────── C. Детерминированный откат ────────────── */

test("C: откат возвращает состояние И обрезает ленту, модель не участвует", async () => {
	const spy = fakeLlm([ok("Первый ход.", { money: { delta: -10 } })])
	const { session } = makeSession(spy.call)
	const money0 = session.state.money
	await session.turn("плачу десятку")
	assert.equal(session.state.money, money0 - 10)
	assert.equal(session.record.transcript.length, 2)

	const callsBefore = spy.calls.length
	await session.turn("((откат))")
	assert.equal(spy.calls.length, callsBefore, "откат не ходит в модель")
	assert.equal(session.state.money, money0)
	assert.equal(session.state.clock.turn, 0)
	// Лента обрезана до того же хода, осталась только служебная строка об откате.
	assert.equal(session.record.transcript.filter((e) => e.kind === "prose").length, 0)
	assert.equal(session.record.history.length, 0)
})

test("C: откат на пустом стеке говорит по-человечески", async () => {
	const { session } = makeSession(fakeLlm([ok("Сцена.")]).call)
	const out = await session.turn("((откат))")
	assert.equal(out.entries[0].text, "Откатываться некуда.")
})

test("C: локальные команды узнаются до вызова модели", () => {
	assert.equal(isLocalCommand("((аудит))"), true)
	assert.equal(isLocalCommand("((поправка: кони здесь дороги))"), true)
	assert.equal(isLocalCommand("((эпилог))"), false)
	assert.equal(isLocalCommand("иду к двери"), false)
})

test("C: эпилог — единственная команда кнопки, которая уходит в модель", async () => {
	const spy = fakeLlm([ok("После всего.")])
	const { session } = makeSession(spy.call)
	await session.turn("((эпилог))")
	assert.equal(spy.calls.length, 1)
	assert.equal(spy.calls[0].messages[spy.calls[0].messages.length - 1].content, "((эпилог))")
})

/* ────────────── J. Устойчивость к слабым моделям ────────────── */

test("J: невалидный JSON даёт ровно один ретрай и второй ответ принимается", async () => {
	const spy = fakeLlm(["Проза без блока.", ok("Исправленный ход.")])
	const { session } = makeSession(spy.call)
	const out = await session.turn("иду")
	assert.equal(spy.calls.length, 2)
	assert.equal(out.applied, true)
	const prose = out.entries.find((e) => e.kind === "prose")!
	assert.equal(prose.debug!.retried, true)
	const retryMsg = spy.calls[1].messages[spy.calls[1].messages.length - 1].content
	assert.ok(retryMsg.includes("[система:"))
})

test("J: два негодных ответа подряд — состояние не меняется, игроку внятный текст", async () => {
	const spy = fakeLlm(["Пусто.", "Снова пусто."])
	const { session } = makeSession(spy.call)
	const turnBefore = session.state.clock.turn
	const out = await session.turn("иду")
	assert.equal(spy.calls.length, 2)
	assert.equal(out.applied, false)
	assert.equal(session.state.clock.turn, turnBefore)
	assert.ok(out.error)
	assert.ok(out.entries[0].text.includes("Состояние мира не изменилось"))
	assert.equal(out.entries[0].text.includes("Error"), false)
})

test("J: сетевая ошибка не теряет ход и не показывает стектрейс", async () => {
	const { session } = makeSession(async () => {
		throw new LlmError("Ключ не принят эндпоинтом. Проверьте ключ в настройках.", 401)
	})
	const before = JSON.stringify(session.state)
	const out = await session.turn("иду")
	assert.equal(out.applied, false)
	assert.equal(JSON.stringify(session.state), before)
	assert.equal(out.entries[0].text, "Ключ не принят эндпоинтом. Проверьте ключ в настройках.")
})

test("J: structured output принимается без парсинга <delta>", async () => {
	const spy = fakeLlm([
		{
			text: "",
			mode: "json_schema",
			usage: { prompt: 1, completion: 1, total: 2 },
			structured: {
				prose: "Структурная сцена.",
				delta: { time: { minutes: 15 }, channel: "звук", money: { delta: -3, reason: "пиво" } },
			},
		},
	])
	const { session } = makeSession(spy.call)
	const money0 = session.state.money
	const out = await session.turn("пью")
	assert.equal(out.applied, true)
	assert.equal(session.state.money, money0 - 3)
	const prose = out.entries.find((e) => e.kind === "prose")!
	assert.equal(prose.text, "Структурная сцена.")
	assert.equal(prose.debug!.mode, "json_schema")
})

test("автосохранение после каждого применённого хода", async () => {
	const { session, storage } = makeSession(fakeLlm([ok("Сцена.")]).call)
	await session.turn("иду")
	const saved = await storage.loadGame("g1")
	assert.ok(saved)
	assert.equal(saved!.state.clock.turn, 1)
	assert.equal(saved!.transcript.length, 2)
})
