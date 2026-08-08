// Чтение промптов и паков в Node (CLI и тесты).
// В браузере те же ресурсы грузит src/ui/assets.ts через import.meta.glob.
// Ядро этот файл не импортирует.
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadPacks } from "../packs.ts"
import type { Pack, PackSource } from "../packs.ts"

const here = dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = resolve(here, "..", "..")

export function readPrompts(root: string = PROJECT_ROOT): { core: string; schema: string; init: string } {
	const dir = join(root, "prompt")
	return {
		core: readFileSync(join(dir, "CORE.md"), "utf8"),
		schema: readFileSync(join(dir, "DELTA-SCHEMA.md"), "utf8"),
		init: readFileSync(join(dir, "INIT.md"), "utf8"),
	}
}

export function readPackSources(root: string = PROJECT_ROOT): PackSource[] {
	const dir = join(root, "packs")
	const out: PackSource[] = []
	for (const file of readdirSync(dir).sort()) {
		if (!file.endsWith(".json")) continue
		out.push({
			id: file.replace(/\.json$/, ""),
			raw: JSON.parse(readFileSync(join(dir, file), "utf8")),
		})
	}
	return out
}

export function readPacks(root: string = PROJECT_ROOT): Pack[] {
	return loadPacks(readPackSources(root))
}
