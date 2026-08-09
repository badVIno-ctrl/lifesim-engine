// Настройки живут в localStorage. Ключ никуда не уходит, кроме выбранного эндпоинта
// (транзитом через локальный прокси, который его не хранит и не логирует).
// Приложение обязано запускаться БЕЗ ключа — поэтому все поля имеют безопасные умолчания.

import { DEFAULT_TRANSCRIBE_MODEL } from "../voice.ts"
import type { VoicePreference } from "../voice.ts"

/**
 * Кто ведёт ход. «local» — свой движок в коде: без ключа, без сети, без токенов.
 * Это значение по умолчанию, потому что игра обязана начинаться с игры,
 * а не с формы для чужого ключа.
 */
export type EngineChoice = "local" | "llm"

/** Как показывать сцену: 2D-вид или чистый текст. */
export type ViewMode = "2d" | "text"

export type Settings = {
	engine: EngineChoice
	view: ViewMode
	/** Двухфазный ход у модели: сначала дельта, потом проза по применённому состоянию. */
	twoPhase: boolean
	baseUrl: string
	apiKey: string
	model: string
	temperature: number
	debug: boolean
	stream: boolean
	structured: boolean
	/** Откуда берётся текст с голоса: auto — сначала браузер, потом эндпоинт. */
	voice: VoicePreference
	/** Язык распознавания и озвучки. */
	voiceLang: string
	/** Модель расшифровки для режима whisper. */
	transcribeModel: string
	/** Читать прозу вслух. */
	speak: boolean
}

export const DEFAULT_SETTINGS: Settings = {
	engine: "local",
	view: "2d",
	twoPhase: false,
	baseUrl: "https://api.openai.com/v1",
	apiKey: "",
	model: "gpt-4o-mini",
	temperature: 0.8,
	debug: false,
	stream: true,
	structured: true,
	voice: "auto",
	voiceLang: "ru-RU",
	transcribeModel: DEFAULT_TRANSCRIBE_MODEL,
	speak: false,
}

const KEY = "sim-v13.settings"

export const VOICE_PREFERENCES: VoicePreference[] = ["auto", "web", "whisper", "off"]

function isVoicePreference(v: unknown): v is VoicePreference {
	return typeof v === "string" && (VOICE_PREFERENCES as string[]).includes(v)
}

function safeStorage(): globalThis.Storage | null {
	try {
		if (typeof localStorage === "undefined") return null
		localStorage.getItem(KEY)
		return localStorage
	} catch {
		return null
	}
}

export function loadSettings(): Settings {
	const ls = safeStorage()
	if (!ls) return { ...DEFAULT_SETTINGS }
	const raw = ls.getItem(KEY)
	if (!raw) return { ...DEFAULT_SETTINGS }
	try {
		const parsed = JSON.parse(raw) as Partial<Settings>
		return {
			// Старая сохранённая настройка не знала про свой движок. Если ключ уже введён,
			// уважаем выбор игрока; если нет — играем без ключа.
			engine:
				parsed.engine === "llm" || parsed.engine === "local"
					? parsed.engine
					: typeof parsed.apiKey === "string" && parsed.apiKey.trim()
						? "llm"
						: "local",
			view: parsed.view === "text" ? "text" : "2d",
			twoPhase: parsed.twoPhase === true,
			baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : DEFAULT_SETTINGS.baseUrl,
			apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
			model: typeof parsed.model === "string" ? parsed.model : DEFAULT_SETTINGS.model,
			temperature:
				typeof parsed.temperature === "number" && Number.isFinite(parsed.temperature)
					? Math.min(2, Math.max(0, parsed.temperature))
					: DEFAULT_SETTINGS.temperature,
			debug: parsed.debug === true,
			stream: parsed.stream !== false,
			structured: parsed.structured !== false,
			voice: isVoicePreference(parsed.voice) ? parsed.voice : DEFAULT_SETTINGS.voice,
			voiceLang:
				typeof parsed.voiceLang === "string" && parsed.voiceLang.trim()
					? parsed.voiceLang
					: DEFAULT_SETTINGS.voiceLang,
			transcribeModel:
				typeof parsed.transcribeModel === "string" && parsed.transcribeModel.trim()
					? parsed.transcribeModel
					: DEFAULT_SETTINGS.transcribeModel,
			speak: parsed.speak === true,
		}
	} catch {
		return { ...DEFAULT_SETTINGS }
	}
}

export function saveSettings(s: Settings): void {
	const ls = safeStorage()
	if (!ls) return
	ls.setItem(KEY, JSON.stringify(s))
}

/** Можно ли делать ходы. Со своим движком — всегда можно. */
export function isConfigured(s: Settings): boolean {
	if (s.engine === "local") return true
	return Boolean(s.baseUrl.trim() && s.model.trim() && s.apiKey.trim())
}
