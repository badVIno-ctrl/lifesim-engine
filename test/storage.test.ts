// Адаптер хранилища: один контракт, две реализации (fs и память).
// Третья, IndexedDB, живёт только в браузере и повторяет тот же интерфейс.
import test from "node:test"
import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { UNDO_DEPTH } from "../src/engine.ts"
import { createGameRecord } from "../src/session.ts"
import { createFsStorage } from "../src/storage/fs.ts"
import { createMemoryStorage } from "../src/storage/memory.ts"
import { summarize } from "../src/storage/types.ts"
import { base, tempRoot } from "./helpers.ts"
import type { Storage, UndoFrame } from "../src/storage/types.ts"

const record = (id: string) =>
	createGameRecord({ id, title: `партия ${id}`, packId: "grauberg", state: base(), now: 1 })

const frame = (turn: number): UndoFrame => {
	const s = base()
	s.clock.turn = turn
	return {
		state: s,
		transcriptLength: turn * 2,
		historyLength: turn * 2,
		digest: null,
		pendingFacts: [],
	}
}

type Case = { name: string; make: () => { storage: Storage; cleanup: () => void } }

const cases: Case[] = [
	{ name: "память", make: () => ({ storage: createMemoryStorage(), cleanup: () => {} }) },
	{
		name: "fs",
		make: () => {
			const t = tempRoot()
			return { storage: createFsStorage(t.path), cleanup: t.cleanup }
		},
	},
]

for (const c of cases) {
	test(`${c.name}: сохранение, список, чтение, удаление`, async () => {
		const { storage, cleanup } = c.make()
		try {
			assert.deepEqual(await storage.listGames(), [])
			await storage.saveGame(record("a"))
			await storage.saveGame(record("b"))
			const list = await storage.listGames()
			assert.equal(list.length, 2)
			assert.ok(list.every((g) => typeof g.turn === "number" && typeof g.day === "number"))
			const loaded = await storage.loadGame("a")
			assert.equal(loaded!.title, "партия a")
			assert.equal(await storage.loadGame("нету"), null)
			await storage.deleteGame("a")
			assert.equal(await storage.loadGame("a"), null)
			assert.equal((await storage.listGames()).length, 1)
		} finally {
			cleanup()
		}
	})

	test(`${c.name}: C — стек отката глубиной ${UNDO_DEPTH}, старые кадры вытесняются`, async () => {
		const { storage, cleanup } = c.make()
		try {
			await storage.saveGame(record("a"))
			for (let i = 1; i <= UNDO_DEPTH + 5; i++) await storage.pushUndo("a", frame(i))
			assert.equal(await storage.undoDepth("a"), UNDO_DEPTH)
			const top = await storage.popUndo("a")
			assert.equal(top!.state.clock.turn, UNDO_DEPTH + 5)
			assert.equal(await storage.undoDepth("a"), UNDO_DEPTH - 1)
			await storage.clearUndo("a")
			assert.equal(await storage.undoDepth("a"), 0)
			assert.equal(await storage.popUndo("a"), null)
		} finally {
			cleanup()
		}
	})

	test(`${c.name}: удаление партии уносит её стек отката`, async () => {
		const { storage, cleanup } = c.make()
		try {
			await storage.saveGame(record("a"))
			await storage.pushUndo("a", frame(1))
			await storage.deleteGame("a")
			assert.equal(await storage.undoDepth("a"), 0)
		} finally {
			cleanup()
		}
	})
}

test("память не отдаёт ссылку на внутренний объект", async () => {
	const storage = createMemoryStorage()
	const r = record("a")
	await storage.saveGame(r)
	r.state.money = 999999
	const loaded = await storage.loadGame("a")
	assert.notEqual(loaded!.state.money, 999999)
})

test("summarize даёт ровно то, что нужно экрану начала", () => {
	const r = record("a")
	const s = summarize(r)
	assert.equal(s.id, "a")
	assert.equal(s.packId, "grauberg")
	assert.equal(s.turn, r.state.clock.turn)
	assert.equal(s.day, r.state.clock.day)
	assert.equal(s.dead, false)
})

test("битый файл не роняет список партий", async () => {
	const t = tempRoot()
	try {
		const storage = createFsStorage(t.path)
		await storage.saveGame(record("a"))
		writeFileSync(join(t.path, "games", "broken.json"), "{это не json", "utf8")
		const list = await storage.listGames()
		assert.equal(list.length, 1)
	} finally {
		t.cleanup()
	}
})

test("список партий отсортирован по свежести", async () => {
	const t = tempRoot()
	try {
		const storage = createFsStorage(t.path)
		const older = record("older")
		older.updatedAt = 1000
		const newer = record("newer")
		newer.updatedAt = 5000
		await storage.saveGame(older)
		await storage.saveGame(newer)
		const list = await storage.listGames()
		assert.deepEqual(
			list.map((g) => g.id),
			["newer", "older"],
		)
	} finally {
		t.cleanup()
	}
})
