// Мостик между Node-потоками (connect/Vite middleware) и веб-стандартными Request/Response.
// Нужен только для того, чтобы один и тот же прокси работал и в dev, и в проде.
import type { IncomingMessage, ServerResponse } from "node:http"
import { Readable } from "node:stream"

export async function toWebRequest(req: IncomingMessage): Promise<Request> {
	const host = req.headers.host ?? "localhost"
	const url = new URL(req.url ?? "/", "http://" + host)
	const headers = new Headers()
	for (const [key, value] of Object.entries(req.headers)) {
		if (value === undefined) continue
		headers.set(key, Array.isArray(value) ? value.join(", ") : value)
	}
	const method = req.method ?? "GET"
	// Без utf8: через прокси ходит и бинарное тело (запись речи в multipart).
	let body: ArrayBuffer | undefined
	if (method !== "GET" && method !== "HEAD") {
		const chunks: Buffer[] = []
		for await (const chunk of req) chunks.push(Buffer.from(chunk))
		const all = Buffer.concat(chunks)
		body = all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength) as ArrayBuffer
	}
	return new Request(url.toString(), { method, headers, body })
}

export async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
	const headers: Record<string, string> = {}
	response.headers.forEach((value, key) => {
		headers[key] = value
	})
	res.writeHead(response.status, headers)
	if (!response.body) {
		res.end()
		return
	}
	const nodeStream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
	nodeStream.pipe(res)
	await new Promise<void>((resolve) => {
		res.on("close", () => resolve())
		res.on("finish", () => resolve())
	})
}
