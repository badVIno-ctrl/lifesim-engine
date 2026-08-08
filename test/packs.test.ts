// I. Контент-паки: добавление сеттинга — это добавление файла, а не правка кода.
import test from "node:test"
import assert from "node:assert/strict"
import { applyDelta, audit, normalizeState } from "../src/engine.ts"
import { loadPack, loadPacks, stateFromPack, validatePackShape } from "../src/packs.ts"
import { PROJECT_ROOT, readPackSources, readPacks } from "../src/node/assets.ts"

test("I: в packs/ лежит не менее двух паков и все они годны", () => {
	const packs = readPacks(PROJECT_ROOT)
	assert.ok(packs.length >= 2, `паков должно быть ≥ 2, сейчас ${packs.length}`)
	for (const p of packs) {
		assert.ok(p.title.length > 0, `${p.id}: пустой заголовок`)
		assert.ok(p.description.includes("фронтов"), `${p.id}: описание без счётчиков`)
		assert.ok(p.counts.fronts >= 1 && p.counts.npcs >= 1 && p.counts.unknowns >= 1)
	}
})

test("I: состояние каждого пака проходит сверку и годится для первого хода", () => {
	for (const p of readPacks(PROJECT_ROOT)) {
		const s = stateFromPack(p)
		assert.deepEqual(audit(s), [], `${p.id}: сверка не чиста`)
		assert.equal(s.clock.turn, 0)
		assert.equal(s.snapshotSeq, 0)
		assert.equal(s.lastUnknownAddTurn, 0)
		assert.equal(s.dead, false)
		const r = applyDelta(s, { time: { minutes: 15 }, channel: "зрение" })
		assert.equal(r.state.clock.turn, 1)
	}
})

test("I: в паках нет ни следа озарения (B)", () => {
	for (const src of readPackSources(PROJECT_ROOT)) {
		assert.equal(JSON.stringify(src.raw).includes("insight"), false, `${src.id}: осталось insight`)
	}
})

test("I: каждый фронт пака несёт проверяемое условие продвижения (E)", () => {
	for (const p of readPacks(PROJECT_ROOT)) {
		for (const f of p.state.fronts) {
			assert.ok(f.advanceCondition.trim().length > 0, `${p.id}: фронт «${f.name}» без условия`)
			assert.ok(
				f.advanceOnDay === null || f.advanceOnDay === undefined || typeof f.advanceOnDay === "number",
			)
		}
	}
})

test("I: новый пак подхватывается без правки кода", () => {
	const known = readPackSources(PROJECT_ROOT)
	const raw = JSON.parse(JSON.stringify(known[0].raw)) as Record<string, unknown>
	;(raw.meta as Record<string, unknown>).setting = "Придуманный мир из файла"
	const packs = loadPacks([...known, { id: "vymysel", raw }])
	assert.equal(packs.length, known.length + 1)
	const added = packs.find((p) => p.id === "vymysel")!
	assert.equal(added.setting, "Придуманный мир из файла")
	assert.deepEqual(audit(stateFromPack(added)), [])
})

test("I: негодный пак отвергается со списком причин, а не стектрейсом", () => {
	const problems = validatePackShape({ meta: {}, fronts: [], npcs: [], unknowns: [] })
	assert.ok(problems.length >= 4)
	assert.ok(problems.some((p) => p.includes("meta.character")))
	assert.ok(problems.some((p) => p.includes("фронт")))
	assert.throws(() => loadPack("битый", { meta: {} }), /битый/)
})

test("I: пак с остатками озарения не принимается", () => {
	const raw = JSON.parse(JSON.stringify(readPackSources(PROJECT_ROOT)[0].raw)) as Record<string, unknown>
	raw.insight = { level: 1, segments: 0 }
	const problems = validatePackShape(raw)
	assert.ok(problems.some((p) => p.includes("insight")))
})

test("I: паки из файлов и из браузерного glob читаются одним кодом", () => {
	const sources = readPackSources(PROJECT_ROOT)
	const viaLoader = loadPacks(sources)
	const viaHelper = readPacks(PROJECT_ROOT)
	assert.deepEqual(
		viaLoader.map((p) => p.id),
		viaHelper.map((p) => p.id),
	)
	// Порядок устойчив: экран выбора не прыгает между запусками.
	assert.deepEqual(
		viaLoader.map((p) => p.id),
		[...viaLoader.map((p) => p.id)].sort((a, b) => a.localeCompare(b)),
	)
})

test("I: состояние из пака не связано ссылками с самим паком", () => {
	const pack = readPacks(PROJECT_ROOT)[0]
	const a = stateFromPack(pack)
	const b = stateFromPack(pack)
	a.money = 1
	a.unknowns.push("лишнее")
	assert.notEqual(b.money, 1)
	assert.equal(b.unknowns.includes("лишнее"), false)
	assert.equal(pack.state.unknowns.includes("лишнее"), false)
})

test("I: state.example.json и паки — одной формы", () => {
	for (const src of readPackSources(PROJECT_ROOT)) {
		const s = normalizeState(src.raw)
		assert.equal(s.version, "13.1")
		assert.ok(Object.keys(s.economy.anchors).length > 0, `${src.id}: нет якорей цен`)
	}
})
