// Единственная задача сервера во всём проекте: провести запрос к LLM через себя,
// чтобы браузер не упирался в CORS. Бизнес-логики здесь нет и быть не должно.
//
// Ключ и адрес эндпоинта приходят заголовками от клиента на каждый запрос,
// нигде не сохраняются и не логируются. Прокси не читает тело запроса и не разбирает ответ:
// тело идёт транзитом, стриминг сохраняется как есть.
//
// Куда именно можно ходить и кого слушать — решает server/llm-guard.ts.
// Без него это открытый ретранслятор на любой адрес с любой машины в сети.
import { checkTarget, originAllowed } from "./llm-guard.ts"
import type { GuardEnv } from "./llm-guard.ts"

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

/**
 * Пересылает запрос на выбранный игроком эндпоинт.
 * `/api/llm/chat/completions` → `<x-llm-base>/chat/completions`.
 * Всё, что не прошло проверки прокси, дальше машины не уходит.
 */
export async function llmProxyFetch(request: Request, env: GuardEnv = {}): Promise<Response> {
	// Своя же страница ходит на свой же origin — предварительный запрос ей не нужен,
	// а чужой странице он не нужен тем более: политика теперь «только свои».
	if (request.method === "OPTIONS") {
		return new Response(null, {
			status: 204,
			headers: { "cache-control": "no-store", allow: "GET, POST, OPTIONS" },
		})
	}

	if (!originAllowed(request.headers)) {
		return jsonError(
			"Прокси обслуживает только собственную страницу игры. Запрос пришёл с чужого адреса и отклонён.",
			403,
		)
	}

	const incoming = new URL(request.url)
	const tail = incoming.pathname.slice(LLM_PROXY_PREFIX.length) || "/"
	if (!tail.startsWith("/")) return jsonError("Неверный маршрут прокси.", 404)

	const parsed = checkTarget(request.headers.get("x-llm-base"), env)
	if (!parsed.ok) return jsonError(parsed.message, parsed.status)

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
