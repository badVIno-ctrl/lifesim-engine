#!/usr/bin/env node
// Текстовая оболочка для терминала: тот же Session, то же ядро, другой адаптер хранилища.
// Необязательная утилита: `npm run play`. К приёмке веб-версии отношения не имеет.
import { createInterface } from "node:readline/promises"
import { stdin, stdout, env, argv, exit } from "node:process"
import { join } from "node:path"
import { openAiCompatible } from "../llm.ts"
import { Session, createGameRecord } from "../session.ts"
import { createFsStorage } from "../storage/fs.ts"
import { stateFromPack } from "../packs.ts"
import { titleFor } from "../init.ts"
import { renderSnapshot } from "../render.ts"
import { PROJECT_ROOT, readPacks, readPrompts } from "./assets.ts"

async function main(): Promise<void> {
	const packs = readPacks()
	const prompts = readPrompts()
	const wanted = argv[2]
	const pack = packs.find((p) => p.id === wanted) ?? packs[0]
	if (!pack) {
		stdout.write("В packs/ нет ни одного файла.\n")
		exit(1)
	}

	const baseUrl = env.SIM_BASE_URL ?? "https://api.openai.com/v1"
	const apiKey = env.SIM_API_KEY ?? ""
	const model = env.SIM_MODEL ?? "gpt-4o-mini"
	if (!apiKey) {
		stdout.write(
			"Ключ не задан. Для CLI: SIM_API_KEY=... npm run play. В веб-версии ключ вводится в настройках.\n",
		)
		exit(1)
	}

	const storage = createFsStorage(join(PROJECT_ROOT, ".sim-cli"))
	const state = stateFromPack(pack)
	const record = createGameRecord({
		id: `cli-${Date.now().toString(36)}`,
		title: titleFor(state),
		packId: pack.id,
		state,
	})
	await storage.saveGame(record)

	const session = new Session({
		record,
		storage,
		prompts: { core: prompts.core, schema: prompts.schema },
		llm: openAiCompatible({
			baseUrl,
			apiKey,
			model,
			temperature: Number(env.SIM_TEMPERATURE ?? 0.8),
			structured: env.SIM_STRUCTURED !== "0",
		}),
		modelName: model,
	})

	stdout.write(`${renderSnapshot(session.state, { spoilers: false })}\n\n`)
	stdout.write("Пишите действие. Команды: ((снапшот)) ((аудит)) ((лог)) ((цены)) ((откат)) ((экспорт)). Выход — :q\n\n")

	const rl = createInterface({ input: stdin, output: stdout })
	for (;;) {
		const line = (await rl.question("> ")).trim()
		if (line === ":q" || line === "") break
		const out = await session.turn(line, {
			onToken: (chunk) => stdout.write(chunk),
		})
		for (const e of out.entries) {
			if (e.kind === "prose") continue
			if (e.kind === "player") continue
			stdout.write(`\n${e.text}\n`)
		}
		stdout.write("\n\n")
	}
	rl.close()
}

main().catch((e: unknown) => {
	stdout.write(`\nСбой: ${e instanceof Error ? e.message : String(e)}\n`)
	exit(1)
})
