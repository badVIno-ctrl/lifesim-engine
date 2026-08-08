// Браузерная обёртка вокруг микрофона. Вся логика — в src/voice.ts,
// здесь только грязные веб-API, которые нельзя протестить в node.
// Типы SpeechRecognition объявлены руками: в lib.dom их до сих пор нет.
import type { VoiceCapabilities } from "../voice.ts"

type AlternativeLike = { transcript: string; confidence: number }
type ResultLike = { readonly length: number; isFinal: boolean; [i: number]: AlternativeLike }
type ResultListLike = { readonly length: number; [i: number]: ResultLike }
type ResultEventLike = { resultIndex: number; results: ResultListLike }
type ErrorEventLike = { error: string; message?: string }

type RecognitionLike = {
	lang: string
	continuous: boolean
	interimResults: boolean
	maxAlternatives: number
	start: () => void
	stop: () => void
	abort: () => void
	onresult: ((e: ResultEventLike) => void) | null
	onerror: ((e: ErrorEventLike) => void) | null
	onend: (() => void) | null
}

type RecognitionCtor = new () => RecognitionLike

function recognitionCtor(): RecognitionCtor | null {
	if (typeof window === "undefined") return null
	const w = window as unknown as {
		SpeechRecognition?: RecognitionCtor
		webkitSpeechRecognition?: RecognitionCtor
	}
	return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function voiceCapabilities(hasKey: boolean): VoiceCapabilities {
	const recorder =
		typeof window !== "undefined" &&
		typeof MediaRecorder !== "undefined" &&
		typeof navigator !== "undefined" &&
		Boolean(navigator.mediaDevices?.getUserMedia)
	return { webSpeech: recognitionCtor() !== null, recorder, hasKey }
}

/** Ошибки микрофона игрок должен понимать без поиска в интернете. */
export function humanSpeechError(code: string): string {
	switch (code) {
		case "not-allowed":
		case "service-not-allowed":
			return "Браузер запретил микрофон. Разрешите доступ в настройках сайта."
		case "no-speech":
			return "Ничего не услышал."
		case "audio-capture":
			return "Микрофон не найден."
		case "network":
			return "Распознавание речи браузера требует сети, а сети нет."
		case "aborted":
			return ""
		default:
			return `Микрофон отвалился: ${code}`
	}
}

export type Dictation = {
	start: () => void
	stop: () => void
}

/**
 * Диктовка браузером. onFinal приходит на каждую завершённую фразу,
 * onInterim — черновик, который показываем серым и никуда не отправляем.
 */
export function createDictation(opts: {
	lang: string
	onInterim: (text: string) => void
	onFinal: (text: string) => void
	onError: (message: string) => void
	onEnd: () => void
}): Dictation | null {
	const Ctor = recognitionCtor()
	if (!Ctor) return null
	const rec = new Ctor()
	rec.lang = opts.lang
	rec.continuous = true
	rec.interimResults = true
	rec.maxAlternatives = 1
	let closed = false

	rec.onresult = (e) => {
		let interim = ""
		for (let i = e.resultIndex; i < e.results.length; i++) {
			const r = e.results[i]
			const text = r[0]?.transcript ?? ""
			if (r.isFinal) opts.onFinal(text)
			else interim += text
		}
		opts.onInterim(interim)
	}
	rec.onerror = (e) => {
		const message = humanSpeechError(e.error)
		if (message) opts.onError(message)
	}
	rec.onend = () => {
		opts.onInterim("")
		if (!closed) {
			closed = true
			opts.onEnd()
		}
	}

	return {
		start: () => {
			try {
				rec.start()
			} catch (e) {
				opts.onError(e instanceof Error ? e.message : String(e))
				closed = true
				opts.onEnd()
			}
		},
		stop: () => {
			try {
				rec.stop()
			} catch {
				/* уже остановлен */
			}
			opts.onInterim("")
			if (!closed) {
				closed = true
				opts.onEnd()
			}
		},
	}
}

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]

export function pickRecordingMime(): string | null {
	if (typeof MediaRecorder === "undefined") return null
	for (const m of MIME_CANDIDATES) {
		if (MediaRecorder.isTypeSupported(m)) return m
	}
	return null
}

export type Recording = {
	/** Остановить и отдать запись. */
	stop: () => Promise<Blob>
	/** Остановить и выбросить. */
	cancel: () => void
}

/** Запись с микрофона для режима whisper. Дорожки всегда глушим — иначе горит индикатор. */
export async function startRecording(): Promise<Recording> {
	const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
	const mime = pickRecordingMime()
	const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
	const chunks: Blob[] = []
	rec.ondataavailable = (e) => {
		if (e.data && e.data.size > 0) chunks.push(e.data)
	}
	rec.start()
	const release = () => {
		for (const t of stream.getTracks()) t.stop()
	}
	return {
		stop: () =>
			new Promise<Blob>((resolve) => {
				rec.onstop = () => {
					release()
					resolve(new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" }))
				}
				try {
					rec.stop()
				} catch {
					release()
					resolve(new Blob(chunks, { type: mime || "audio/webm" }))
				}
			}),
		cancel: () => {
			try {
				rec.stop()
			} catch {
				/* уже остановлен */
			}
			release()
		},
	}
}

/* ────────────── Голос наружу: чтение прозы вслух ────────────── */

export function speechSynthesisSupported(): boolean {
	return typeof window !== "undefined" && "speechSynthesis" in window
}

export function speak(text: string, lang: string): void {
	if (!speechSynthesisSupported() || !text.trim()) return
	window.speechSynthesis.cancel()
	const u = new SpeechSynthesisUtterance(text)
	u.lang = lang
	window.speechSynthesis.speak(u)
}

export function stopSpeaking(): void {
	if (speechSynthesisSupported()) window.speechSynthesis.cancel()
}
