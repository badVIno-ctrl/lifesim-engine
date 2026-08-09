// Контур хода без сети: свой движок внутри Session, и двухфазный ход у модели.
import test from "node:test"
import assert from "node:assert/strict"
import { Session, createGameRecord } from "../src/session.ts"
import { createMemoryStorage } from "../src/storage/memory.ts"
import { createLocalNarrator } from "../src/narrator/index.ts"
import { DEFAULT_SETTINGS, isConfigured, loadSettings } from "../src/ui/settings.ts"
import { base, fakeLlm, reply } from "./helpers.ts"
import type { Storage } from "../src/storage/types.ts"

const PROMPTS = { core: "CORE", schema: "SCHEMA" }

function localSession(): { session: Session; storage: Storage } {
	const storage = createMemoryStorage()
	const record = createGameRecord({ id: "g1", title: "тест", packId: "grauberg", state: base(), now: 1000 })
	let t = 1000
	let n = 0
	const session = new Session({
		record,
		storage,
		prompts: PROMPTS,
		narrator: createLocalNarrator(),
		now: () => (t += 1),
		newId: () => `id${(n += 1)}`,
	})
	return { session, storage }
}

test("свой движок делает ход без ключа, без эндпоинта и без сети", async () => {
	const { session } = localSession()
	assert.equal(session.llm, null, "вызывателя модели нет вовсе")
	const out = await session.turn("осмотреться")
	assert.equal(out.applied, true)
	assert.equal(session.state.clock.turn, 1)
	const prose = out.entries.find((e) => e.kind === "prose")
	assert.ok(prose && prose.text.length > 40)
	assert.equal(prose?.debug?.mode, "local")
	assert.equal(prose?.debug?.usage, null, "токенов не тратится")
	assert.ok(prose?.debug?.reasoning?.includes("исход"), "в отладке видно, почему так вышло")
})

test("десять ходов подряд: состояние живёт, отклонений нет, время идёт", async () => {
	const { session } = localSession()
	const inputs = [
		"осмотреться",
		"поговорить с Мартой",
		"взяться за работу",
		"поесть",
		"напиться воды",
		"пойти на рыночную площадь",
		"поискать след",
		"отдохнуть до утра",
		"заплатить долг",
		"подождать и посмотреть",
	]
	let minute = session.state.clock.minuteOfDay
	let day = session.state.clock.day
	for (const input of inputs) {
		const before = session.state.clock.turn
		await session.turn(input)
		assert.equal(session.state.clock.turn, before + 1, input)
		const moved = session.state.clock.day > day || session.state.clock.minuteOfDay !== minute
		assert.ok(moved, `время сдвинулось на «${input}»`)
		minute = session.state.clock.minuteOfDay
		day = session.state.clock.day
	}
	assert.equal(session.state.clock.turn, 10)
	assert.ok(session.record.narratorMemory && session.record.narratorMemory.recent.length > 0)
	const proses = session.record.transcript.filter((e) => e.kind === "prose").map((e) => e.text)
	assert.equal(new Set(proses).size, proses.length, "десять разных сцен")
})

test("откат возвращает и состояние, и память рассказчика", async () => {
	const { session } = localSession()
	await session.turn("осмотреться")
	const memoryAfterFirst = [...(session.record.narratorMemory?.recent ?? [])]
	await session.turn("поговорить с Мартой")
	assert.notDeepEqual(session.record.narratorMemory?.recent, memoryAfterFirst)
	const ok = await session.undo()
	assert.equal(ok, true)
	assert.equal(session.state.clock.turn, 1)
	assert.deepEqual(session.record.narratorMemory?.recent, memoryAfterFirst)
})

test("локальные команды и со своим движком не трогают состояние", async () => {
	const { session } = localSession()
	const before = JSON.stringify(session.state)
	const out = await session.turn("((снапшот))")
	assert.equal(out.applied, false)
	assert.match(out.entries[0].text, /СНАПШОТ/)
	// Снапшот увеличивает только собственный счётчик, всё остальное на месте.
	const after = JSON.parse(JSON.stringify(session.state)) as Record<string, unknown>
	const expected = JSON.parse(before) as Record<string, unknown>
	expected.snapshotSeq = after.snapshotSeq
	assert.deepEqual(after, expected)
})

test("мёртвый персонаж: ход не проходит, состояние цело", async () => {
	const { session } = localSession()
	session.record.state.dead = true
	const out = await session.turn("встать и идти")
	assert.equal(session.state.clock.turn, 0, "ход не сдвинулся")
	assert.match(out.entries.map((e) => e.text).join(" "), /кончилась/)
})

test("сбой рассказчика не стоит игроку состояния", async () => {
	const storage = createMemoryStorage()
	const record = createGameRecord({ id: "g2", title: "тест", packId: "grauberg", state: base() })
	const session = new Session({
		record,
		storage,
		prompts: PROMPTS,
		narrator: () => {
			throw new Error("внутренняя поломка")
		},
	})
	const before = JSON.stringify(session.state)
	const out = await session.turn("осмотреться")
	assert.equal(out.applied, false)
	assert.match(out.error ?? "", /не смог собрать сцену/)
	assert.equal(JSON.stringify(session.state), before)
})

test("без рассказчика и без модели ход отказывается внятно", async () => {
	const storage = createMemoryStorage()
	const record = createGameRecord({ id: "g3", title: "тест", packId: "grauberg", state: base() })
	const session = new Session({ record, storage, prompts: PROMPTS })
	const out = await session.turn("осмотреться")
	assert.equal(out.applied, false)
	assert.match(out.error ?? "", /не выбран ни свой движок, ни модель/)
	assert.equal(session.state.clock.turn, 0)
})

/* ────────────── Двухфазный ход у модели ────────────── */

test("двухфазный ход: сначала дельта, потом проза по применённому состоянию", async () => {
	const storage = createMemoryStorage()
	const record = createGameRecord({ id: "g4", title: "тест", packId: "grauberg", state: base() })
	const spy = fakeLlm([
		reply("", { time: { minutes: 15 }, channel: "звук", money: { delta: -1000000, reason: "невозможное" } }),
		"Ты уходишь ни с чем: денег на это не нашлось.",
	])
	const session = new Session({
		record,
		storage,
		prompts: PROMPTS,
		llm: spy.call,
		twoPhase: true,
		modelName: "test",
	})
	const out = await session.turn("купить лошадь")
	assert.equal(out.applied, true)
	assert.equal(spy.calls.length, 2, "ровно два запроса")

	const first = spy.calls[0].messages.map((m) => m.content).join("\n")
	assert.match(first, /фаза 1 из 2/)
	const second = spy.calls[1].messages.map((m) => m.content).join("\n")
	assert.match(second, /фаза 2 из 2/)
	// Вторая фаза знает, что движок отклонил: проза больше не может это описать.
	assert.match(second, /отклонено движком/)
	assert.match(second, /денег не хватило/)

	const prose = out.entries.find((e) => e.kind === "prose")
	assert.match(prose?.text ?? "", /денег на это не нашлось/)
	assert.equal(prose?.debug?.mode, "two-phase")
	assert.equal(session.state.money, base().money, "невозможное списание не прошло")
})

test("двухфазный ход без пригодной дельты не тратит второй запрос", async () => {
	const storage = createMemoryStorage()
	const record = createGameRecord({ id: "g5", title: "тест", packId: "grauberg", state: base() })
	const spy = fakeLlm(["ни дельты, ни надежды"])
	const session = new Session({ record, storage, prompts: PROMPTS, llm: spy.call, twoPhase: true })
	const out = await session.turn("иду")
	assert.equal(out.applied, false)
	assert.equal(spy.calls.length, 1)
	assert.equal(session.state.clock.turn, 0)
})

/* ────────────── Настройки приложения ────────────── */

test("по умолчанию игра играется без ключа", () => {
	assert.equal(DEFAULT_SETTINGS.engine, "local")
	assert.equal(DEFAULT_SETTINGS.view, "2d")
	assert.equal(isConfigured(DEFAULT_SETTINGS), true, "со своим движком ходы идут сразу")
	assert.equal(isConfigured({ ...DEFAULT_SETTINGS, engine: "llm", apiKey: "" }), false)
	assert.equal(
		isConfigured({ ...DEFAULT_SETTINGS, engine: "llm", apiKey: "sk-x" }),
		true,
	)
})

test("старые настройки с ключом остаются на модели, без ключа — на своём движке", () => {
	const store: Record<string, string> = {}
	const fake = {
		getItem: (k: string) => store[k] ?? null,
		setItem: (k: string, v: string) => {
			store[k] = v
		},
		removeItem: (k: string) => {
			delete store[k]
		},
		clear: () => {},
		key: () => null,
		length: 0,
	} as unknown as globalThis.Storage
	const g = globalThis as { localStorage?: globalThis.Storage }
	const original = g.localStorage
	g.localStorage = fake

	try {
		store["sim-v13.settings"] = JSON.stringify({ apiKey: "sk-old", model: "gpt-4o-mini" })
		assert.equal(loadSettings().engine, "llm", "ключ уже был — уважаем выбор")

		store["sim-v13.settings"] = JSON.stringify({ apiKey: "", model: "gpt-4o-mini" })
		assert.equal(loadSettings().engine, "local", "ключа не было — играем без ключа")

		store["sim-v13.settings"] = JSON.stringify({ engine: "мусор", view: "мусор" })
		assert.equal(loadSettings().engine, "local")
		assert.equal(loadSettings().view, "2d")
	} finally {
		if (original) g.localStorage = original
		else delete g.localStorage
	}
})
