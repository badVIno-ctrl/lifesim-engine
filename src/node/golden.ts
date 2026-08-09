// Эталонный прогон в терминале: `npm run golden`.
// Файл node-only, как и cli.ts: ядру про fs знать нечего.
import { stdout, argv, exit } from "node:process"
import { normalizeState } from "../engine.ts"
import { formatGoldenReport, runGolden } from "../golden.ts"
import { createLocalNarrator } from "../narrator/index.ts"
import { readPacks } from "./assets.ts"

const packId = argv[2] ?? "grauberg"
const turns = Number(argv[3] ?? 6)
const packs = readPacks()
const pack = packs.find((p) => p.id === packId) ?? packs[0]
if (!pack) {
	stdout.write("В packs/ нет ни одного пака.\n")
	exit(1)
}

const report = runGolden(createLocalNarrator(), normalizeState(pack.state), turns)
stdout.write(`Пак: ${pack.id} (${pack.setting})\n`)
stdout.write(`${formatGoldenReport(report)}\n`)
exit(report.ok ? 0 : 1)
