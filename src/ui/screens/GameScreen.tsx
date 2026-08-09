// Экран игры. Два вида одной и той же партии:
//   2D — кадр сцены, проза под ним и колода действий: играется одной рукой и без чтения правил;
//   текст — вся лента, как в терминале, для тех, кому картинка мешает.
// Логики мира здесь нет: ход считает src/session.ts, числа меняет src/engine.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Notice, Screen } from "../components/Screen.tsx"
import { ActionDeck } from "../components/ActionDeck.tsx"
import { CommandBar } from "../components/CommandBar.tsx"
import { MicButton } from "../components/MicButton.tsx"
import { StatePanel } from "../components/StatePanel.tsx"
import { TurnCard } from "../components/TurnCard.tsx"
import { TuningCard } from "../components/TuningCard.tsx"
import { Scene2D } from "../scene2d/Scene2D.tsx"
import { Session, exportFileName, isLocalCommand } from "../../session.ts"
import { downloadText } from "../download.ts"
import { openAiCompatible } from "../../llm.ts"
import { createLocalNarrator, suggestActions } from "../../narrator/index.ts"
import { normalizeState } from "../../engine.ts"
import { readTuning, tuningOf } from "../../tuning.ts"
import type { Tuning } from "../../tuning.ts"
import { PROMPTS } from "../assets.ts"
import { isConfigured } from "../settings.ts"
import type { Settings } from "../settings.ts"
import {
	appendDictation,
	matchSpokenCommand,
	pickVoiceMode,
	stripForSpeech,
	transcribeAudio,
	voiceModeExplanation,
} from "../../voice.ts"
import {
	createDictation,
	speak,
	startRecording,
	stopSpeaking,
	voiceCapabilities,
} from "../voice-input.ts"
import type { Dictation, Recording } from "../voice-input.ts"
import type { GameRecord, Storage } from "../../storage/types.ts"

// Зависший запрос блокирует игру насовсем: две минуты — потолок для одного хода.
const TURN_TIMEOUT_MS = 120_000

export function GameScreen(props: {
	gameId: string
	storage: Storage
	settings: Settings
	onChangeSettings: (next: Settings) => void
	onBack: () => void | Promise<void>
	onOpenSettings: () => void
}) {
	const [record, setRecord] = useState<GameRecord | null>(null)
	const [loadError, setLoadError] = useState<string | null>(null)
	const [tick, setTick] = useState(0)
	const [input, setInput] = useState("")
	const [busy, setBusy] = useState(false)
	const [streaming, setStreaming] = useState("")
	const [panelOpen, setPanelOpen] = useState(false)
	const [undoDepth, setUndoDepth] = useState(0)
	const [listening, setListening] = useState(false)
	const [interim, setInterim] = useState("")
	const [decoding, setDecoding] = useState(false)
	const [voiceError, setVoiceError] = useState<string | null>(null)
	const [freeText, setFreeText] = useState(false)
	const feedRef = useRef<HTMLDivElement>(null)
	const dictationRef = useRef<Dictation | null>(null)
	const recordingRef = useRef<Recording | null>(null)
	const spokenRef = useRef<string | null>(null)
	const abortRef = useRef<AbortController | null>(null)

	useEffect(() => {
		let alive = true
		void (async () => {
			try {
				const r = await props.storage.loadGame(props.gameId)
				if (!alive) return
				if (!r) setLoadError("Партия не найдена в хранилище.")
				else setRecord(r)
				setUndoDepth(await props.storage.undoDepth(props.gameId))
			} catch (e) {
				if (alive) setLoadError(e instanceof Error ? e.message : String(e))
			}
		})()
		return () => {
			alive = false
		}
	}, [props.storage, props.gameId])

	// Уходим с экрана — глушим микрофон и речь: иначе горит индикатор записи.
	useEffect(
		() => () => {
			dictationRef.current?.stop()
			recordingRef.current?.cancel()
			stopSpeaking()
		},
		[],
	)

	const local = props.settings.engine === "local"

	const llm = useMemo(
		() =>
			openAiCompatible({
				baseUrl: props.settings.baseUrl,
				apiKey: props.settings.apiKey,
				model: props.settings.model,
				temperature: props.settings.temperature,
				proxyPath: "/api/llm",
				structured: props.settings.structured,
				stream: props.settings.stream,
			}),
		[
			props.settings.baseUrl,
			props.settings.apiKey,
			props.settings.model,
			props.settings.temperature,
			props.settings.structured,
			props.settings.stream,
		],
	)

	const narrator = useMemo(() => (local ? createLocalNarrator() : null), [local])

	const session = useMemo(() => {
		if (!record) return null
		return new Session({
			record,
			storage: props.storage,
			prompts: PROMPTS,
			...(local ? { narrator: narrator ?? undefined } : { llm }),
			twoPhase: props.settings.twoPhase,
			modelName: local ? "свой движок" : props.settings.model,
		})
	}, [record, props.storage, llm, narrator, local, props.settings.model, props.settings.twoPhase])

	useEffect(() => {
		const el = feedRef.current
		if (el) el.scrollTop = el.scrollHeight
	}, [tick, streaming])

	const send = useCallback(
		async (text: string) => {
			if (!session || busy) return
			const value = text.trim()
			if (!value) return
			// Говорить и слушать одновременно нельзя: синтез попадает в микрофон.
			dictationRef.current?.stop()
			dictationRef.current = null
			setListening(false)
			setInterim("")
			stopSpeaking()
			// Экспорт уезжает файлом на устройство; в ленте останется одна строчка-квитанция.
			if (value === "((экспорт))") {
				const saved = downloadText(
					session.exportJson(),
					exportFileName(record?.title ?? "sim", session.state.clock.turn),
				)
				if (!saved) setVoiceError("Браузер не дал скачать файл. Состояние цело, повторите позже.")
			}
			const controller = new AbortController()
			abortRef.current = controller
			const timer = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS)
			setBusy(true)
			setStreaming("")
			try {
				await session.turn(value, {
					signal: controller.signal,
					onToken: (chunk) => setStreaming((prev) => prev + chunk),
				})
			} catch (e) {
				// J. Сюда мы попадаем только при сбое самого хранилища: ошибки модели сессия обрабатывает сама.
				setLoadError(e instanceof Error ? e.message : String(e))
			} finally {
				clearTimeout(timer)
				abortRef.current = null
				setStreaming("")
				setBusy(false)
				setInput("")
				setTick((t) => t + 1)
				setUndoDepth(await props.storage.undoDepth(props.gameId))
			}
		},
		[session, busy, props.storage, props.gameId, record?.title],
	)

	// Состояние не пострадает: сессия коммитит только после целого ответа.
	const stopTurn = useCallback(() => {
		abortRef.current?.abort()
	}, [])

	const caps = voiceCapabilities(Boolean(props.settings.apiKey.trim()))
	const voiceMode = pickVoiceMode(props.settings.voice, caps)

	/** Финальная фраза с голоса: локальная команда — сразу, всё остальное — в поле. */
	const acceptSpeech = useCallback(
		(text: string, currentInput: string) => {
			const command = matchSpokenCommand(text)
			if (command && !currentInput.trim() && isLocalCommand(command)) {
				void send(command)
				return
			}
			setFreeText(true)
			setInput((prev) => appendDictation(prev, text))
		},
		[send],
	)

	const stopVoice = useCallback(async () => {
		if (dictationRef.current) {
			dictationRef.current.stop()
			dictationRef.current = null
			setListening(false)
			return
		}
		const rec = recordingRef.current
		if (!rec) return
		recordingRef.current = null
		setListening(false)
		setDecoding(true)
		try {
			const audio = await rec.stop()
			if (audio.size === 0) return
			const text = await transcribeAudio(
				{
					baseUrl: props.settings.baseUrl,
					apiKey: props.settings.apiKey,
					model: props.settings.transcribeModel,
					proxyPath: "/api/llm",
					language: props.settings.voiceLang,
				},
				audio,
			)
			if (text) acceptSpeech(text, input)
		} catch (e) {
			setVoiceError(e instanceof Error ? e.message : String(e))
		} finally {
			setDecoding(false)
		}
	}, [acceptSpeech, input, props.settings])

	const startVoice = useCallback(async () => {
		setVoiceError(null)
		stopSpeaking()
		if (voiceMode === "off") {
			setVoiceError(voiceModeExplanation(props.settings.voice, caps))
			return
		}
		if (voiceMode === "web") {
			const d = createDictation({
				lang: props.settings.voiceLang,
				onInterim: setInterim,
				onFinal: (text) => acceptSpeech(text, input),
				onError: (message) => setVoiceError(message),
				onEnd: () => {
					dictationRef.current = null
					setListening(false)
				},
			})
			if (!d) {
				setVoiceError("Браузер не умеет распознавание речи.")
				return
			}
			dictationRef.current = d
			setListening(true)
			d.start()
			return
		}
		try {
			recordingRef.current = await startRecording()
			setListening(true)
		} catch (e) {
			setVoiceError(
				e instanceof Error && e.name === "NotAllowedError"
					? "Браузер запретил микрофон. Разрешите доступ в настройках сайта."
					: e instanceof Error
						? e.message
						: String(e),
			)
		}
	}, [acceptSpeech, caps, input, props.settings.voice, props.settings.voiceLang, voiceMode])

	// Озвучка только после завершённого хода: читать стрим по кускам — каша из обрывков.
	useEffect(() => {
		if (!props.settings.speak || busy || !record) return
		const last = [...record.transcript].reverse().find((e) => e.kind === "prose")
		if (!last || spokenRef.current === last.id) return
		spokenRef.current = last.id
		speak(stripForSpeech(last.text), props.settings.voiceLang)
	}, [tick, busy, record, props.settings.speak, props.settings.voiceLang])

	/** Правила партии меняются на месте: они живут в состоянии, а не в настройках приложения. */
	const applyTuning = useCallback(
		async (next: Tuning) => {
			if (!record) return
			record.state = normalizeState({ ...record.state, tuning: readTuning(next) })
			await props.storage.saveGame(record)
			setTick((t) => t + 1)
		},
		[record, props.storage],
	)

	if (loadError && !record) {
		return (
			<Screen title="Игра" onBack={() => void props.onBack()}>
				<Notice kind="bad">{loadError}</Notice>
			</Screen>
		)
	}

	if (!record || !session) {
		return (
			<Screen title="Игра" onBack={() => void props.onBack()}>
				<div className="center muted">Загружаю партию…</div>
			</Screen>
		)
	}

	const s = record.state
	const ready = isConfigured(props.settings)
	const twoD = props.settings.view === "2d"
	const lastProse = [...record.transcript].reverse().find((e) => e.kind === "prose")
	const lastSystem = record.transcript[record.transcript.length - 1]
	const actions = suggestActions(s)

	const composer = (
		<div className="composer">
			{/* Колода живёт в подвале нарочно: до действия должно быть можно дотянуться
			    пальцем, не прокручивая прозу. На узком экране это ряд карт, на широком — сетка. */}
			{twoD && !s.dead ? (
				<ActionDeck actions={actions} disabled={busy} onPick={(text) => void send(text)} />
			) : null}
			{listening || interim ? (
				<div className="interim" aria-live="polite">
					{interim || (voiceMode === "web" ? "слушаю…" : "записываю… нажмите ■, когда закончите")}
				</div>
			) : null}
			{twoD && !freeText ? (
				<div className="line">
					<MicButton
						listening={listening}
						busy={decoding}
						disabled={busy || decoding || s.dead || voiceMode === "off"}
						hint={voiceModeExplanation(props.settings.voice, caps)}
						onClick={() => void (listening ? stopVoice() : startVoice())}
					/>
					<button
						type="button"
						className="ghost grow"
						disabled={busy || s.dead}
						onClick={() => setFreeText(true)}
					>
						Сказать своими словами
					</button>
				</div>
			) : (
				<div className="line">
					<MicButton
						listening={listening}
						busy={decoding}
						disabled={busy || decoding || s.dead || voiceMode === "off"}
						hint={voiceModeExplanation(props.settings.voice, caps)}
						onClick={() => void (listening ? stopVoice() : startVoice())}
					/>
					<textarea
						rows={2}
						value={input}
						placeholder={s.dead ? "Персонаж мёртв. Нужна новая партия." : "Что вы делаете?"}
						disabled={busy || s.dead}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault()
								void send(input)
							}
						}}
					/>
					{busy ? (
						<button type="button" className="send stop" onClick={stopTurn}>
							Стоп
						</button>
					) : (
						<button
							type="button"
							className="primary send"
							disabled={s.dead || !input.trim()}
							onClick={() => void send(input)}
						>
							Ход
						</button>
					)}
				</div>
			)}
			<CommandBar undoDepth={undoDepth} disabled={busy} onCommand={(text) => void send(text)} />
		</div>
	)

	return (
		<Screen
			title={record.title}
			subtitle={`ход ${s.clock.turn} · день ${s.clock.day}${s.dead ? " · персонаж мёртв" : ""}`}
			onBack={() => void props.onBack()}
			action={
				<div className="row">
					<button
						type="button"
						className="ghost small"
						aria-pressed={twoD}
						title="Переключить вид"
						onClick={() =>
							props.onChangeSettings({ ...props.settings, view: twoD ? "text" : "2d" })
						}
					>
						{twoD ? "Текст" : "2D"}
					</button>
					<button type="button" className="ghost small" onClick={props.onOpenSettings}>
						Настройки
					</button>
				</div>
			}
			footer={composer}
		>
			<StatePanel state={s} open={panelOpen} onToggle={() => setPanelOpen((v) => !v)} />

			{!ready ? (
				<Notice kind="bad">
					Модель выбрана, но ключ или имя не заданы. Можно вернуться к своему движку — он играет без
					ключа.{" "}
					<button
						type="button"
						className="ghost small"
						onClick={() => props.onChangeSettings({ ...props.settings, engine: "local" })}
					>
						Играть без ключа
					</button>
				</Notice>
			) : null}

			{voiceError ? (
				<Notice kind="bad">
					{voiceError}{" "}
					<button type="button" className="ghost small" onClick={() => setVoiceError(null)}>
						Понятно
					</button>
				</Notice>
			) : null}

			{twoD ? (
				<div className="play">
					<Scene2D
						state={s}
						busy={busy}
						onPickPerson={(name) => void send(`поговорить: ${name}`)}
					/>

					<article className="scene-prose" aria-live="polite">
						{busy ? (
							<>
								{streaming ? <p>{streaming}</p> : null}
								<div className="row muted">
									<span className="spinner" aria-hidden="true" />
									{local ? "движок собирает сцену…" : streaming ? "модель пишет…" : "ждём ответ…"}
								</div>
							</>
						) : lastProse ? (
							lastProse.text.split(/\n{2,}/).map((para, i) => (
								<p key={i} style={{ ["--i" as string]: String(i) }}>
									{para}
								</p>
							))
						) : (
							<p>
								Мир готов. Выберите действие ниже — или скажите своими словами, что вы делаете.
							</p>
						)}
						{!busy && lastSystem && lastSystem.kind === "system" ? (
							<pre className="turn-system">{lastSystem.text}</pre>
						) : null}
					</article>

					{s.dead ? (
						<Notice kind="bad">Эта жизнь кончилась. Начните новую партию — мир останется прежним.</Notice>
					) : null}

					{/* Неуправляемый details нарочно: свой open плюс нативный переключатель
					    спорят друг с другом, и блок закрывается сам после любого клика внутри. */}
					<details className="rules">
						<summary>Правила партии и подробности</summary>
						<div className="rules-body">
							<TuningCard value={tuningOf(s)} onChange={(next) => void applyTuning(next)} openKnobs />
						</div>
					</details>
				</div>
			) : (
				<div className="feed" ref={feedRef}>
					{record.transcript.length === 0 ? (
						<div className="card muted">
							Мир готов. Напишите или надиктуйте первое действие — например, где вы проснулись и что
							делаете первым делом.
						</div>
					) : null}

					{record.transcript.map((e) => (
						<TurnCard key={e.id} entry={e} debug={props.settings.debug} />
					))}

					{busy ? (
						<article className="turn-prose">
							{streaming ? <p>{streaming}</p> : null}
							<div className="row muted">
								<span className="spinner" aria-hidden="true" />
								{streaming ? "рассказчик пишет…" : "ждём ответ…"}
							</div>
						</article>
					) : null}
				</div>
			)}
		</Screen>
	)
}
