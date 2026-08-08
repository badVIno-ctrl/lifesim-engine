// C. Хранилище браузера: партии и стек из 20 предыдущих состояний.
// Чистый IndexedDB без библиотек.
import { UNDO_DEPTH } from "../engine.ts"
import { summarize } from "./types.ts"
import { createMemoryStorage } from "./memory.ts"
import type { GameRecord, GameSummary, Storage, UndoFrame } from "./types.ts"

const DB_NAME = "sim-v13"
const DB_VERSION = 1
const GAMES = "games"
const UNDO = "undo"

type UndoRow = { seq?: number; gameId: string; frame: UndoFrame }

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION)
		req.onupgradeneeded = () => {
			const db = req.result
			if (!db.objectStoreNames.contains(GAMES)) {
				db.createObjectStore(GAMES, { keyPath: "id" })
			}
			if (!db.objectStoreNames.contains(UNDO)) {
				const store = db.createObjectStore(UNDO, { keyPath: "seq", autoIncrement: true })
				store.createIndex("gameId", "gameId", { unique: false })
			}
		}
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error ?? new Error("IndexedDB недоступен"))
	})
}

function done(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve()
		tx.onabort = () => reject(tx.error ?? new Error("транзакция прервана"))
		tx.onerror = () => reject(tx.error ?? new Error("ошибка транзакции"))
	})
}

function ask<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error ?? new Error("ошибка запроса"))
	})
}

export function isIndexedDbAvailable(): boolean {
	try {
		return typeof indexedDB !== "undefined" && indexedDB !== null
	} catch {
		return false
	}
}

export function createIndexedDbStorage(): Storage {
	let dbPromise: Promise<IDBDatabase> | null = null
	const db = (): Promise<IDBDatabase> => {
		if (!dbPromise) dbPromise = openDb()
		return dbPromise
	}

	async function undoRows(gameId: string): Promise<UndoRow[]> {
		const d = await db()
		const tx = d.transaction(UNDO, "readonly")
		const index = tx.objectStore(UNDO).index("gameId")
		const rows = await ask(index.getAll(IDBKeyRange.only(gameId)) as IDBRequest<UndoRow[]>)
		await done(tx)
		return rows.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
	}

	return {
		async listGames(): Promise<GameSummary[]> {
			const d = await db()
			const tx = d.transaction(GAMES, "readonly")
			const all = await ask(tx.objectStore(GAMES).getAll() as IDBRequest<GameRecord[]>)
			await done(tx)
			return all.map(summarize).sort((a, b) => b.updatedAt - a.updatedAt)
		},

		async loadGame(id: string): Promise<GameRecord | null> {
			const d = await db()
			const tx = d.transaction(GAMES, "readonly")
			const rec = await ask(tx.objectStore(GAMES).get(id) as IDBRequest<GameRecord | undefined>)
			await done(tx)
			return rec ?? null
		},

		async saveGame(record: GameRecord): Promise<void> {
			const d = await db()
			const tx = d.transaction(GAMES, "readwrite")
			tx.objectStore(GAMES).put(record)
			await done(tx)
		},

		async deleteGame(id: string): Promise<void> {
			const d = await db()
			const tx = d.transaction([GAMES, UNDO], "readwrite")
			tx.objectStore(GAMES).delete(id)
			const index = tx.objectStore(UNDO).index("gameId")
			const cursorReq = index.openCursor(IDBKeyRange.only(id))
			cursorReq.onsuccess = () => {
				const cursor = cursorReq.result
				if (cursor) {
					cursor.delete()
					cursor.continue()
				}
			}
			await done(tx)
		},

		async pushUndo(gameId: string, frame: UndoFrame): Promise<void> {
			const d = await db()
			const tx = d.transaction(UNDO, "readwrite")
			const store = tx.objectStore(UNDO)
			store.add({ gameId, frame } satisfies UndoRow)
			await done(tx)
			// Обрезаем стек до UNDO_DEPTH — глубина задана ядром, а не UI.
			const rows = await undoRows(gameId)
			const extra = rows.length - UNDO_DEPTH
			if (extra > 0) {
				const d2 = await db()
				const tx2 = d2.transaction(UNDO, "readwrite")
				const s2 = tx2.objectStore(UNDO)
				for (const row of rows.slice(0, extra)) if (row.seq !== undefined) s2.delete(row.seq)
				await done(tx2)
			}
		},

		async popUndo(gameId: string): Promise<UndoFrame | null> {
			const rows = await undoRows(gameId)
			const last = rows[rows.length - 1]
			if (!last || last.seq === undefined) return null
			const d = await db()
			const tx = d.transaction(UNDO, "readwrite")
			tx.objectStore(UNDO).delete(last.seq)
			await done(tx)
			return last.frame
		},

		async undoDepth(gameId: string): Promise<number> {
			return (await undoRows(gameId)).length
		},

		async clearUndo(gameId: string): Promise<void> {
			const rows = await undoRows(gameId)
			if (!rows.length) return
			const d = await db()
			const tx = d.transaction(UNDO, "readwrite")
			const store = tx.objectStore(UNDO)
			for (const r of rows) if (r.seq !== undefined) store.delete(r.seq)
			await done(tx)
		},
	}
}

/** Браузер без IndexedDB не должен ронять игру — переходим на память. */
export function createBrowserStorage(): Storage {
	return isIndexedDbAvailable() ? createIndexedDbStorage() : createMemoryStorage()
}
