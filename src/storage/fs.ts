// Файловое хранилище для CLI и тестов. Единственное место в src/, где есть fs и path.
// В браузерную сборку этот файл не попадает: его импортируют только src/node/* и test/*.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { UNDO_DEPTH } from "../engine.ts"
import { summarize } from "./types.ts"
import type { GameRecord, GameSummary, Storage, UndoFrame } from "./types.ts"

export function createFsStorage(root: string): Storage {
	const gamesDir = join(root, "games")
	const undoDir = join(root, "undo")
	const ensure = (): void => {
		mkdirSync(gamesDir, { recursive: true })
		mkdirSync(undoDir, { recursive: true })
	}
	const gamePath = (id: string): string => join(gamesDir, `${safe(id)}.json`)
	const undoPath = (id: string): string => join(undoDir, `${safe(id)}.json`)

	const readUndo = (id: string): UndoFrame[] => {
		if (!existsSync(undoPath(id))) return []
		try {
			return JSON.parse(readFileSync(undoPath(id), "utf8")) as UndoFrame[]
		} catch {
			return []
		}
	}
	const writeUndo = (id: string, frames: UndoFrame[]): void => {
		ensure()
		writeFileSync(undoPath(id), JSON.stringify(frames, null, "\t"), "utf8")
	}

	return {
		async listGames(): Promise<GameSummary[]> {
			ensure()
			const out: GameSummary[] = []
			for (const f of readdirSync(gamesDir)) {
				if (!f.endsWith(".json")) continue
				try {
					out.push(summarize(JSON.parse(readFileSync(join(gamesDir, f), "utf8")) as GameRecord))
				} catch {
					// битый файл не должен ронять список партий
				}
			}
			return out.sort((a, b) => b.updatedAt - a.updatedAt)
		},
		async loadGame(id: string): Promise<GameRecord | null> {
			if (!existsSync(gamePath(id))) return null
			return JSON.parse(readFileSync(gamePath(id), "utf8")) as GameRecord
		},
		async saveGame(record: GameRecord): Promise<void> {
			ensure()
			writeFileSync(gamePath(record.id), JSON.stringify(record, null, "\t"), "utf8")
		},
		async deleteGame(id: string): Promise<void> {
			if (existsSync(gamePath(id))) rmSync(gamePath(id))
			if (existsSync(undoPath(id))) rmSync(undoPath(id))
		},
		async pushUndo(gameId: string, frame: UndoFrame): Promise<void> {
			const frames = readUndo(gameId)
			frames.push(frame)
			while (frames.length > UNDO_DEPTH) frames.shift()
			writeUndo(gameId, frames)
		},
		async popUndo(gameId: string): Promise<UndoFrame | null> {
			const frames = readUndo(gameId)
			const f = frames.pop() ?? null
			writeUndo(gameId, frames)
			return f
		},
		async undoDepth(gameId: string): Promise<number> {
			return readUndo(gameId).length
		},
		async clearUndo(gameId: string): Promise<void> {
			writeUndo(gameId, [])
		},
	}
}

function safe(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, "_")
}
