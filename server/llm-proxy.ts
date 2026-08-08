// Единственная задача сервера во всём проекте: провести запрос к LLM через себя,
// чтобы браузер не упирался в CORS. Бизнес-логики здесь нет и быть не должно.
//
// Ключ и адрес эндпоинта приходят заголовками от клиента на каждый запрос,
// нигде не сохраняются и не логируются. Прокси не читает тело запроса и не разбирает ответ:
// тело идёт транзитом, стриминг сохраняется как есть.

export const LLM_PROXY_PREFIX = "/api/llm"

/** Заголовки, которые нельзя пересылать дальше как есть. */
const DROP_REQUEST_HEADERS = new Set([
	"host",
	"connection",
	"keep-alive",
	"transfer-encoding",
	"upgrade",
	"proxy-authorization",
	"proxy-connection",
	"content-length",
	"accept-encoding",
	"origin",
	"referer",
	"cookie",
	"x-llm-base",
	"x-llm-key",
])

const DROP_RESPONSE_HEADERS = new Set([
	"connection",
	"keep-alive",
	"transfer-encoding",
	"content-encoding",
	"content-length",
	"set-cookie",
])

function jsonError(message: string, status: number): Response {
	// Форма ответа такая же, как у OpenAI-совместимых эндпоинтов, —
	// клиент показывает игроку текст, а не стектрейс (пункт J).
	return new Response(JSON.stringify({ error: { message } }), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
	})
}

function trimSlash(u: string): string {
	return u.replace(/\/+$/, "")
}

/** Адрес эндпоинта задаёт игрок, поэтому проверяем его до вызова. */
function parseBase(raw: string | null): { url: URL } | { error: string } {
	if (!raw) return { error: "Не задан базовый URL эндпоинта. Откройте настройки." }
	let url: URL
	try {
		url = new URL(trimSlash(raw))
	} catch {
		return { error: `Непонятный базовый URL: ${raw}` }
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return { error: "Базовый URL должен начинаться с http:// или https://" }
	}
	return { url }
}

/**
 * Пересылает запрос на выбранный игроком эндпоинт.
 * `/api/llm/chat/completions` → `<x-llm-base>/chat/completions`.
 */
export async function llmProxyFetch(request: Request): Promise<Response> {
	if (request.method === "OPTIONS") {
		return new Response(null, {
			status: 204,
			headers: {
				"access-control-allow-origin": "*",
				"access-control-allow-headers": "content-type, x-llm-base, x-llm-key",
				"access-control-allow-methods": "GET, POST, OPTIONS",
				"access-control-max-age": "600",
			},
		})
	}

	const incoming = new URL(request.url)
	const tail = incoming.pathname.slice(LLM_PROXY_PREFIX.length) || "/"
	if (!tail.startsWith("/")) return jsonError("Неверный маршрут прокси.", 404)

	const parsed = parseBase(request.headers.get("x-llm-base"))
	if ("error" in parsed) return jsonError(parsed.error, 400)

	const target = new URL(trimSlash(parsed.url.pathname) + tail + incoming.search, parsed.url.origin)

	const headers = new Headers()
	request.headers.forEach((value, key) => {
		if (!DROP_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value)
	})
	const key = request.headers.get("x-llm-key")
	if (key) headers.set("authorization", `Bearer ${key}`)
	headers.set("accept-encoding", "identity")

	// Байты, а не строка: через прокси ездит и multipart с записью речи (/audio/transcriptions),
	// а utf8-декодирование портит бинарное тело молча.
	const hasBody = request.method !== "GET" && request.method !== "HEAD"
	const body = hasBody ? await request.arrayBuffer() : undefined

	let upstream: Response
	try {
		upstream = await fetch(target, {
			method: request.method,
			headers,
			body,
			signal: request.signal,
			redirect: "follow",
		})
	} catch (e) {
		const reason = e instanceof Error ? e.message : String(e)
		return jsonError(`Эндпоинт недоступен: ${reason}`, 502)
	}

	const out = new Headers()
	upstream.headers.forEach((value, name) => {
		if (!DROP_RESPONSE_HEADERS.has(name.toLowerCase())) out.set(name, value)
	})
	out.set("cache-control", "no-store")

	// Тело отдаём потоком: стриминг SSE должен доезжать до браузера без буферизации.
	return new Response(upstream.body, { status: upstream.status, headers: out })
}
