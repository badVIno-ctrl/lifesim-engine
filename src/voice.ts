// Голос: чистая логика. Ни микрофона, ни DOM — только выбор режима, нормализация
// распознанного текста и HTTP к /audio/transcriptions. Изоморфно: только fetch.
//
// Правило проекта то же, что и для модели: голос — это ТОЛЬКО способ набрать текст.
// Голос не меняет состояние мира напрямую и никогда не отправляет ход сам.
import { LlmError } from "./llm.ts"
import { LOCAL_COMMANDS, MODEL_COMMANDS } from "./session.ts"

export type VoicePreference = "off" | "auto" | "web" | "whisper"
export type VoiceMode = "off" | "web" | "whisper"

export type VoiceCapabilities = {
	/** Браузер умеет SpeechRecognition (Chrome, Safari). */
	webSpeech: boolean
	/** Браузер умеет MediaRecorder + getUserMedia. */
	recorder: boolean
	/** Есть ключ к эндпоинту — без него расшифровка на сервере невозможна. */
	hasKey: boolean
}

export const DEFAULT_TRANSCRIBE_MODEL = "whisper-1"

/**
 * Выбор режима. "web" бесплатен и не тратит токены, поэтому в auto он первый.
 * Firefox не умеет SpeechRecognition вообще — там остаётся только whisper.
 */
export function pickVoiceMode(pref: VoicePreference, caps: VoiceCapabilities): VoiceMode {
	const whisperOk = caps.recorder && caps.hasKey
	if (pref === "off") return "off"
	if (pref === "web") return caps.webSpeech ? "web" : whisperOk ? "whisper" : "off"
	if (pref === "whisper") return whisperOk ? "whisper" : caps.webSpeech ? "web" : "off"
	return caps.webSpeech ? "web" : whisperOk ? "whisper" : "off"
}

/** Почему кнопка микрофона молчит — человеческим языком, без стектрейса (J). */
export function voiceModeExplanation(pref: VoicePreference, caps: VoiceCapabilities): string {
	const mode = pickVoiceMode(pref, caps)
	if (mode === "web") return "Распознавание речи браузером — бесплатно, токены не тратятся."
	if (mode === "whisper") return "Речь уходит на ваш эндпоинт (/audio/transcriptions) и тратит его квоту."
	if (pref === "off") return "Голосовой ввод выключен в настройках."
	if (!caps.recorder) return "Браузер не даёт доступ к микрофону. Нужен https или localhost."
	if (!caps.hasKey) return "Браузер не умеет распознавание речи, а для расшифровки на сервере нужен ключ."
	return "Голосовой ввод недоступен в этом браузере."
}

// Знаки препинания диктуем только в конце фразы: иначе «точка сборки» превратится
// в «сборки.» — цена ошибки выше пользы.
const TAIL_PUNCT: Array<[RegExp, string]> = [
	[/\s+точка$/i, "."],
	[/\s+запятая$/i, ","],
	[/\s+(?:вопрос|знак вопроса|вопросительный знак)$/i, "?"],
	[/\s+(?:восклицательный знак|восклицание)$/i, "!"],
	[/\s+двоеточие$/i, ":"],
	[/\s+тире$/i, " —"],
	[/\s+многоточие$/i, "…"],
]

/** Приводит сырой результат распознавания к тому, что не стыдно отправить как ход. */
export function normalizeDictation(raw: string): string {
	let t = raw.replace(/\s+/g, " ").trim()
	if (!t) return ""
	// Без \b: в JS он ASCII-only и с кириллицей молча не срабатывает.
	t = t.replace(/(?:^|\s)(?:с новой строки|новая строка|новый абзац)(?=\s|$)/gi, "\n")
	for (const [re, mark] of TAIL_PUNCT) t = t.replace(re, mark)
	t = t.replace(/\s+([.,!?;:…])/g, "$1")
	return t
		.split("\n")
		.map((line) => line.trim())
		.join("\n")
		.trim()
}

/** Дописывает распознанный кусок к тому, что уже набрано руками. */
export function appendDictation(existing: string, chunk: string): string {
	const add = normalizeDictation(chunk)
	if (!add) return existing
	const base = existing.replace(/[ \t]+$/, "")
	if (!base) return capitalize(add)
	const joiner = base.endsWith("\n") ? "" : " "
	const head = /[.!?…]$/.test(base) ? capitalize(add) : add
	return base + joiner + head
}

function capitalize(t: string): string {
	return t.charAt(0).toUpperCase() + t.slice(1)
}

const ALL_COMMANDS: ReadonlyArray<{ id: string; label: string; text: string }> = [
	...LOCAL_COMMANDS,
	...MODEL_COMMANDS,
]

// Синонимы работают ТОЛЬКО с явным словом «команда» впереди: «назад» и «сохрани» —
// это нормальные игровые действия, и отдавать их за откат/экспорт нельзя.
const ALIASES: Record<string, string> = {
	снимок: "snapshot",
	состояние: "snapshot",
	сверка: "audit",
	проверка: "audit",
	микролог: "log",
	цена: "prices",
	прайс: "prices",
	откати: "undo",
	отмени: "undo",
	отмена: "undo",
	назад: "undo",
	сохрани: "export",
	выгрузи: "export",
	финал: "epilogue",
	конец: "epilogue",
}

function normCommand(s: string): string {
	return s
		.toLowerCase()
		.replace(/ё/g, "е")
		.replace(/[()«»"'.,!?:;]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
}

/**
 * Распознаёт голосовую команду. Возвращает текст команды («((откат))») или null.
 * Срабатывает только на точное имя команды или на «команда <синоним>».
 */
export function matchSpokenCommand(spoken: string): string | null {
	const said = normCommand(spoken)
	if (!said) return null
	const stripped = said.replace(/^команда\s+/, "")
	const explicit = stripped !== said
	for (const c of ALL_COMMANDS) {
		if (normCommand(c.text) === stripped || normCommand(c.label) === stripped || c.id === stripped) {
			return c.text
		}
	}
	if (explicit) {
		const id = ALIASES[stripped]
		const c = ALL_COMMANDS.find((x) => x.id === id)
		if (c) return c.text
	}
	return null
}

/** Готовит прозу к синтезу речи: служебное вслух не читаем. */
export function stripForSpeech(text: string): string {
	return text
		.replace(/\(\([^)]*\)\)/g, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/[*_`#>|]/g, " ")
		.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim()
}

export type TranscribeConfig = {
	baseUrl: string
	apiKey: string
	/** Модель расшифровки. Пусто — whisper-1. */
	model?: string
	/** Путь локального прокси. В браузере — "/api/llm". */
	proxyPath?: string
	/** Подсказка языка, например "ru-RU" — в запрос уходит "ru". */
	language?: string
}

export type TranscribeOptions = {
	signal?: AbortSignal
	fetchImpl?: typeof fetch
	fileName?: string
}

function trimSlash(u: string): string {
	return u.replace(/\/+$/, "")
}

/** Имя файла важно: некоторые эндпоинты определяют формат по расширению. */
export function fileNameFor(mime: string): string {
	const m = mime.toLowerCase()
	if (m.includes("mp4") || m.includes("m4a")) return "speech.mp4"
	if (m.includes("ogg")) return "speech.ogg"
	if (m.includes("wav")) return "speech.wav"
	if (m.includes("mpeg") || m.includes("mp3")) return "speech.mp3"
	return "speech.webm"
}

export function humanTranscribeError(status: number, body: string): string {
	if (status === 401 || status === 403) return "Эндпоинт не принял ключ для расшифровки речи."
	if (status === 404) return "На этом эндпоинте нет /audio/transcriptions. Выберите распознавание браузером."
	if (status === 413) return "Запись слишком длинная для эндпоинта. Говорите короче."
	if (status === 429) return "Эндпоинт просит подождать: лимит запросов."
	if (status >= 500) return "Эндпоинт сломался на расшифровке речи. Попробуйте ещё раз."
	try {
		const j = JSON.parse(body) as { error?: { message?: string } }
		if (j.error?.message) return `Расшифровка не удалась: ${j.error.message}`
	} catch {
		/* тело не JSON — не страшно */
	}
	return `Расшифровка не удалась (код ${status}).`
}

/** Отправляет запись на OpenAI-совместимый /audio/transcriptions и возвращает текст. */
export async function transcribeAudio(
	cfg: TranscribeConfig,
	audio: Blob,
	opts: TranscribeOptions = {},
): Promise<string> {
	const call = opts.fetchImpl ?? fetch
	const base = cfg.proxyPath ? trimSlash(cfg.proxyPath) : trimSlash(cfg.baseUrl)
	const url = `${base}/audio/transcriptions`

	const form = new FormData()
	// content-type НЕ ставим руками: boundary выставляет сам FormData.
	form.append("file", audio, opts.fileName ?? fileNameFor(audio.type || ""))
	form.append("model", (cfg.model ?? "").trim() || DEFAULT_TRANSCRIBE_MODEL)
	if (cfg.language) form.append("language", cfg.language.slice(0, 2).toLowerCase())

	const headers: Record<string, string> = {}
	if (cfg.proxyPath) {
		headers["x-llm-base"] = cfg.baseUrl
		if (cfg.apiKey) headers["x-llm-key"] = cfg.apiKey
	} else if (cfg.apiKey) {
		headers.authorization = `Bearer ${cfg.apiKey}`
	}

	let res: Response
	try {
		res = await call(url, { method: "POST", headers, body: form, signal: opts.signal })
	} catch (e) {
		const reason = e instanceof Error ? e.message : String(e)
		throw new LlmError(`Не дошёл до расшифровки речи: ${reason}`, 0, reason)
	}

	const body = await res.text()
	if (!res.ok) throw new LlmError(humanTranscribeError(res.status, body), res.status, body)
	try {
		const j = JSON.parse(body) as { text?: string }
		if (typeof j.text === "string") return normalizeDictation(j.text)
	} catch {
		/* некоторые эндпоинты отдают plain text */
	}
	return normalizeDictation(body)
}
