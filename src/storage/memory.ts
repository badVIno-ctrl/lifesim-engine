// Хранилище в памяти. Используется тестами и как запасной вариант, если в браузере
// отключён IndexedDB (приватные окна некоторых браузеров).
import { UNDO_DEPTH } from "../engine.ts"
import { summarize } from "./types.ts"
import type { GameRecord, GameSummary, Storage, UndoFrame } from "./types.ts"

export function createMemoryStorage(): Storage {
	const games = new Map<string, GameRecord>()
	const undo = new Map<string, UndoFrame[]>()
	const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T

	return {
		async listGames(): Promise<GameSummary[]> {
			return [...games.values()].map(summarize).sort((a, b) => b.updatedAt - a.updatedAt)
		},
		async loadGame(id: string): Promise<GameRecord | null> {
			const r = games.get(id)
			return r ? copy(r) : null
		},
		async saveGame(record: GameRecord): Promise<void> {
			games.set(record.id, copy(record))
		},
		async deleteGame(id: string): Promise<void> {
			games.delete(id)
			undo.delete(id)
		},
		async pushUndo(gameId: string, frame: UndoFrame): Promise<void> {
			const stack = undo.get(gameId) ?? []
			stack.push(copy(frame))
			while (stack.length > UNDO_DEPTH) stack.shift()
			undo.set(gameId, stack)
		},
		async popUndo(gameId: string): Promise<UndoFrame | null> {
			const stack = undo.get(gameId) ?? []
			const f = stack.pop() ?? null
			undo.set(gameId, stack)
			return f
		},
		async undoDepth(gameId: string): Promise<number> {
			return (undo.get(gameId) ?? []).length
		},
		async clearUndo(gameId: string): Promise<void> {
			undo.delete(gameId)
		},
	}
}
