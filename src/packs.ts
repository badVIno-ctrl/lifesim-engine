// I. Контент-паки. Пак — это JSON той же формы, что state.example.json.
// Никаких реестров в коде: добавление пака = добавление файла в packs/.
// Идентификатор пака — имя файла, всё остальное выводится из самого состояния.
// Изоморфный модуль: чтением файлов занимаются src/ui/assets.ts и src/node/assets.ts.
import { clone, normalizeState } from "./engine.ts"
import type { State } from "./types.ts"

export type PackSource = { id: string; raw: unknown }

export type Pack = {
	id: string
	title: string
	character: string
	setting: string
	worldLevel: string
	currency: string
	description: string
	counts: { fronts: number; npcs: number; hooks: number; unknowns: number }
	state: State
}

/** Проверка формы файла пака. Пустой массив — файл годен. */
export function validatePackShape(raw: unknown): string[] {
	const problems: string[] = []
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return ["файл пака должен быть JSON-объектом"]
	}
	const o = raw as Record<string, unknown>

	const meta = o.meta as Record<string, unknown> | undefined
	if (!meta || typeof meta !== "object") problems.push("нет блока meta")
	else {
		if (!meta.character) problems.push("meta.character пуст")
		if (!meta.setting) problems.push("meta.setting пуст")
		if (!meta.currency) problems.push("meta.currency пуст")
		if (!meta.worldLevel) problems.push("meta.worldLevel пуст")
	}

	const economy = o.economy as Record<string, unknown> | undefined
	if (!economy || typeof economy !== "object") problems.push("нет блока economy")
	else {
		const anchors = economy.anchors as Record<string, unknown> | undefined
		if (!anchors || typeof anchors !== "object" || Object.keys(anchors).length === 0) {
			problems.push("economy.anchors пуст — якоря цен обязательны")
		}
	}

	if (typeof o.money !== "number") problems.push("money должно быть числом")
	if (!Array.isArray(o.fronts) || o.fronts.length === 0) problems.push("нужен хотя бы один фронт")
	if (!Array.isArray(o.npcs) || o.npcs.length === 0) problems.push("нужен хотя бы один NPC")
	if (!Array.isArray(o.unknowns) || o.unknowns.length === 0) {
		problems.push("нужен хотя бы один пункт в unknowns")
	}
	// B. Озарения как шкалы больше нет — старые файлы не должны протаскивать её обратно.
	if ("insight" in o) problems.push("поле insight больше не существует (пункт B)")

	for (const f of Array.isArray(o.fronts) ? (o.fronts as Record<string, unknown>[]) : []) {
		if (!f.advanceCondition) problems.push(`фронт «${String(f.name)}» без advanceCondition`)
	}
	for (const u of Array.isArray(o.unknowns) ? (o.unknowns as unknown[]) : []) {
		if (typeof u !== "string") problems.push("unknowns — список строк")
	}
	return problems
}

/** Собирает пак из сырого JSON. Бросает понятную ошибку, если файл негоден. */
export function loadPack(id: string, raw: unknown): Pack {
	const problems = validatePackShape(raw)
	if (problems.length) throw new Error(`пак «${id}» негоден: ${problems.join("; ")}`)
	const state = normalizeState(clone(raw))
	const counts = {
		fronts: state.fronts.length,
		npcs: state.npcs.length,
		hooks: state.hooks.length,
		unknowns: state.unknowns.length,
	}
	const description = [
		`мир ${state.meta.worldLevel}`,
		`старт: ${state.money} ${state.meta.currency}`,
		`фронтов ${counts.fronts}`,
		`неустановленного ${counts.unknowns}`,
	].join(" \u00b7 ")
	return {
		id,
		title: state.meta.setting,
		character: state.meta.character,
		setting: state.meta.setting,
		worldLevel: state.meta.worldLevel,
		currency: state.meta.currency,
		description,
		counts,
		state,
	}
}

export function loadPacks(sources: PackSource[]): Pack[] {
	return sources.map((s) => loadPack(s.id, s.raw)).sort((a, b) => a.id.localeCompare(b.id))
}

/** Стартовое состояние партии из пака. Клон, чтобы две партии не делили объекты. */
export function stateFromPack(pack: Pack): State {
	const s = normalizeState(clone(pack.state))
	s.clock.turn = 0
	s.snapshotSeq = 0
	s.lastUnknownAddTurn = 0
	return s
}
