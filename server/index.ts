// Продакшн-сервер для `npm start`: раздаёт dist/ и тот же прокси к LLM.
// Бизнес-логики здесь нет и не будет: всё состояние игры живёт в браузере.
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, join, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { env, exit, stdout } from "node:process"
import { Hono } from "hono"
import { serve } from "@hono/node-server"
import { LLM_PROXY_PREFIX, llmProxyFetch } from "./llm-proxy.ts"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "..")
const dist = join(root, "dist")

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".webmanifest": "application/manifest+json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".txt": "text/plain; charset=utf-8",
}

function mimeOf(path: string): string {
	const dot = path.lastIndexOf(".")
	return dot < 0 ? "application/octet-stream" : (MIME[path.slice(dot)] ?? "application/octet-stream")
}

function fileResponse(absolute: string): Response | null {
	if (!existsSync(absolute)) return null
	if (!statSync(absolute).isFile()) return null
	const body = readFileSync(absolute)
	const isHtml = absolute.endsWith(".html")
	return new Response(new Uint8Array(body), {
		headers: {
			"content-type": mimeOf(absolute),
			// index.html не кэшируем — иначе обновление PWA не доедет до игрока.
			"cache-control": isHtml ? "no-store" : "public, max-age=3600",
		},
	})
}

if (!existsSync(join(dist, "index.html"))) {
	stdout.write("Нет сборки dist/. Запустите `npm start` — он соберёт и поднимет сразу.\n")
	exit(1)
}

const app = new Hono()

const guardEnv = { LLM_ALLOWED_HOSTS: env.LLM_ALLOWED_HOSTS, LLM_LOCAL_ONLY: env.LLM_LOCAL_ONLY }

app.all(`${LLM_PROXY_PREFIX}/*`, (c) => llmProxyFetch(c.req.raw, guardEnv))
app.all(LLM_PROXY_PREFIX, (c) => llmProxyFetch(c.req.raw, guardEnv))

app.get("*", (c) => {
	const pathname = decodeURIComponent(new URL(c.req.url).pathname)
	const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, "")
	const candidate = join(dist, safe)
	if (candidate.startsWith(dist)) {
		const direct = fileResponse(candidate)
		if (direct) return direct
	}
	// SPA-fallback: любой маршрут отдаёт оболочку.
	return fileResponse(join(dist, "index.html")) ?? new Response("not found", { status: 404 })
})

const port = Number(env.PORT ?? 5173)
// По умолчанию слушаем только свою машину. Чтобы позвать игроков из локальной сети,
// это нужно сказать явно: HOST=0.0.0.0. Тогда белый список прокси — единственная защита,
// и он включён всегда.
const hostname = env.HOST ?? "127.0.0.1"
serve({ fetch: app.fetch, port, hostname }, (info) => {
	stdout.write(`Игра поднята: http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${info.port}\n`)
	if (hostname === "0.0.0.0") {
		stdout.write("Внимание: сервер открыт для локальной сети. Прокси ходит только по белому списку.\n")
	}
})
