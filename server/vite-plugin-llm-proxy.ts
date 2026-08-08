// Тот же прокси, встроенный в dev-сервер Vite.
// Благодаря этому `npm run dev` — одна команда: клиент и сервер поднимаются вместе,
// без concurrently и без второго процесса.
import type { Plugin, ViteDevServer, PreviewServer } from "vite"
import { LLM_PROXY_PREFIX, llmProxyFetch } from "./llm-proxy.ts"
import { sendWebResponse, toWebRequest } from "./node-adapter.ts"

function mount(server: ViteDevServer | PreviewServer): void {
	server.middlewares.use(async (req, res, next) => {
		if (!req.url || !req.url.startsWith(LLM_PROXY_PREFIX)) {
			next()
			return
		}
		try {
			const request = await toWebRequest(req)
			const response = await llmProxyFetch(request)
			await sendWebResponse(res, response)
		} catch (e) {
			res.statusCode = 500
			res.setHeader("content-type", "application/json; charset=utf-8")
			res.end(
				JSON.stringify({
					error: { message: `Прокси не справился: ${e instanceof Error ? e.message : String(e)}` },
				}),
			)
		}
	})
}

export function llmProxyPlugin(): Plugin {
	return {
		name: "sim-llm-proxy",
		configureServer: mount,
		configurePreviewServer: mount,
	}
}
