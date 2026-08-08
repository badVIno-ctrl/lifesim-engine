// Общие вспомогательные функции тестов.
// Тесты — единственный слой кроме src/node/*, которому можно fs.
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { normalizeState } from "../src/engine.ts"
import { PROJECT_ROOT } from "../src/node/assets.ts"
import type { EngineFact, State } from "../src/types.ts"
import type { LlmCaller, LlmResult } from "../src/llm.ts"

/** Стартовое состояние из state.example.json. Свежая копия на каждый вызов. */
export function base(): State {
	return normalizeState(JSON.parse(readFileSync(join(PROJECT_ROOT, "state.example.json"), "utf8")))
}

export const firstFront = (): string => base().fronts[0].name
export const firstNpc = (): string => base().npcs[0].name

export const codes = (facts: EngineFact[]): string[] => facts.map((f) => f.code)
export const hasCode = (facts: EngineFact[], code: string): boolean =>
	facts.some((f) => f.code === code)
export const factText = (facts: EngineFact[], code: string): string =>
	facts.find((f) => f.code === code)?.text ?? ""

/** Временный каталог для файлового хранилища. */
export function tempRoot(): { path: string; cleanup: () => void } {
	const path = mkdtempSync(join(tmpdir(), "sim-v13-"))
	return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) }
}

/** Фейковая модель: отдаёт заранее заготовленные ответы и запоминает запросы. */
export function fakeLlm(replies: Array<string | Partial<LlmResult>>): {
	call: LlmCaller
	calls: Array<{ messages: { role: string; content: string }[] }>
} {
	const calls: Array<{ messages: { role: string; content: string }[] }> = []
	let i = 0
	const call: LlmCaller = async (messages) => {
		calls.push({ messages: messages.map((m) => ({ role: m.role, content: m.content })) })
		const r = replies[Math.min(i, replies.length - 1)]
		i += 1
		if (typeof r === "string") {
			return { text: r, usage: { prompt: 10, completion: 5, total: 15 }, structured: null, mode: "text" }
		}
		return {
			text: r.text ?? "",
			usage: r.usage ?? null,
			structured: r.structured ?? null,
			mode: r.mode ?? "text",
		}
	}
	return { call, calls }
}

/** Модель, которая всегда падает. */
export function brokenLlm(error: Error): LlmCaller {
	return async () => {
		throw error
	}
}

/** Ответ в текстовом формате: проза + блок дельты. */
export function reply(prose: string, delta: unknown): string {
	return `${prose}\n<delta>${JSON.stringify(delta)}</delta>`
}
