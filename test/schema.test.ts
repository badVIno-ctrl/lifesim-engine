// J. JSON Schema для structured output генерится из типов, а не пишется руками.
import test from "node:test"
import assert from "node:assert/strict"
import { DELTA_KEYS } from "../src/types.ts"
import { DELTA_SCHEMA, TURN_SCHEMA, buildDeltaSchema, buildTurnSchema } from "../src/delta-schema.ts"
import { MILESTONE_CRITERIA, REVELATION_CRITERIA } from "../src/engine.ts"

const props = (schema: Record<string, unknown>): Record<string, unknown> =>
	schema.properties as Record<string, unknown>

test("J: схема дельты покрывает все ключи Delta и ничего лишнего", () => {
	const keys = Object.keys(props(DELTA_SCHEMA))
	assert.deepEqual(keys, [...DELTA_KEYS])
	assert.equal(DELTA_SCHEMA.additionalProperties, false)
})

test("J: в схеме нет озарения как шкалы (B)", () => {
	const json = JSON.stringify(TURN_SCHEMA)
	assert.equal(json.includes("insight"), false)
	assert.equal(json.includes("озарени"), false)
	// Но редкое событие-перелом осталось и ограничено тремя критериями.
	const rev = props(DELTA_SCHEMA).revelation as Record<string, unknown>
	const criterion = props(rev).criterion as { enum: string[] }
	assert.deepEqual(criterion.enum, [...REVELATION_CRITERIA])
	assert.deepEqual((props(props(DELTA_SCHEMA).milestone as Record<string, unknown>).criterion as { enum: string[] }).enum, [
		...MILESTONE_CRITERIA,
	])
})

test("J: схема хода требует и прозу, и дельту", () => {
	assert.deepEqual(TURN_SCHEMA.required, ["prose", "delta"])
	assert.equal(TURN_SCHEMA.additionalProperties, false)
	assert.deepEqual(Object.keys(props(TURN_SCHEMA)), ["prose", "delta"])
})

test("J: модель не хранит чисел: в схеме только шаги в пределах ±3", () => {
	const stress = props(DELTA_SCHEMA).stress as Record<string, unknown>
	const segments = props(stress).segments as { minimum: number; maximum: number }
	assert.equal(segments.minimum, -3)
	assert.equal(segments.maximum, 3)
	// Абсолютных полей вроде «money: 58» в схеме нет — только delta.
	const money = props(DELTA_SCHEMA).money as Record<string, unknown>
	assert.deepEqual(Object.keys(props(money)), ["delta", "reason"])
})

test("J: схема строится детерминированно и сериализуется", () => {
	assert.deepEqual(buildDeltaSchema(), DELTA_SCHEMA)
	assert.deepEqual(buildTurnSchema(), TURN_SCHEMA)
	assert.doesNotThrow(() => JSON.stringify(buildTurnSchema()))
})

test("J: каждый узел схемы закрыт от лишних полей", () => {
	const walk = (node: unknown, path: string): void => {
		if (!node || typeof node !== "object") return
		const n = node as Record<string, unknown>
		if (n.type === "object") {
			assert.equal(n.additionalProperties, false, `${path}: узел открыт для лишних полей`)
			for (const [k, v] of Object.entries((n.properties ?? {}) as Record<string, unknown>)) {
				walk(v, `${path}.${k}`)
			}
		}
		if (n.type === "array") walk(n.items, `${path}[]`)
	}
	walk(TURN_SCHEMA, "turn")
})
