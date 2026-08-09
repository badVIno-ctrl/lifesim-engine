// Сборка прозы из бит. Изоморфно: ни fs, ни path, ни process.
//
// Абзац — не украшение, а порядок чтения: где ты → что сделал и чем это стоило →
// что на это ответил мир → чем сцена закрылась. Тот же порядок, что требует CORE.md
// от модели, только здесь он держится кодом.
import type { Beat } from "./plan.ts"

const ORDER: Beat["role"][][] = [["sense"], ["attempt", "outcome", "cost"], ["npc", "world"], ["close"]]

export function renderProse(beats: Beat[]): string {
	const paragraphs: string[] = []
	for (const group of ORDER) {
		const sentences = beats.filter((b) => group.includes(b.role)).map((b) => b.text.trim())
		if (!sentences.length) continue
		paragraphs.push(dedupe(sentences).join(" "))
	}
	return paragraphs.join("\n\n")
}

/** Одна и та же фраза дважды в одной сцене читается как сбой, а не как приём. */
function dedupe(sentences: string[]): string[] {
	const seen = new Set<string>()
	const out: string[] = []
	for (const s of sentences) {
		const key = s.toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)
		out.push(s)
	}
	return out
}

export function wordCount(text: string): number {
	return text.split(/\s+/).filter(Boolean).length
}
