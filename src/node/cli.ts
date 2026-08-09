#!/usr/bin/env node
// Текстовая оболочка для терминала: тот же Session, то же ядро, другой адаптер хранилища.
// Необязательная утилита: `npm run play`. К приёмке веб-версии отношения не имеет.
import { createInterface } from "node:readline/promises"
import { stdin, stdout, env, argv, exit } from "node:process"
import { join } from "node:path"
import { openAiCompatible } from "../llm.ts"
import { createLocalNarrator, suggestActions } from "../narrator/index.ts"
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

	// Без ключа терминал играет своим движком — как и браузер.
	// Ключ включает модель: SIM_API_KEY=... npm run play.
	const baseUrl = env.SIM_BASE_URL ?? "https://api.openai.com/v1"
	const apiKey = env.SIM_API_KEY ?? ""
	const model = env.SIM_MODEL ?? "gpt-4o-mini"
	const local = !apiKey

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
		...(local
			? { narrator: createLocalNarrator() }
			: {
					llm: openAiCompatible({
						baseUrl,
						apiKey,
						model,
						temperature: Number(env.SIM_TEMPERATURE ?? 0.8),
						structured: env.SIM_STRUCTURED !== "0",
					}),
				}),
		twoPhase: env.SIM_TWO_PHASE === "1",
		modelName: local ? "свой движок" : model,
	})

	stdout.write(`${renderSnapshot(session.state, { spoilers: false })}\n\n`)
	stdout.write(`Рассказчик: ${local ? "свой движок (без ключа)" : model}\n`)
	stdout.write("Пишите действие. Команды: ((снапшот)) ((аудит)) ((лог)) ((цены)) ((откат)) ((экспорт)). Выход — :q\n")
	stdout.write(`Можно так: ${suggestActions(session.state, 4).map((a) => a.text).join(" · ")}\n\n`)

	const rl = createInterface({ input: stdin, output: stdout })
	for (;;) {
		const line = (await rl.question("> ")).trim()
		if (line === ":q" || line === "") break
		// Свой движок отдаёт сцену целиком, поэтому поток ему не нужен:
		// иначе текст печатался бы дважды.
		const out = await session.turn(line, local ? {} : { onToken: (chunk) => stdout.write(chunk) })
		for (const e of out.entries) {
			// Прозу своего движка поток не отдаёт по кускам: печатаем целиком.
			if (e.kind === "prose") {
				if (local) stdout.write(`${e.text}\n`)
				continue
			}
			if (e.kind === "player") continue
			stdout.write(`\n${e.text}\n`)
		}
		stdout.write(`\n[ход ${session.state.clock.turn} · день ${session.state.clock.day} · ${session.state.money} ${session.state.meta.currency}]\n\n`)
	}
	rl.close()
}

main().catch((e: unknown) => {
	stdout.write(`\nСбой: ${e instanceof Error ? e.message : String(e)}\n`)
	exit(1)
})
