// Спринт 4, пункт 1. Эталонный прогон: без него любая правка рассказчика — гадание.
// Тест держит те же вопросы, что и `npm run golden`: выполняются ли требования движка,
// двигается ли время, не выдумываются ли числа, не просит ли рассказчик невозможного.
import test from "node:test"
import assert from "node:assert/strict"
import { GOLDEN_CASES, formatGoldenReport, runGolden } from "../src/golden.ts"
import { createLocalNarrator } from "../src/narrator/index.ts"
import { normalizeState } from "../src/engine.ts"
import { readPacks } from "../src/node/assets.ts"
import { base } from "./helpers.ts"

const narrator = createLocalNarrator()

test("эталонных состояний десять, и каждое объясняет, что оно ловит", () => {
	assert.equal(GOLDEN_CASES.length, 10)
	const ids = new Set(GOLDEN_CASES.map((c) => c.id))
	assert.equal(ids.size, 10, "имена не повторяются")
	for (const c of GOLDEN_CASES) {
		assert.ok(c.why.length > 20, `${c.id}: сказано, зачем этот случай`)
		assert.ok(c.inputs.length >= 2, `${c.id}: есть хотя бы два осмысленных действия`)
	}
})

test("свой движок проходит эталонный прогон без замечаний", () => {
	const report = runGolden(narrator, base(), 8)
	assert.equal(
		report.ok,
		true,
		`замечания эталонного прогона:\n${formatGoldenReport(report)}`,
	)
	assert.ok(report.turns >= 70, "прогон действительно прошёл десятки ходов")
	for (const c of report.cases) {
		assert.equal(c.rejections, 0, `${c.id}: движок не должен просить невозможного`)
		if (c.directivesIssued > 0) {
			assert.equal(c.directivesAnswered, c.directivesIssued, `${c.id}: требования отработаны`)
		}
	}
})

test("эталонный прогон зелёный на всех паках проекта", () => {
	for (const pack of readPacks()) {
		const report = runGolden(narrator, normalizeState(pack.state), 6)
		assert.equal(report.ok, true, `${pack.id}:\n${formatGoldenReport(report)}`)
	}
})

test("прогон видит плохого рассказчика, а не только хвалит хорошего", () => {
	// Рассказчик, который молчит про время, выдумывает числа и игнорирует движок.
	const lazy = () => ({
		prose: "Ты стоишь. В кармане 38 грошей.",
		delta: { channel: "зрение" as const, money: { delta: -100000 } },
	})
	const report = runGolden(lazy, base(), 3)
	assert.equal(report.ok, false)
	const codes = report.issues.map((i) => i.code)
	assert.ok(codes.includes("время не сдвинуто"))
	assert.ok(codes.includes("цифра в прозе"))
	assert.ok(codes.some((c) => c.startsWith("отклонено:")))
	assert.ok(codes.includes("требование движка не отработано"))
	assert.ok(codes.includes("проза повторилась дословно"))
	// Падение рассказчика — тоже замечание, а не крах прогона.
	const broken = runGolden(
		() => {
			throw new Error("сломался")
		},
		base(),
		2,
	)
	assert.equal(broken.ok, false)
	assert.ok(broken.issues.some((i) => i.code === "рассказчик упал"))
})

test("отчёт читается человеком", () => {
	const text = formatGoldenReport(runGolden(narrator, base(), 3))
	assert.match(text, /Эталонный прогон: 10 состояний/)
	assert.match(text, /Замечаний нет/)
	for (const c of GOLDEN_CASES) assert.ok(text.includes(c.id), c.id)
})
