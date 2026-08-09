// Спринт 3. Прокси закрыт: белый список, запрет внутренних диапазонов, проверка источника.
// Плюс автоповтор без спорного параметра для reasoning-моделей.
import test from "node:test"
import assert from "node:assert/strict"
import {
	DEFAULT_ALLOWED_HOSTS,
	allowedHosts,
	checkTarget,
	hostAllowed,
	isLoopbackHost,
	isPrivateHost,
	originAllowed,
} from "../server/llm-guard.ts"
import { llmProxyFetch } from "../server/llm-proxy.ts"
import { looksLikeTemperatureRefusal, openAiCompatible } from "../src/llm.ts"

/* ────────────── Белый список ────────────── */

test("известные эндпоинты разрешены, неизвестные — нет", () => {
	assert.ok(hostAllowed("api.openai.com"))
	assert.ok(hostAllowed("openrouter.ai"))
	assert.ok(hostAllowed("API.OpenAI.com"), "регистр не имеет значения")
	assert.equal(hostAllowed("evil.example.com"), false)
	assert.equal(hostAllowed(""), false)
})

test("белый список расширяется переменной, в том числе поддоменами", () => {
	const env = { LLM_ALLOWED_HOSTS: "llm.mycompany.dev, *.proxy.example" }
	assert.ok(hostAllowed("llm.mycompany.dev", env))
	assert.ok(hostAllowed("eu.proxy.example", env))
	assert.ok(hostAllowed("proxy.example", env))
	assert.equal(hostAllowed("other.dev", env), false)
	assert.ok(allowedHosts(env).length > DEFAULT_ALLOWED_HOSTS.length)
})

test("режим только-локально выкидывает из списка все внешние адреса", () => {
	const env = { LLM_LOCAL_ONLY: "1" }
	assert.ok(hostAllowed("127.0.0.1", env))
	assert.equal(hostAllowed("api.openai.com", env), false)
})

/* ────────────── Внутренние диапазоны ────────────── */

test("своя машина — можно, внутренняя сеть — нельзя", () => {
	for (const h of ["localhost", "127.0.0.1", "127.5.5.5", "::1"]) {
		assert.ok(isLoopbackHost(h), h)
		assert.equal(isPrivateHost(h), false, h)
	}
	for (const h of [
		"10.0.0.5",
		"192.168.1.1",
		"172.16.0.1",
		"172.31.255.255",
		"169.254.169.254",
		"100.100.0.1",
		"metadata.google.internal",
		"db.internal",
		"router.lan",
		"fd00::1",
		"fe80::1",
		"::ffff:10.0.0.1",
		"0.0.0.0",
	]) {
		assert.ok(isPrivateHost(h), h)
		assert.equal(hostAllowed(h), false, h)
	}
})

test("внутренний адрес не спасает даже белый список", () => {
	const env = { LLM_ALLOWED_HOSTS: "169.254.169.254,10.0.0.5" }
	assert.equal(hostAllowed("169.254.169.254", env), false)
	assert.equal(hostAllowed("10.0.0.5", env), false)
})

test("checkTarget объясняет причину отказа человеческим текстом", () => {
	const bad = checkTarget("http://169.254.169.254/latest/meta-data")
	assert.equal(bad.ok, false)
	if (!bad.ok) {
		assert.equal(bad.status, 403)
		assert.match(bad.message, /внутренняя сеть/)
	}
	const stranger = checkTarget("https://evil.example.com/v1")
	assert.equal(stranger.ok, false)
	if (!stranger.ok) assert.match(stranger.message, /LLM_ALLOWED_HOSTS/)

	const plain = checkTarget("http://api.openai.com/v1")
	assert.equal(plain.ok, false)
	if (!plain.ok) assert.match(plain.message, /https/)

	const local = checkTarget("http://127.0.0.1:11434/v1")
	assert.equal(local.ok, true)
	const known = checkTarget("https://api.openai.com/v1/")
	assert.equal(known.ok, true)
	if (known.ok) assert.equal(known.url.pathname, "/v1")

	for (const junk of [null, "", "   ", "не url", "ftp://api.openai.com"]) {
		assert.equal(checkTarget(junk).ok, false, String(junk))
	}
})

/* ────────────── Источник запроса ────────────── */

test("прокси обслуживает только собственную страницу", () => {
	const h = (o: Record<string, string>): Headers => new Headers(o)
	assert.ok(originAllowed(h({ host: "localhost:5173", origin: "http://localhost:5173" })))
	assert.ok(originAllowed(h({ host: "localhost:5173" })), "CLI без origin не браузер")
	assert.equal(
		originAllowed(h({ host: "localhost:5173", origin: "http://attacker.example" })),
		false,
	)
	assert.equal(
		originAllowed(h({ host: "localhost:5173", "sec-fetch-site": "cross-site" })),
		false,
	)
	assert.equal(originAllowed(h({ origin: "http://localhost:5173" })), false, "без host решать нечем")
})

test("запрос с чужой страницы получает 403 и не уходит наружу", async () => {
	const original = globalThis.fetch
	let called = false
	globalThis.fetch = (async () => {
		called = true
		return new Response("{}", { status: 200 })
	}) as typeof fetch
	try {
		const res = await llmProxyFetch(
			new Request("http://localhost:5173/api/llm/chat/completions", {
				method: "POST",
				headers: {
					host: "localhost:5173",
					origin: "http://attacker.example",
					"x-llm-base": "https://api.openai.com/v1",
				},
				body: "{}",
			}),
		)
		assert.equal(res.status, 403)
		assert.equal(called, false, "наружу ничего не пошло")
		const body = (await res.json()) as { error: { message: string } }
		assert.match(body.error.message, /собственную страницу/)
	} finally {
		globalThis.fetch = original
	}
})

test("предварительный запрос больше не разрешает всех подряд", async () => {
	const res = await llmProxyFetch(
		new Request("http://localhost:5173/api/llm/chat/completions", { method: "OPTIONS" }),
	)
	assert.equal(res.status, 204)
	assert.equal(res.headers.get("access-control-allow-origin"), null)
})

test("внутренний адрес не пересылается даже со своей страницы", async () => {
	const original = globalThis.fetch
	let called = false
	globalThis.fetch = (async () => {
		called = true
		return new Response("{}", { status: 200 })
	}) as typeof fetch
	try {
		const res = await llmProxyFetch(
			new Request("http://localhost:5173/api/llm/chat/completions", {
				method: "POST",
				headers: {
					host: "localhost:5173",
					origin: "http://localhost:5173",
					"x-llm-base": "http://169.254.169.254/latest",
				},
				body: "{}",
			}),
		)
		assert.equal(res.status, 403)
		assert.equal(called, false)
	} finally {
		globalThis.fetch = original
	}
})

/* ────────────── Reasoning-модели ────────────── */

test("признак отказа от температуры узкий: параметр должен быть назван", () => {
	assert.ok(
		looksLikeTemperatureRefusal(
			400,
			JSON.stringify({ error: { message: "Unsupported value: 'temperature' does not support 0.8" } }),
		),
	)
	assert.ok(looksLikeTemperatureRefusal(422, "temperature is not supported by this model"))
	assert.equal(looksLikeTemperatureRefusal(400, "context length exceeded"), false)
	assert.equal(looksLikeTemperatureRefusal(500, "temperature unsupported"), false)
	assert.equal(looksLikeTemperatureRefusal(400, "response_format unsupported"), false)
})

test("один автоповтор без температуры, и ход не потерян", async () => {
	const bodies: Record<string, unknown>[] = []
	const fetchImpl: typeof fetch = async (_url, init) => {
		const body = JSON.parse(String(init?.body)) as Record<string, unknown>
		bodies.push(body)
		if ("temperature" in body) {
			return new Response(
				JSON.stringify({ error: { message: "Unsupported value: 'temperature' does not support 0.8" } }),
				{ status: 400 },
			)
		}
		return new Response(
			JSON.stringify({ choices: [{ message: { content: "сцена<delta>{}</delta>" } }] }),
			{ status: 200, headers: { "content-type": "application/json" } },
		)
	}
	const call = openAiCompatible({
		baseUrl: "https://api.openai.com/v1",
		apiKey: "k",
		model: "o4-mini",
		temperature: 0.8,
		structured: false,
		stream: false,
	})
	const first = await call([{ role: "user", content: "иду" }], { fetchImpl })
	assert.match(first.text, /сцена/)
	assert.equal(bodies.length, 2, "ровно один повтор")
	assert.ok("temperature" in bodies[0])
	assert.equal("temperature" in bodies[1], false)

	// Отказ запомнен: второй ход уже не тратит попытку на спорный параметр.
	await call([{ role: "user", content: "дальше" }], { fetchImpl })
	assert.equal(bodies.length, 3)
	assert.equal("temperature" in bodies[2], false)
})

test("отказ от схемы и отказ от температуры не мешают друг другу", async () => {
	const bodies: Record<string, unknown>[] = []
	const fetchImpl: typeof fetch = async (_url, init) => {
		const body = JSON.parse(String(init?.body)) as Record<string, unknown>
		bodies.push(body)
		if ("temperature" in body) {
			return new Response(JSON.stringify({ error: { message: "'temperature' unsupported" } }), {
				status: 400,
			})
		}
		if ("response_format" in body) {
			return new Response(JSON.stringify({ error: { message: "response_format unsupported" } }), {
				status: 400,
			})
		}
		return new Response(
			JSON.stringify({ choices: [{ message: { content: "текст<delta>{}</delta>" } }] }),
			{ status: 200, headers: { "content-type": "application/json" } },
		)
	}
	const call = openAiCompatible({
		baseUrl: "https://api.openai.com/v1",
		apiKey: "k",
		model: "o4-mini",
		temperature: 1,
		structured: true,
		stream: false,
	})
	const r = await call([{ role: "user", content: "иду" }], { fetchImpl })
	assert.match(r.text, /текст/)
	assert.equal(bodies.length, 3, "температура, потом схема — по одному повтору на причину")
	assert.equal("temperature" in bodies[2], false)
	assert.equal("response_format" in bodies[2], false)
})
