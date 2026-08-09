// Спринт 1. Настройка вкуса: пресеты, защитный разбор, жизнь внутри партии.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { normalizeState } from "../src/engine.ts"
import { PROJECT_ROOT } from "../src/node/assets.ts"
import {
	TUNING_LIMITS,
	TUNING_PRESETS,
	defaultTuning,
	describeTuning,
	labelOf,
	labelTitle,
	pressureProfile,
	presetById,
	readTuning,
	sameTuning,
	tuningOf,
} from "../src/tuning.ts"
import { base } from "./helpers.ts"

test("три пресета и состояние «Своё»", () => {
	assert.equal(TUNING_PRESETS.length, 3)
	assert.deepEqual(
		TUNING_PRESETS.map((p) => p.id),
		["calm", "balanced", "harsh"],
	)
	for (const p of TUNING_PRESETS) {
		assert.equal(labelOf(p.values), p.id, `${p.id} узнаёт себя`)
		assert.ok(p.title.trim() && p.blurb.trim())
	}
	const custom = { ...defaultTuning(), worldPressure: 4 }
	assert.equal(labelOf(custom), "custom")
	assert.equal(labelTitle("custom"), "Своё")
})

test("крутнул ручку — ярлык «Своё»; вернул — снова имя пресета", () => {
	const calm = presetById("calm")!.values
	const nudged = { ...calm, bondCoolDays: calm.bondCoolDays + 1 }
	assert.equal(labelOf(nudged), "custom")
	assert.equal(labelOf({ ...nudged, bondCoolDays: calm.bondCoolDays }), "calm")
})

test("разбор не падает ни на чём: undefined, мусор, массив, строка, битые числа", () => {
	const cases: unknown[] = [
		undefined,
		null,
		0,
		"",
		"harsh",
		[],
		[1, 2, 3],
		{},
		{ worldPressure: "много" },
		{ worldPressure: Number.NaN, sceneLength: 7, deathRule: {}, bondCoolDays: -100 },
		{ worldPressure: 999, unknownsPatience: Number.POSITIVE_INFINITY },
		{ preset: "нет такого" },
	]
	for (const c of cases) {
		const t = readTuning(c)
		assert.ok(t.worldPressure >= TUNING_LIMITS.worldPressure.min)
		assert.ok(t.worldPressure <= TUNING_LIMITS.worldPressure.max)
		assert.ok(["короткая", "средняя", "длинная"].includes(t.sceneLength))
		assert.ok(["смерть", "шрам"].includes(t.deathRule))
		assert.ok(Number.isInteger(t.bondCoolDays) && t.bondCoolDays >= TUNING_LIMITS.bondCoolDays.min)
		assert.ok(Number.isInteger(t.unknownsPatience))
		assert.equal(Object.keys(t).length, 5)
	}
})

test("разбор чинит частичный блок, а не выбрасывает его", () => {
	const t = readTuning({ preset: "harsh", bondCoolDays: 9 })
	const harsh = presetById("harsh")!.values
	assert.equal(t.worldPressure, harsh.worldPressure, "остальное подтянулось из пресета-подсказки")
	assert.equal(t.bondCoolDays, 9, "явное значение сильнее пресета")
	assert.equal(labelOf(t), "custom")
})

test("настройки живут в состоянии партии, а не в настройках приложения", () => {
	const s = base()
	assert.ok(s.tuning, "нормализация всегда даёт блок настроек")
	assert.ok(sameTuning(tuningOf(s), s.tuning))

	const exported = JSON.parse(JSON.stringify(s)) as unknown
	assert.ok(sameTuning(tuningOf(exported), s.tuning), "экспорт везёт правила с собой")

	const a = normalizeState({ ...base(), tuning: presetById("calm")!.values })
	const b = normalizeState({ ...base(), tuning: presetById("harsh")!.values })
	assert.equal(labelOf(tuningOf(a)), "calm")
	assert.equal(labelOf(tuningOf(b)), "harsh")
	assert.notEqual(tuningOf(a).deathRule, tuningOf(b).deathRule, "две партии по разным правилам")
})

test("старый сейв без блока настроек грузится и получает умолчания", () => {
	const legacy = JSON.parse(readFileSync(join(PROJECT_ROOT, "state.example.json"), "utf8")) as Record<
		string,
		unknown
	>
	delete legacy.tuning
	const s = normalizeState(legacy)
	assert.ok(sameTuning(tuningOf(s), defaultTuning()))

	const broken = normalizeState({ ...legacy, tuning: "как-нибудь" })
	assert.ok(sameTuning(tuningOf(broken), defaultTuning()))
})

test("tuningOf выдерживает состояние, собранное руками и наполовину", () => {
	assert.ok(sameTuning(tuningOf(undefined), defaultTuning()))
	assert.ok(sameTuning(tuningOf({}), defaultTuning()))
	assert.ok(sameTuning(tuningOf({ clock: { turn: 3 } }), defaultTuning()))
})

test("профиль давления: суровый мир не даёт второго шанса, спокойный терпит", () => {
	const calm = pressureProfile(presetById("calm")!.values)
	const harsh = pressureProfile(presetById("harsh")!.values)
	assert.ok(harsh.overdueStages[2] < calm.overdueStages[2], "мир действует сам раньше")
	assert.ok(harsh.directivePatience < calm.directivePatience, "суровый мир меньше уговаривает")
	assert.ok(harsh.sceneMinutes.base < calm.sceneMinutes.base, "сцены короче")
	assert.ok(harsh.costFactor > calm.costFactor, "ошибка дороже")
	for (const p of TUNING_PRESETS) {
		const prof = pressureProfile(p.values)
		const [a, b, c] = prof.overdueStages
		assert.ok(a <= b && b <= c, "ступени идут по возрастанию")
		assert.ok(prof.directivePatience >= 1)
	}
})

test("описание настроек читаемо человеком и годится для снапшота", () => {
	const text = describeTuning(presetById("calm")!.values)
	assert.match(text, /давление 1\/5/)
	assert.match(text, /шрам/)
	assert.match(text, /просрочка/)
})
