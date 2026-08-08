// Мастер инициации и тексты промптов: пункты B, D, H и правило «что проверяет код — того нет в тексте».
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { audit, normalizeState } from "../src/engine.ts"
import { INIT_STEPS, WORLD_LEVELS, allDefaults, buildStateFromAnswers, titleFor } from "../src/init.ts"
import { stateFromPack } from "../src/packs.ts"
import { PROJECT_ROOT, readPacks, readPrompts } from "../src/node/assets.ts"

const packs = readPacks(PROJECT_ROOT)
const prompts = readPrompts(PROJECT_ROOT)
const words = (t: string): number => t.split(/\s+/).filter(Boolean).length

/* ────────────── Мастер из 8 шагов ────────────── */

test("инициация — ровно 8 шагов, каждый с вопросом и примерами", () => {
	assert.equal(INIT_STEPS.length, 8)
	const ids = INIT_STEPS.map((s) => s.id)
	assert.equal(new Set(ids).size, 8)
	for (const step of INIT_STEPS) {
		assert.ok(step.title.length > 0, `${step.id}: нет заголовка`)
		assert.ok(step.question.length > 0, `${step.id}: нет вопроса`)
		assert.ok(step.examples.length >= 2, `${step.id}: меньше двух примеров`)
	}
	assert.deepEqual(INIT_STEPS.find((s) => s.id === "worldLevel")!.choices, WORLD_LEVELS)
})

test("«мне всё равно, реши сам» даёт валидное состояние на каждом паке", () => {
	for (const pack of packs) {
		const state = buildStateFromAnswers(pack, allDefaults(pack))
		assert.deepEqual(audit(state), [], `${pack.id}: сверка не чиста`)
		assert.equal(state.version, "13.1")
		assert.equal(state.clock.turn, 0)
		assert.ok(state.unknowns.length >= 1)
		assert.ok(state.fronts.length >= 1)
		assert.ok(titleFor(state).length > 0)
	}
})

test("ответы игрока попадают в состояние и не ломают схему", () => {
	const pack = packs[0]
	const state = buildStateFromAnswers(pack, {
		character: "Кай Брант, 40, бывший штурман",
		setting: "Остров Фарн, межсезонье",
		worldLevel: "беспощадный",
		money: "17",
		constants: "11 14 12 9 16",
		skills: "навигация, нож, торг",
		bond: "Старшина Горм — долг за лодку",
		goal: "уйти с острова — кто закрыл гавань",
	})
	assert.equal(state.meta.character, "Кай Брант, 40, бывший штурман")
	assert.equal(state.meta.worldLevel, "беспощадный")
	assert.equal(state.money, 17)
	assert.deepEqual(
		state.constants,
		{ str: 11, dex: 14, int: 12, cha: 9, wil: 16 },
	)
	assert.equal(state.skills.length, 3)
	assert.ok(state.skills.every((s) => s.rank >= 1 && s.rank <= 4))
	assert.ok(state.npcs.some((n) => n.name.includes("Горм")))
	assert.ok(state.goals.length >= 1)
	assert.ok(state.unknowns.length >= 1)
	assert.deepEqual(audit(state), [])
	assert.deepEqual(normalizeState(state), state)
})

test("косяки ввода не роняют мастер", () => {
	const pack = packs[0]
	const state = buildStateFromAnswers(pack, {
		money: "много",
		constants: "99 -5",
		skills: "",
		worldLevel: "какой-то свой",
	})
	assert.ok(Number.isFinite(state.money) && state.money >= 0)
	for (const v of Object.values(state.constants)) {
		assert.ok(v >= 3 && v <= 20, `константа вне диапазона: ${v}`)
	}
	assert.ok(WORLD_LEVELS.includes(state.meta.worldLevel))
	assert.ok(state.skills.length >= 1)
	assert.deepEqual(audit(state), [])
})

test("инициация наследует мир пака, а не сочиняет его заново", () => {
	const pack = packs[0]
	const fromPack = stateFromPack(pack)
	const state = buildStateFromAnswers(pack, { character: "Другой человек, 20" })
	assert.deepEqual(state.economy.anchors, fromPack.economy.anchors)
	assert.deepEqual(
		state.fronts.map((f) => f.name),
		fromPack.fronts.map((f) => f.name),
	)
	assert.equal(state.meta.currency, fromPack.meta.currency)
})

/* ────────────── Промпты ────────────── */

test("CORE.md укладывается в 2000 слов", () => {
	const n = words(prompts.core)
	assert.ok(n <= 2000, `CORE.md раздулся до ${n} слов`)
})

test("D: из промпта убрано правило про рутину после двух пустых ходов", () => {
	const core = prompts.core.toLowerCase()
	assert.equal(core.includes("прокрути рутину"), false)
	assert.equal(core.includes("два хода без событий"), false)
	assert.ok(core.includes("движок"), "в промпте должно быть сказано, кто давит расписанием")
})

test("B: из промптов убрана шкала озарения", () => {
	for (const [name, text] of Object.entries(prompts)) {
		assert.equal(text.includes("insight"), false, `${name}: осталось insight`)
		assert.equal(/озарени[еяюи]/i.test(text), false, `${name}: осталось озарение`)
	}
	assert.ok(prompts.schema.includes("revelation"))
})

test("H: снапшот, микро-лог и сверка объявлены делом кода", () => {
	assert.ok(/снапшот/i.test(prompts.core))
	assert.ok(/не пишешь|не пиши|пишет движок|делает движок/i.test(prompts.core))
})

test("промпт не требует от модели считать числа самой", () => {
	assert.ok(/не хранишь чисел|не считаешь|числа живут в состоянии/i.test(prompts.core))
})

test("INIT.md описывает все восемь шагов мастера", () => {
	for (const step of INIT_STEPS) {
		assert.ok(
			prompts.init.includes(step.title),
			`INIT.md не упоминает шаг «${step.title}»`,
		)
	}
})

test("INIT.md никогда не попадает в контекст игры", () => {
	// Клиент вшивает в сборку только CORE.md и DELTA-SCHEMA.md.
	const assets = readFileSync(join(PROJECT_ROOT, "src", "ui", "assets.ts"), "utf8")
	const imports = assets.split("\n").filter((l) => /^\s*import\b/.test(l))
	assert.equal(imports.some((l) => /INIT\.md/i.test(l)), false, "клиент не должен импортировать INIT.md")
	assert.equal(imports.some((l) => /CORE\.md/.test(l)), true)
	// Контур хода вообще не знает про инициацию.
	const session = readFileSync(join(PROJECT_ROOT, "src", "session.ts"), "utf8")
	assert.equal(/INIT\.md/i.test(session), false, "сессия не знает про INIT.md")
	assert.equal(/from "\.\/init/.test(session), false, "сессия не импортирует мастер инициации")
})

test("ядро изоморфно: ни fs, ни path, ни process", () => {
	const files = [
		"engine.ts",
		"render.ts",
		"session.ts",
		"llm.ts",
		"packs.ts",
		"init.ts",
		"types.ts",
		"ladders.ts",
		"delta-schema.ts",
	]
	for (const f of files) {
		const text = readFileSync(join(PROJECT_ROOT, "src", f), "utf8")
			.split("\n")
			.filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
			.join("\n")
		assert.equal(/from "node:/.test(text), false, `src/${f}: тянет node-модуль`)
		assert.equal(/\bprocess\./.test(text), false, `src/${f}: трогает process`)
		assert.equal(/\brequire\(/.test(text), false, `src/${f}: трогает require`)
	}
})
