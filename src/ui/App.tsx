// Корень клиента: маршрутизация между четырьмя экранами и общее состояние оболочки.
// Логики мира здесь нет: всё, что касается чисел, живёт в src/engine.ts.
import { useCallback, useEffect, useMemo, useState } from "react"
import { normalizeState } from "../engine.ts"
import { createGameRecord } from "../session.ts"
import { allDefaults, buildStateFromAnswers, titleFor } from "../init.ts"
import { packs } from "./assets.ts"
import { createBrowserStorage } from "../storage/indexeddb.ts"
import type { GameRecord, GameSummary } from "../storage/types.ts"
import type { Tuning } from "../tuning.ts"
import { loadSettings, saveSettings } from "./settings.ts"
import type { Settings } from "./settings.ts"
import { StartScreen } from "./screens/StartScreen.tsx"
import { SettingsScreen } from "./screens/SettingsScreen.tsx"
import { PackScreen } from "./screens/PackScreen.tsx"
import { InitWizard } from "./screens/InitWizard.tsx"
import { GameScreen } from "./screens/GameScreen.tsx"

type Route =
	| { name: "start" }
	| { name: "settings" }
	| { name: "pack" }
	| { name: "init"; packId: string; tuning: Tuning }
	| { name: "game"; gameId: string }

function newId(): string {
	const c = globalThis.crypto
	if (c && typeof c.randomUUID === "function") return c.randomUUID()
	return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function download(name: string, text: string): void {
	const blob = new Blob([text], { type: "application/json" })
	const url = URL.createObjectURL(blob)
	const a = document.createElement("a")
	a.href = url
	a.download = name
	document.body.appendChild(a)
	a.click()
	a.remove()
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Импорт принимает и целую партию, и голый state.json. */
export function recordFromJson(text: string, id: string): GameRecord {
	const raw = JSON.parse(text) as Record<string, unknown>
	const looksLikeRecord = raw && typeof raw === "object" && "state" in raw && "transcript" in raw
	if (looksLikeRecord) {
		const r = raw as unknown as GameRecord
		const state = normalizeState(r.state)
		return {
			...r,
			id,
			state,
			title: r.title || titleFor(state),
			packId: r.packId || "импорт",
			transcript: Array.isArray(r.transcript) ? r.transcript : [],
			history: Array.isArray(r.history) ? r.history : [],
			digest: typeof r.digest === "string" ? r.digest : null,
			pendingFacts: Array.isArray(r.pendingFacts) ? r.pendingFacts : [],
			createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
			updatedAt: Date.now(),
		}
	}
	const state = normalizeState(raw)
	return createGameRecord({ id, title: titleFor(state), packId: "импорт", state })
}

export function App() {
	const storage = useMemo(() => createBrowserStorage(), [])
	const [settings, setSettings] = useState<Settings>(() => loadSettings())
	const [route, setRoute] = useState<Route>({ name: "start" })
	const [games, setGames] = useState<GameSummary[]>([])
	const [error, setError] = useState<string | null>(null)

	const refresh = useCallback(async () => {
		try {
			setGames(await storage.listGames())
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		}
	}, [storage])

	useEffect(() => {
		void refresh()
	}, [refresh])

	const applySettings = useCallback((next: Settings) => {
		setSettings(next)
		saveSettings(next)
	}, [])

	const onDelete = useCallback(
		async (id: string) => {
			await storage.deleteGame(id)
			await storage.clearUndo(id)
			await refresh()
		},
		[storage, refresh],
	)

	const onExport = useCallback(
		async (id: string) => {
			const rec = await storage.loadGame(id)
			if (!rec) return
			download(`${rec.title.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40) || "game"}.json`, JSON.stringify(rec, null, "\t"))
		},
		[storage],
	)

	/**
	 * «Играть сразу»: партия из первого пака с его же ответами и его же правилами.
	 * Ни одного вопроса до первой сцены — человек попадает в игру, а не в форму.
	 */
	const onQuickStart = useCallback(async () => {
		try {
			const list = packs()
			const pack = list[0]
			if (!pack) {
				setError("В папке packs/ нет ни одного мира.")
				return
			}
			const state = buildStateFromAnswers(pack, allDefaults(pack))
			const rec = createGameRecord({
				id: newId(),
				title: titleFor(state),
				packId: pack.id,
				state,
			})
			await storage.saveGame(rec)
			await storage.clearUndo(rec.id)
			await refresh()
			setRoute({ name: "game", gameId: rec.id })
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		}
	}, [storage, refresh])

	const onImport = useCallback(
		async (text: string) => {
			try {
				const rec = recordFromJson(text, newId())
				await storage.saveGame(rec)
				await storage.clearUndo(rec.id)
				setError(null)
				await refresh()
			} catch (e) {
				setError(`Файл не подошёл: ${e instanceof Error ? e.message : String(e)}`)
			}
		},
		[storage, refresh],
	)

	if (route.name === "settings") {
		return (
			<SettingsScreen
				settings={settings}
				onChange={applySettings}
				onBack={() => setRoute({ name: "start" })}
			/>
		)
	}

	if (route.name === "pack") {
		return (
			<PackScreen
				onBack={() => setRoute({ name: "start" })}
				onPick={(packId, tuning) => setRoute({ name: "init", packId, tuning })}
			/>
		)
	}

	if (route.name === "init") {
		return (
			<InitWizard
				packId={route.packId}
				tuning={route.tuning}
				onBack={() => setRoute({ name: "pack" })}
				onDone={async (state) => {
					const rec = createGameRecord({
						id: newId(),
						title: titleFor(state),
						packId: route.packId,
						state,
					})
					await storage.saveGame(rec)
					await storage.clearUndo(rec.id)
					await refresh()
					setRoute({ name: "game", gameId: rec.id })
				}}
			/>
		)
	}

	if (route.name === "game") {
		return (
			<GameScreen
				gameId={route.gameId}
				storage={storage}
				settings={settings}
				onChangeSettings={applySettings}
				onBack={async () => {
					await refresh()
					setRoute({ name: "start" })
				}}
				onOpenSettings={() => setRoute({ name: "settings" })}
			/>
		)
	}

	return (
		<StartScreen
			games={games}
			settings={settings}
			error={error}
			onContinue={(id) => setRoute({ name: "game", gameId: id })}
			onQuickStart={onQuickStart}
			onDelete={onDelete}
			onExport={onExport}
			onImport={onImport}
			onNew={() => setRoute({ name: "pack" })}
			onSettings={() => setRoute({ name: "settings" })}
		/>
	)
}
