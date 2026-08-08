// J. JSON Schema для structured output. Собирается из единого списка ключей DELTA_KEYS,
// который компилятор сверяет с `keyof Delta` (см. src/types.ts).
// Если в Delta появится поле, которого здесь нет, упадёт test/schema.test.ts.
import { DELTA_KEYS } from "./types.ts"
import type { DeltaKey } from "./types.ts"
import { LADDERS, PHASES } from "./ladders.ts"
import { MILESTONE_CRITERIA, REVELATION_CRITERIA } from "./engine.ts"

type JsonSchema = Record<string, unknown>

const intStep: JsonSchema = { type: "integer", minimum: -3, maximum: 3 }
const str: JsonSchema = { type: "string" }

function obj(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
	return { type: "object", properties, required, additionalProperties: false }
}

function arr(items: JsonSchema): JsonSchema {
	return { type: "array", items }
}

const PROPERTY_SCHEMAS: Record<DeltaKey, JsonSchema> = {
	time: obj({ minutes: { type: "integer" }, days: { type: "integer" } }),
	channel: { type: "string", enum: ["зрение", "звук", "тело", "запах", "вкус"] },
	scene: obj({
		location: str,
		posture: str,
		light: str,
		participants: arr(str),
	}),
	stress: obj({ segments: intStep, reason: str }, ["segments"]),
	fatigue: obj({ step: intStep }, ["step"]),
	hunger: obj({ step: intStep }, ["step"]),
	thirst: obj({ step: intStep }, ["step"]),
	health: obj({ step: intStep, cause: str }, ["step"]),
	wounds: arr(obj({ zone: str, step: intStep, cause: str }, ["zone", "step"])),
	bleed: obj({ step: intStep, cause: str }, ["step"]),
	money: obj({ delta: { type: "integer" }, reason: str }, ["delta"]),
	inventory: obj({
		add: arr(obj({ name: str, qty: { type: "integer" }, wear: str }, ["name"])),
		remove: arr(obj({ name: str, qty: { type: "integer" } }, ["name"])),
		wear: arr(obj({ name: str, step: intStep }, ["name", "step"])),
	}),
	npc: arr(
		obj({ name: str, attitudeStep: intStep, reason: str, promise: str, promiseKept: str }, ["name"]),
	),
	skills: arr(obj({ name: str, step: intStep, justification: str }, ["name", "step"])),
	milestone: obj(
		{ granted: { type: "boolean" }, criterion: { type: "string", enum: [...MILESTONE_CRITERIA] } },
		["granted"],
	),
	revelation: obj(
		{ criterion: { type: "string", enum: [...REVELATION_CRITERIA] }, what: str },
		["criterion", "what"],
	),
	effects: obj({
		add: arr(obj({ name: str, expiresInTurns: { type: "integer" } }, ["name"])),
		remove: arr(str),
	}),
	trace: str,
	hooks: obj({
		add: arr(obj({ text: str, window: { type: "integer" } }, ["text"])),
		resolve: arr(str),
		sleep: arr(str),
	}),
	consequences: obj({
		add: arr(obj({ what: str, cause: str, window: { type: "integer" } }, ["what", "cause"])),
		fire: arr(str),
	}),
	fronts: arr(
		obj(
			{
				name: str,
				progressStep: intStep,
				advanceConditionMet: { type: "boolean" },
				justification: str,
			},
			["name", "progressStep"],
		),
	),
	obligations: obj({
		add: arr(obj({ what: str, amount: { type: "integer" }, dueDay: { type: "integer" } }, ["what"])),
		settle: arr(str),
	}),
	unknowns: obj({ add: arr(str), resolve: arr(str) }),
	goals: obj({ add: arr(str), done: arr(str) }),
	precedent: str,
	terminal: obj({ kind: { type: "string", enum: ["death", "coma"] }, cause: str }, ["kind", "cause"]),
	note: str,
}

/** Схема только для блока дельты. */
export function buildDeltaSchema(): JsonSchema {
	const properties: Record<string, JsonSchema> = {}
	for (const key of DELTA_KEYS) properties[key] = PROPERTY_SCHEMAS[key]
	return { type: "object", properties, required: [], additionalProperties: false }
}

/** Схема всего хода: проза + дельта. Используется в response_format.json_schema. */
export function buildTurnSchema(): JsonSchema {
	return {
		type: "object",
		properties: {
			prose: { type: "string", description: "Текст сцены для игрока. Без чисел и без JSON." },
			delta: buildDeltaSchema(),
		},
		required: ["prose", "delta"],
		additionalProperties: false,
	}
}

export const DELTA_SCHEMA = buildDeltaSchema()
export const TURN_SCHEMA = buildTurnSchema()

/** Справочно: лестницы и фазы для промпта и отладки. */
export const REFERENCE = { LADDERS, PHASES }
