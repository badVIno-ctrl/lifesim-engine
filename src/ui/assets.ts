// Загрузка ресурсов в браузере. Промпты и паки вшиваются в сборку на этапе билда,
// поэтому игра работает оффлайн и не ходит за ними в сеть.
//
// I. Добавление пака = добавление файла в packs/. Код ниже не знает ни одного имени пака.
// Важно: INIT.md здесь НЕ импортируется и никогда не попадает в контекст игры:
// мастер инициации целиком живёт в src/init.ts.
import coreMd from "../../prompt/CORE.md?raw"
import schemaMd from "../../prompt/DELTA-SCHEMA.md?raw"
import { loadPacks } from "../packs.ts"
import type { Pack, PackSource } from "../packs.ts"

export const PROMPTS = { core: coreMd, schema: schemaMd }

const packModules = import.meta.glob("../../packs/*.json", { eager: true }) as Record<
	string,
	{ default: unknown }
>

function idFromPath(path: string): string {
	const file = path.split("/").pop() ?? path
	return file.replace(/\.json$/, "")
}

let cache: Pack[] | null = null

export function packs(): Pack[] {
	if (cache) return cache
	const sources: PackSource[] = Object.entries(packModules).map(([path, mod]) => ({
		id: idFromPath(path),
		raw: mod.default,
	}))
	cache = loadPacks(sources)
	return cache
}

export function packById(id: string): Pack | null {
	return packs().find((p) => p.id === id) ?? null
}
