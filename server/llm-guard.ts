// Кто и куда имеет право ходить через локальный прокси.
// Прокси пересылает запрос по адресу, который пришёл с клиента, — а значит без
// проверок это открытый ретранслятор: в общей сети им пользуется кто угодно и
// достаёт через него всё, что видно с машины хозяина. Здесь три замка:
// белый список адресов, запрет внутренних диапазонов сети и проверка источника запроса.
//
// Модуль чистый: ни fetch, ни fs. Всё решается по строкам и заголовкам, поэтому тестируется без сети.

/** Куда можно ходить без настройки. Собственная машина плюс известные эндпоинты. */
export const DEFAULT_ALLOWED_HOSTS = [
	"localhost",
	"127.0.0.1",
	"::1",
	"api.openai.com",
	"api.anthropic.com",
	"api.deepseek.com",
	"api.mistral.ai",
	"api.groq.com",
	"api.cerebras.ai",
	"api.x.ai",
	"api.together.xyz",
	"api.fireworks.ai",
	"openrouter.ai",
	"generativelanguage.googleapis.com",
	"api.githubcopilot.com",
	"models.inference.ai.azure.com",
]

export type GuardEnv = {
	/** Через запятую: чем расширить белый список. Поддерживает `*.example.com`. */
	LLM_ALLOWED_HOSTS?: string
	/** `1` — работать только с локальными моделями, никаких внешних адресов. */
	LLM_LOCAL_ONLY?: string
}

export type GuardVerdict = { ok: true; url: URL } | { ok: false; status: number; message: string }

function lower(s: string): string {
	return s.trim().toLowerCase()
}

export function allowedHosts(env: GuardEnv = {}): string[] {
	const extra = (env.LLM_ALLOWED_HOSTS ?? "")
		.split(",")
		.map(lower)
		.filter(Boolean)
	if (env.LLM_LOCAL_ONLY === "1") return ["localhost", "127.0.0.1", "::1", ...extra]
	return [...DEFAULT_ALLOWED_HOSTS.map(lower), ...extra]
}

/** Свой компьютер — это не «внутренняя сеть»: так работают Ollama, llama.cpp и LM Studio. */
export function isLoopbackHost(host: string): boolean {
	const h = lower(host).replace(/^\[|\]$/g, "")
	if (h === "localhost" || h.endsWith(".localhost") || h === "::1" || h === "0:0:0:0:0:0:0:1") return true
	return /^127\./.test(h)
}

/**
 * Внутренние диапазоны сети и адреса метаданных облака. Запрещены всегда,
 * даже если кто-то вписал их в белый список: именно через них уводят секреты.
 */
export function isPrivateHost(host: string): boolean {
	const h = lower(host).replace(/^\[|\]$/g, "")
	if (!h) return true
	if (isLoopbackHost(h)) return false
	if (h === "0.0.0.0" || h === "::" || h === "metadata" || h === "metadata.google.internal") return true
	if (/\.(internal|local|localdomain|home|lan|intranet)$/.test(h)) return true
	if (/^10\./.test(h)) return true
	if (/^192\.168\./.test(h)) return true
	if (/^169\.254\./.test(h)) return true
	if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true
	// CGNAT 100.64.0.0/10 — сюда попадают и облачные внутренние сети.
	const cg = h.match(/^100\.(\d+)\./)
	if (cg && Number(cg[1]) >= 64 && Number(cg[1]) <= 127) return true
	// IPv6: уникальные локальные fc00::/7 и link-local fe80::/10.
	if (/^f[cd][0-9a-f]{2}:/.test(h)) return true
	if (/^fe[89ab][0-9a-f]:/.test(h)) return true
	// IPv4 внутри IPv6 (::ffff:10.0.0.1) — тот же приём обхода.
	const mapped = h.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
	if (mapped) return isPrivateHost(mapped[1])
	return false
}

export function hostAllowed(host: string, env: GuardEnv = {}): boolean {
	const h = lower(host).replace(/^\[|\]$/g, "")
	if (isPrivateHost(h)) return false
	return allowedHosts(env).some((rule) => {
		if (rule.startsWith("*.")) return h === rule.slice(2) || h.endsWith(rule.slice(1))
		return h === rule.replace(/^\[|\]$/g, "")
	})
}

/**
 * Проверка источника: прокси обслуживает только страницу, которую сам же и отдал.
 * Браузер не даёт подделать `origin` и `sec-fetch-site`, поэтому этого достаточно,
 * чтобы чужая страница в той же сети не отправляла запросы через ваш прокси.
 */
export function originAllowed(headers: Headers): boolean {
	if (lower(headers.get("sec-fetch-site") ?? "") === "cross-site") return false
	const origin = headers.get("origin")
	if (!origin) return true // curl и CLI не браузеры: у них нет origin и нет чужой страницы
	const host = headers.get("host")
	if (!host) return false
	try {
		return lower(new URL(origin).host) === lower(host)
	} catch {
		return false
	}
}

/** Разбор и проверка адреса эндпоинта за один проход. */
export function checkTarget(raw: string | null, env: GuardEnv = {}): GuardVerdict {
	if (!raw || !raw.trim()) {
		return { ok: false, status: 400, message: "Не задан базовый URL эндпоинта. Откройте настройки." }
	}
	let url: URL
	try {
		url = new URL(raw.trim().replace(/\/+$/, ""))
	} catch {
		return { ok: false, status: 400, message: `Непонятный базовый URL: ${raw}` }
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return { ok: false, status: 400, message: "Базовый URL должен начинаться с http:// или https://" }
	}
	if (isPrivateHost(url.hostname)) {
		return {
			ok: false,
			status: 403,
			message: `Адрес ${url.hostname} — внутренняя сеть. Прокси в такие адреса не ходит: иначе он становится ретранслятором во внутренний контур.`,
		}
	}
	if (!url.protocol.startsWith("https") && !isLoopbackHost(url.hostname)) {
		return {
			ok: false,
			status: 403,
			message: `К ${url.hostname} по http ключ пойдёт открытым текстом. Разрешён только https, кроме собственной машины.`,
		}
	}
	if (!hostAllowed(url.hostname, env)) {
		return {
			ok: false,
			status: 403,
			message: `Адрес ${url.hostname} не в белом списке прокси. Добавьте его в переменную LLM_ALLOWED_HOSTS, если он вам действительно нужен.`,
		}
	}
	return { ok: true, url }
}
