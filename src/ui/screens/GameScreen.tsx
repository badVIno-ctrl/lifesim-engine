// Экран 4. ИГРА. Вся логика хода — в src/session.ts и src/engine.ts.
// Здесь только: показать ленту, собрать ввод (руками или голосом),
// показать поток и ошибку по-человечески.
//
// Голос СОЗНАТЕЛЬНО не отправляет ход сам: ход необратим и стоит токенов,
// поэтому распознанный текст всегда падает в поле ввода для правки.
// Единственное исключение — локальные команды: они без модели и обратимы.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Notice, Screen } from "../components/Screen.tsx"
import { CommandBar } from "../components/CommandBar.tsx"
import { MicButton } from "../components/MicButton.tsx"
import { StatePanel } from "../components/StatePanel.tsx"
import { TurnCard } from "../components/TurnCard.tsx"
import { Session, exportFileName, isLocalCommand } from "../../session.ts"
import { downloadText } from "../download.ts"
import { openAiCompatible } from "../../llm.ts"
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

	const session = useMemo(() => {
		if (!record) return null
		return new Session({
			record,
			storage: props.storage,
			prompts: PROMPTS,
			llm,
			modelName: props.settings.model,
		})
	}, [record, props.storage, llm, props.settings.model])

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
		[session, busy, props.storage, props.gameId],
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

	return (
		<Screen
			title={record.title}
			subtitle={`ход ${s.clock.turn} · день ${s.clock.day}${s.dead ? " · персонаж мёртв" : ""}`}
			onBack={() => void props.onBack()}
			action={
				<button type="button" className="ghost small" onClick={props.onOpenSettings}>
					Настройки
				</button>
			}
			footer={
				<div className="composer">
					<CommandBar
						undoDepth={undoDepth}
						disabled={busy}
						onCommand={(text) => void send(text)}
					/>
					{listening || interim ? (
						<div className="interim" aria-live="polite">
							{interim || (voiceMode === "web" ? "слушаю…" : "записываю… нажмите ■, когда закончите")}
						</div>
					) : null}
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
				</div>
			}
		>
			<StatePanel state={s} open={panelOpen} onToggle={() => setPanelOpen((v) => !v)} />

			{!ready ? (
				<Notice kind="bad">
					Не задан ключ или модель. Локальные команды (снапшот, аудит, лог, цены, откат, экспорт) работают
					без модели, ходы — нет.{" "}
					<button type="button" className="ghost small" onClick={props.onOpenSettings}>
						Открыть настройки
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
							{streaming ? "модель пишет…" : "ждём ответ…"}
						</div>
					</article>
				) : null}
			</div>
		</Screen>
	)
}
