// Голосовой ввод. Тестируется только то, что не требует микрофона:
// выбор режима, нормализация диктовки, голосовые команды и транзит аудио через прокси.
import test from "node:test"
import assert from "node:assert/strict"
import {
	appendDictation,
	fileNameFor,
	humanTranscribeError,
	matchSpokenCommand,
	normalizeDictation,
	pickVoiceMode,
	stripForSpeech,
	transcribeAudio,
} from "../src/voice.ts"
import { LlmError } from "../src/llm.ts"
import { DEFAULT_SETTINGS, loadSettings } from "../src/ui/settings.ts"
import { llmProxyFetch } from "../server/llm-proxy.ts"

const caps = (webSpeech: boolean, recorder: boolean, hasKey: boolean) => ({ webSpeech, recorder, hasKey })

/* ────────────── Выбор режима ────────────── */

test("auto предпочитает бесплатное распознавание браузером", () => {
	assert.equal(pickVoiceMode("auto", caps(true, true, true)), "web")
	assert.equal(pickVoiceMode("auto", caps(false, true, true)), "whisper")
	assert.equal(pickVoiceMode("auto", caps(false, true, false)), "off")
	assert.equal(pickVoiceMode("auto", caps(false, false, true)), "off")
})

test("ручной выбор деградирует, а не ломается", () => {
	assert.equal(pickVoiceMode("web", caps(false, true, true)), "whisper")
	assert.equal(pickVoiceMode("whisper", caps(true, false, true)), "web")
	assert.equal(pickVoiceMode("whisper", caps(true, true, false)), "web")
	assert.equal(pickVoiceMode("off", caps(true, true, true)), "off")
})

/* ────────────── Нормализация ────────────── */

test("знаки препинания диктуются только в конце фразы", () => {
	assert.equal(normalizeDictation("иду к гавани точка"), "иду к гавани.")
	assert.equal(normalizeDictation("где Горм вопрос"), "где Горм?")
	// Самое важное: середину фразы трогать нельзя.
	assert.equal(normalizeDictation("точка сборки у маяка"), "точка сборки у маяка")
	assert.equal(normalizeDictation("  лишние   пробелы \n уйдут "), "лишние пробелы уйдут")
})

test("«новая строка» даёт перенос", () => {
	assert.equal(normalizeDictation("спрошу цену новая строка потом уйду"), "спрошу цену\nпотом уйду")
})

test("диктовка дописывается к набранному руками", () => {
	assert.equal(appendDictation("", "открываю дверь"), "Открываю дверь")
	assert.equal(appendDictation("Иду к маяку.", "стучу трижды"), "Иду к маяку. Стучу трижды")
	assert.equal(appendDictation("иду к маяку", "и стучу"), "иду к маяку и стучу")
	assert.equal(appendDictation("текст", "   "), "текст")
})

/* ────────────── Голосовые команды ────────────── */

test("точное имя команды узнаётся с голоса", () => {
	assert.equal(matchSpokenCommand("снапшот"), "((снапшот))")
	assert.equal(matchSpokenCommand("Аудит."), "((аудит))")
	assert.equal(matchSpokenCommand("команда откат"), "((откат))")
	assert.equal(matchSpokenCommand("команда назад"), "((откат))")
	assert.equal(matchSpokenCommand("эпилог"), "((эпилог))")
})

test("игровое действие не путается с командой", () => {
	// Цена ложного срабатывания — потерянный ход, поэтому синонимы требуют слова «команда».
	assert.equal(matchSpokenCommand("назад"), null)
	assert.equal(matchSpokenCommand("иду назад к гавани"), null)
	assert.equal(matchSpokenCommand("сохрани мне место"), null)
	assert.equal(matchSpokenCommand("спрошу цены на соль"), null)
	assert.equal(matchSpokenCommand(""), null)
})

/* ────────────── Озвучка ────────────── */

test("вслух не читается служебное", () => {
	const out = stripForSpeech("((снапшот))\nТы **просыпаешься** <delta>{}</delta> в трюме")
	assert.equal(/\(\(|\*\*|<delta>/.test(out), false)
	assert.ok(out.includes("просыпаешься"))
})

/* ────────────── Расшифровка на эндпоинте ────────────── */

test("запись уходит через прокси с заголовками ключа, а не напрямую", async () => {
	const calls: Array<{ url: string; init: RequestInit }> = []
	const fake: typeof fetch = async (url, init) => {
		calls.push({ url: String(url), init: init ?? {} })
		return new Response(JSON.stringify({ text: "иду к гавани точка" }), { status: 200 })
	}
	const text = await transcribeAudio(
		{ baseUrl: "https://api.example.com/v1", apiKey: "sk-test", proxyPath: "/api/llm", language: "ru-RU" },
		new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }),
		{ fetchImpl: fake },
	)
	assert.equal(text, "иду к гавани.")
	assert.equal(calls.length, 1)
	const call = calls[0]
	assert.equal(call.url, "/api/llm/audio/transcriptions")
	const headers = call.init.headers as Record<string, string>
	assert.equal(headers["x-llm-base"], "https://api.example.com/v1")
	assert.equal(headers["x-llm-key"], "sk-test")
	// content-type выставляет FormData: ручной сломал бы boundary.
	assert.equal("content-type" in headers, false)
	const form = call.init.body as FormData
	assert.equal(form.get("model"), "whisper-1")
	assert.equal(form.get("language"), "ru")
	assert.ok(form.get("file"))
})

test("ошибка эндпоинта объясняется человечески", async () => {
	const fake: typeof fetch = async () => new Response("nope", { status: 404 })
	await assert.rejects(
		() =>
			transcribeAudio({ baseUrl: "https://x/v1", apiKey: "k", proxyPath: "/api/llm" }, new Blob(["a"]), {
				fetchImpl: fake,
			}),
		(e: unknown) => {
			assert.ok(e instanceof LlmError)
			assert.equal(e.status, 404)
			assert.match(e.message, /audio\/transcriptions/)
			return true
		},
	)
	assert.match(humanTranscribeError(401, ""), /ключ/)
	assert.match(humanTranscribeError(429, ""), /лимит/)
})

test("имя файла следует за форматом записи", () => {
	assert.equal(fileNameFor("audio/webm;codecs=opus"), "speech.webm")
	assert.equal(fileNameFor("audio/mp4"), "speech.mp4")
	assert.equal(fileNameFor(""), "speech.webm")
})

/* ────────────── Прокси не портит аудио ────────────── */

test("прокси провозит бинарное тело байт в байт", async () => {
	const original = globalThis.fetch
	let upstreamBody: Uint8Array | null = null
	let upstreamType = ""
	let upstreamUrl = ""
	globalThis.fetch = (async (target: string | URL | Request, init?: RequestInit) => {
		upstreamUrl = String(target)
		upstreamType = new Headers(init?.headers).get("content-type") ?? ""
		upstreamBody = new Uint8Array(init?.body as ArrayBuffer)
		return new Response(JSON.stringify({ text: "ок" }), { status: 200 })
	}) as typeof fetch
	try {
		// Байт 0x80 — невалидный utf8: раньше он превращался в U+FFFD и ломал запись.
		const raw = new Uint8Array([0x80, 0x01, 0xff, 0x00, 0x41])
		const res = await llmProxyFetch(
			new Request("http://localhost:5173/api/llm/audio/transcriptions", {
				method: "POST",
				headers: {
					"x-llm-base": "https://api.example.com/v1",
					"x-llm-key": "sk-test",
					"content-type": "multipart/form-data; boundary=abc123",
				},
				body: raw,
			}),
		)
		assert.equal(res.status, 200)
		assert.equal(upstreamUrl, "https://api.example.com/v1/audio/transcriptions")
		assert.equal(upstreamType, "multipart/form-data; boundary=abc123")
		assert.deepEqual(Array.from(upstreamBody ?? []), Array.from(raw))
	} finally {
		globalThis.fetch = original
	}
})

/* ────────────── Настройки ────────────── */

test("голос имеет безопасные умолчания и не ломает старые настройки", () => {
	assert.equal(DEFAULT_SETTINGS.voice, "auto")
	assert.equal(DEFAULT_SETTINGS.speak, false, "озвучка по умолчанию молчит")
	assert.equal(DEFAULT_SETTINGS.voiceLang, "ru-RU")
	// В node нет localStorage — загрузка обязана отдать умолчания, а не упасть.
	assert.deepEqual(loadSettings(), DEFAULT_SETTINGS)
})
