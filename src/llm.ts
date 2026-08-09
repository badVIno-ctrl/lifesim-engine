// Транспорт к любому OpenAI-совместимому эндпоинту. Изоморфно: только fetch.
// Никакой логики мира здесь нет — только сеть, стриминг и парсинг ответа.
import { TURN_SCHEMA } from "./delta-schema.ts"
import type { Delta } from "./types.ts"

export type LlmMessage = { role: "system" | "user" | "assistant"; content: string }

export type LlmUsage = { prompt: number; completion: number; total: number } | null

export type LlmResult = {
	text: string
	usage: LlmUsage
	/** Заполнено, если ответ пришёл через json_schema. */
	structured: { prose: string; delta: Delta } | null
	mode: "json_schema" | "text"
}

export type LlmConfig = {
	baseUrl: string
	apiKey: string
	model: string
	temperature: number
	/** Путь локального прокси. В браузере — "/api/llm", в CLI — пусто (прямой вызов). */
	proxyPath?: string
	/** J. Разрешить structured output. При отказе эндпоинта автоматически выключается. */
	structured?: boolean
	stream?: boolean
}

export type LlmCallOptions = {
	onToken?: (chunk: string) => void
	signal?: AbortSignal
	/** Подмена fetch для тестов. */
	fetchImpl?: typeof fetch
}

export type LlmCaller = (messages: LlmMessage[], opts?: LlmCallOptions) => Promise<LlmResult>

/** Ошибка транспорта с человеческим текстом — игроку не показывают стектрейс (J). */
export class LlmError extends Error {
	status: number
	detail: string
	constructor(message: string, status = 0, detail = "") {
		super(message)
		this.name = "LlmError"
		this.status = status
		this.detail = detail
	}
}

function trimSlash(u: string): string {
	return u.replace(/\/+$/, "")
}

function endpoint(cfg: LlmConfig, path: string): string {
	if (cfg.proxyPath) return `${trimSlash(cfg.proxyPath)}${path}`
	return `${trimSlash(cfg.baseUrl)}${path}`
}

function headers(cfg: LlmConfig): Record<string, string> {
	const h: Record<string, string> = { "content-type": "application/json" }
	if (cfg.proxyPath) {
		// Ключ и адрес идут транзитом через локальный прокси и нигде не сохраняются.
		h["x-llm-base"] = trimSlash(cfg.baseUrl)
		if (cfg.apiKey) h["x-llm-key"] = cfg.apiKey
	} else if (cfg.apiKey) {
		h["authorization"] = `Bearer ${cfg.apiKey}`
	}
	return h
}

function humanHttpError(status: number, body: string): string {
	if (status === 401 || status === 403) return "Ключ не принят эндпоинтом. Проверьте ключ в настройках."
	if (status === 404) return "Эндпоинт не нашёл маршрут. Проверьте базовый URL и имя модели."
	if (status === 429) return "Эндпоинт ограничил частоту запросов. Подождите и повторите ход."
	if (status >= 500) return "Эндпоинт ответил ошибкой сервера. Состояние мира не изменилось."
	const snippet = body.slice(0, 200)
	return `Эндпоинт ответил кодом ${status}. ${snippet}`
}

function looksLikeSchemaRefusal(status: number, body: string): boolean {
	if (status !== 400 && status !== 404 && status !== 422 && status !== 501) return false
	const b = body.toLowerCase()
	if (looksLikeTemperatureRefusal(status, body)) return false
	return (
		b.includes("response_format") ||
		b.includes("json_schema") ||
		b.includes("structured") ||
		b.includes("unsupported")
	)
}

/**
 * Reasoning-модели (o-серия и родня) отказываются от `temperature` целиком:
 * не «игнорирую», а 400 с текстом про неподдерживаемый параметр.
 * Признак узкий: в ответе назван сам параметр. Иначе мы бы снимали температуру
 * на любой ошибке и молча меняли поведение обычных моделей.
 */
export function looksLikeTemperatureRefusal(status: number, body: string): boolean {
	if (status !== 400 && status !== 422) return false
	const b = body.toLowerCase()
	if (!b.includes("temperature")) return false
	return (
		b.includes("unsupported") ||
		b.includes("not support") ||
		b.includes("does not support") ||
		b.includes("only the default") ||
		b.includes("invalid") ||
		b.includes("unexpected")
	)
}

/**
 * Собирает вызывателя модели. Два факта об эндпоинте запоминаются в замыкании и
 * больше не проверяются: «не умеет схему» и «не принимает температуру».
 * Оба выясняются одним автоматическим повтором, а не настройкой в интерфейсе.
 */
export function openAiCompatible(cfg: LlmConfig): LlmCaller {
	let structuredSupported = cfg.structured !== false
	let temperatureSupported = true

	return async function call(messages: LlmMessage[], opts: LlmCallOptions = {}): Promise<LlmResult> {
		const doFetch = opts.fetchImpl ?? globalThis.fetch
		if (typeof doFetch !== "function") throw new LlmError("В этой среде нет fetch.")
		if (!cfg.baseUrl) throw new LlmError("Не задан базовый URL эндпоинта. Откройте настройки.")
		if (!cfg.model) throw new LlmError("Не задано имя модели. Откройте настройки.")

		const wantStream = cfg.stream !== false && typeof opts.onToken === "function"

		const build = (withSchema: boolean, withTemperature: boolean): Record<string, unknown> => {
			const body: Record<string, unknown> = { model: cfg.model, messages }
			if (withTemperature) body.temperature = cfg.temperature
			if (wantStream) {
				body.stream = true
				body.stream_options = { include_usage: true }
			}
			if (withSchema) {
				body.response_format = {
					type: "json_schema",
					json_schema: { name: "sim_turn", strict: false, schema: TURN_SCHEMA },
				}
			}
			return body
		}

		const send = async (withSchema: boolean, withTemperature: boolean): Promise<LlmResult> => {
			let res: Response
			try {
				res = await doFetch(endpoint(cfg, "/chat/completions"), {
					method: "POST",
					headers: headers(cfg),
					body: JSON.stringify(build(withSchema, withTemperature)),
					signal: opts.signal,
				})
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e)
				if (msg.toLowerCase().includes("abort")) throw new LlmError("Запрос отменён.", 0, msg)
				throw new LlmError("Не удалось связаться с эндпоинтом. Проверьте сеть и адрес.", 0, msg)
			}

			if (!res.ok) {
				const body = await safeText(res)
				// Один повтор на одну причину: спорный параметр снимается, ход не теряется.
				if (withTemperature && looksLikeTemperatureRefusal(res.status, body)) {
					temperatureSupported = false
					return send(withSchema, false)
				}
				if (withSchema && looksLikeSchemaRefusal(res.status, body)) {
					structuredSupported = false
					return send(false, withTemperature)
				}
				throw new LlmError(humanHttpError(res.status, body), res.status, body)
			}

			// Со схемой игроку показывается только проза, а не служебный JSON.
			const sink =
				withSchema && opts.onToken ? createProseStreamer(opts.onToken) : opts.onToken
			const out = wantStream ? await readStream(res, sink) : await readJson(res)

			const result: LlmResult = {
				text: out.text,
				usage: out.usage,
				structured: null,
				mode: withSchema ? "json_schema" : "text",
			}
			if (withSchema) {
				const parsed = parseStructured(out.text)
				if (parsed) result.structured = parsed
				else result.mode = "text" // модель ответила не по схеме — падаем на <delta>
			}
			return result
		}

		return send(structuredSupported, temperatureSupported)
	}
}

/**
 * При structured output модель стримит JSON, а не прозу. Сырой JSON в ленте — дыра в атмосфере,
 * поэтому вытаскиваем на лету только содержимое поля "prose" и ничего больше.
 * Гарантии: никогда не отдаёт недописанный escape и ни одного символа после конца строки.
 */
export function createProseStreamer(onToken: (chunk: string) => void): (piece: string) => void {
	let buf = ""
	let started = false
	let emitted = 0
	let finished = false

	return (piece: string): void => {
		if (finished) return
		buf += piece
		if (!started) {
			const m = buf.match(/"prose"\s*:\s*"/)
			if (!m || m.index === undefined) return
			started = true
			buf = buf.slice(m.index + m[0].length)
		}

		let end = -1
		for (let i = 0; i < buf.length; i += 1) {
			if (buf[i] !== '"') continue
			let slashes = 0
			for (let j = i - 1; j >= 0 && buf[j] === "\\"; j -= 1) slashes += 1
			if (slashes % 2 === 0) {
				end = i
				break
			}
		}

		const raw = end === -1 ? buf : buf.slice(0, end)
		let safe = raw.length
		if (end === -1) {
			// Незакрытый escape на границе куска придётся дождаться.
			const tail = raw.slice(Math.max(0, raw.length - 6))
			const hanging = tail.match(/\\(?:u[0-9a-fA-F]{0,3})?$/)
			if (hanging) safe -= hanging[0].length
		}
		if (safe > emitted) {
			const chunk = decodeJsonChunk(raw.slice(emitted, safe))
			emitted = safe
			if (chunk) onToken(chunk)
		}
		if (end !== -1) finished = true
	}
}

function decodeJsonChunk(s: string): string {
	if (!s) return ""
	try {
		return JSON.parse(`"${s}"`) as string
	} catch {
		return s
	}
}

function parseStructured(text: string): { prose: string; delta: Delta } | null {
	const t = text.trim()
	if (!t.startsWith("{")) return null
	try {
		const o = JSON.parse(t) as Record<string, unknown>
		if (typeof o.prose !== "string") return null
		const delta = (o.delta ?? {}) as Delta
		if (typeof delta !== "object" || delta === null) return null
		return { prose: o.prose, delta }
	} catch {
		return null
	}
}

async function safeText(res: Response): Promise<string> {
	try {
		return await res.text()
	} catch {
		return ""
	}
}

async function readJson(res: Response): Promise<{ text: string; usage: LlmUsage }> {
	const raw = await safeText(res)
	let data: any
	try {
		data = JSON.parse(raw)
	} catch {
		throw new LlmError("Эндпоинт вернул не JSON. Проверьте базовый URL.", res.status, raw.slice(0, 200))
	}
	const text: string = data?.choices?.[0]?.message?.content ?? ""
	if (!text) {
		const err = data?.error?.message
		if (err) throw new LlmError(`Эндпоинт сообщил об ошибке: ${err}`, res.status, raw.slice(0, 200))
	}
	return { text, usage: readUsage(data?.usage) }
}

function readUsage(u: any): LlmUsage {
	if (!u) return null
	return {
		prompt: Number(u.prompt_tokens ?? 0),
		completion: Number(u.completion_tokens ?? 0),
		total: Number(u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0)),
	}
}

/** Разбор SSE. Стриминг — необязательная роскошь: если её нет, вызов идёт обычным JSON. */
async function readStream(
	res: Response,
	onToken?: (chunk: string) => void,
): Promise<{ text: string; usage: LlmUsage }> {
	const ct = res.headers.get("content-type") ?? ""
	if (!ct.includes("text/event-stream") || !res.body) return readJson(res)

	const reader = res.body.getReader()
	const decoder = new TextDecoder()
	let buffer = ""
	let text = ""
	let usage: LlmUsage = null

	for (;;) {
		const { done, value } = await reader.read()
		if (done) break
		buffer += decoder.decode(value, { stream: true })
		const lines = buffer.split("\n")
		buffer = lines.pop() ?? ""
		for (const raw of lines) {
			const l = raw.trim()
			if (!l.startsWith("data:")) continue
			const payload = l.slice(5).trim()
			if (!payload || payload === "[DONE]") continue
			try {
				const chunk = JSON.parse(payload)
				const piece: string = chunk?.choices?.[0]?.delta?.content ?? ""
				if (piece) {
					text += piece
					onToken?.(piece)
				}
				if (chunk?.usage) usage = readUsage(chunk.usage)
			} catch {
				// битый кусок — пропускаем, ход не теряется
			}
		}
	}
	return { text, usage }
}

/** Кнопка «Проверить соединение» в настройках. */
export async function probeConnection(
	cfg: LlmConfig,
	opts: LlmCallOptions = {},
): Promise<{ ok: boolean; message: string }> {
	const doFetch = opts.fetchImpl ?? globalThis.fetch
	if (!cfg.baseUrl) return { ok: false, message: "Не заполнен базовый URL." }
	if (!cfg.model) return { ok: false, message: "Не заполнено имя модели." }
	try {
		const res = await doFetch(endpoint(cfg, "/models"), {
			method: "GET",
			headers: headers(cfg),
			signal: opts.signal,
		})
		if (res.ok) {
			const raw = await safeText(res)
			let count = 0
			try {
				count = JSON.parse(raw)?.data?.length ?? 0
			} catch {
				count = 0
			}
			return { ok: true, message: count ? `Связь есть. Моделей доступно: ${count}.` : "Связь есть." }
		}
	} catch {
		// пробуем вторым способом
	}
	try {
		const call = openAiCompatible({ ...cfg, structured: false, stream: false })
		const r = await call([{ role: "user", content: "ping" }], opts)
		return { ok: true, message: `Связь есть. Модель ответила ${r.text.trim().slice(0, 40) || "пустотой"}.` }
	} catch (e) {
		const msg = e instanceof LlmError ? e.message : e instanceof Error ? e.message : String(e)
		return { ok: false, message: msg }
	}
}
