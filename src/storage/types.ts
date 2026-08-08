// Адаптер хранилища. Ядро ничего не знает ни про fs, ни про IndexedDB.
// Реализации: indexeddb.ts (браузер), fs.ts (CLI/тесты), memory.ts (тесты).
import type { Delta, EngineFact, State } from "../types.ts"
import type { LlmMessage, LlmUsage } from "../llm.ts"

export type TranscriptKind = "player" | "prose" | "engine" | "system"

/** G. Всё, что показывает режим отладки рядом с ходом. */
export type TurnDebug = {
	rawDelta: string | null
	applied: string[]
	rejected: { code: string; text: string }[]
	directives: string[]
	usage: LlmUsage
	mode: string
	model: string
	ms: number
	contextMessages: number
	retried: boolean
}

export type TranscriptEntry = {
	id: string
	turn: number
	kind: TranscriptKind
	text: string
	at: number
	debug?: TurnDebug
}

export type GameRecord = {
	id: string
	title: string
	packId: string
	createdAt: number
	updatedAt: number
	state: State
	transcript: TranscriptEntry[]
	/** H. Только хвост переписки; старое заменяется снапшотом. */
	history: LlmMessage[]
	digest: string | null
	/** A. Факты движка, которые ещё не были показаны модели. */
	pendingFacts: EngineFact[]
	lastDelta?: Delta | null
}

/** C. Кадр стека отката: всё, что нужно, чтобы вернуться без участия модели. */
export type UndoFrame = {
	state: State
	transcriptLength: number
	historyLength: number
	digest: string | null
	pendingFacts: EngineFact[]
}

export type GameSummary = {
	id: string
	title: string
	packId: string
	turn: number
	day: number
	dead: boolean
	createdAt: number
	updatedAt: number
}

export type Storage = {
	listGames: () => Promise<GameSummary[]>
	loadGame: (id: string) => Promise<GameRecord | null>
	saveGame: (record: GameRecord) => Promise<void>
	deleteGame: (id: string) => Promise<void>
	pushUndo: (gameId: string, frame: UndoFrame) => Promise<void>
	popUndo: (gameId: string) => Promise<UndoFrame | null>
	undoDepth: (gameId: string) => Promise<number>
	clearUndo: (gameId: string) => Promise<void>
}

export function summarize(r: GameRecord): GameSummary {
	return {
		id: r.id,
		title: r.title,
		packId: r.packId,
		turn: r.state.clock.turn,
		day: r.state.clock.day,
		dead: r.state.dead,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
	}
}
