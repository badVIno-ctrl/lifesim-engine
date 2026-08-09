// Свой движок повествования: разбор реплики, модель исхода, дельта и проза.
import test from "node:test"
import assert from "node:assert/strict"
import { applyDelta, calendarPressure, normalizeState } from "../src/engine.ts"
import { createLocalNarrator, suggestActions, EPILOGUE_COMMAND } from "../src/narrator/index.ts"
import { EMPTY_MEMORY, planTurn, readMemory } from "../src/narrator/plan.ts"
import { flavorFor } from "../src/narrator/flavor.ts"
import { parseInput, skillFor, INTENTS } from "../src/narrator/intent.ts"
import { Rng, hash32 } from "../src/narrator/rng.ts"
import { renderProse, wordCount } from "../src/narrator/narrate.ts"
import { presetById } from "../src/tuning.ts"
import type { EngineFact, State } from "../src/types.ts"
import { base } from "./helpers.ts"

const narrate = createLocalNarrator()

function turn(state: State, input: string, facts: EngineFact[] = []) {
	const directives = calendarPressure(state)
	const out = narrate({ state, input, directives, facts, memory: EMPTY_MEMORY })
	const applied = applyDelta(state, out.delta)
	return { out, applied }
}

/* ─────────── Детерминированная случайность ─────────── */

test("генератор воспроизводим и не вырождается", () => {
	const a = new Rng("зерно")
	const b = new Rng("зерно")
	const seqA = Array.from({ length: 20 }, () => a.float())
	const seqB = Array.from({ length: 20 }, () => b.float())
	assert.deepEqual(seqA, seqB)
	assert.ok(new Set(seqA).size > 15, "значения не повторяются по кругу")
	assert.ok(seqA.every((x) => x >= 0 && x < 1))
	assert.notDeepEqual(
		Array.from({ length: 5 }, () => new Rng("другое").float()),
		seqA.slice(0, 5),
	)
	const zero = new Rng(0)
	assert.ok(zero.float() !== zero.float(), "нулевое зерно не даёт константу")
	assert.equal(hash32("а"), hash32("а"))
	assert.notEqual(hash32("а"), hash32("б"))
})

test("выбор без повторов предпочитает свежее", () => {
	const rng = new Rng(7)
	const items = ["один", "два", "три"]
	const used = ["k:0", "k:1"]
	const picked = rng.pickFresh(items, used, (x) => `k:${items.indexOf(x)}`)
	assert.equal(picked, "три")
})

/* ─────────── Разбор реплики ─────────── */

test("намерения узнаются по корням, а не по точным формам", () => {
	const s = base()
	const flavor = flavorFor(s.meta.setting)
	const cases: [string, string][] = [
		["поговорить с Мартой", "говорить"],
		["говорю с ней", "говорить"],
		["спросить про склад", "спросить"],
		["хочу узнать, кто взял", "спросить"],
		["уговорить его подождать", "убедить"],
		["пригрозить ему", "угрожать"],
		["купить еды", "купить"],
		["продать нож", "продать"],
		["заплатить долг", "заплатить"],
		["взяться за работу", "работать"],
		["починить замок", "починить"],
		["вскрыть замок отмычкой", "взломать"],
		["стащить кошель", "украсть"],
		["осмотреться", "осмотреть"],
		["поискать следы", "искать"],
		["пойти на рынок", "идти"],
		["спрятаться в тени", "прятаться"],
		["ударить первым", "драться"],
		["отдохнуть до утра", "отдыхать"],
		["поесть хлеба", "есть"],
		["напиться воды", "пить"],
		["перевязать рану", "лечить"],
		["отдать ему свой нож", "дать"],
		["подождать и посмотреть", "ждать"],
	]
	for (const [text, expected] of cases) {
		assert.equal(parseInput(text, s, flavor).spec.id, expected, text)
	}
})

test("разбор не падает ни на чём и всегда даёт намерение", () => {
	const s = base()
	const flavor = flavorFor(s.meta.setting)
	for (const junk of ["", "   ", "?!.,", "🙂🙂", "asdf qwerty", "1234", "ААААААА"]) {
		const p = parseInput(junk, s, flavor)
		assert.ok(p.spec.id, junk)
		assert.ok(p.confidence >= 0 && p.confidence <= 1)
	}
	assert.equal(parseInput("щёлкаю пальцами", s, flavor).spec.id, "своё")
	assert.equal(parseInput("щёлкаю пальцами", s, flavor).confidence, 0)
})

test("адресат, предмет и место находятся в реплике с учётом падежей", () => {
	const s = base()
	const flavor = flavorFor(s.meta.setting)
	const npcName = s.npcs[0].name.split(",")[0]
	const p = parseInput(`отдать ${npcName} набор отмычек и уйти на рыночную площадь`, s, flavor)
	assert.equal(p.npc, s.npcs[0].name)
	assert.ok(p.item && p.item.includes("отмыч"))
	assert.ok(p.place)
	assert.equal(p.addressed, true)

	const dative = parseInput(`заплатить Марте сорок`, s, flavor)
	assert.equal(dative.spec.id, "заплатить")
})

test("навык подбирается по смыслу действия, а не по названию", () => {
	const s = base()
	const lock = INTENTS.find((i) => i.id === "взломать")!
	const talk = INTENTS.find((i) => i.id === "говорить")!
	s.skills = [
		{ name: "замки и механизмы", rank: 3 },
		{ name: "чтение людей", rank: 1 },
	]
	assert.equal(skillFor(s, lock)?.name, "замки и механизмы")
	assert.equal(skillFor(s, talk)?.name, "чтение людей")
	assert.equal(skillFor(s, INTENTS.find((i) => i.id === "отдыхать")!), null)
})

/* ─────────── Вкус мира ─────────── */

test("вкус мира определяется по описанию, а незнакомый мир не ломает движок", () => {
	assert.equal(flavorFor("Пограничный городок Грауберг").id, "город")
	assert.equal(flavorFor("Порт Ринген, 1928, сезон штормов").id, "порт")
	assert.equal(flavorFor("Шахтёрский посёлок в предгорьях").id, "промысел")
	assert.equal(flavorFor("Деревня у мельницы, второй год засухи").id, "село")
	assert.equal(flavorFor("Тракт через перевал, поздняя осень").id, "дорога")
	// «Станция» — это ещё дорога: почтовая станция на тракте. Настоящий чужой мир
	// не совпадает ни с одним словом, и тогда работает общий слой.
	assert.equal(flavorFor("Орбитальная станция «Тишина»").id, "дорога")
	const alien = flavorFor("Орбитальный комплекс «Тишина», третий год консервации")
	assert.equal(alien.id, "общий")
	assert.ok(alien.places.length && alien.questions.length && alien.work.length)
	// К любому узнанному вкусу всегда добавляется общий слой сенсорики.
	for (const setting of ["городок", "порт", "деревня", "рудник", "тракт"]) {
		const fl = flavorFor(setting)
		assert.notEqual(fl.id, "общий", setting)
		assert.ok(fl.sounds.length >= 5, `${setting}: сенсорика общего слоя добавлена`)
	}
})

/* ─────────── Ход целиком ─────────── */

test("ход всегда двигает время, ставит канал и не просит невозможного", () => {
	let s = base()
	const channels: string[] = []
	for (let i = 0; i < 24; i += 1) {
		const { out, applied } = turn(s, ["осмотреться", "поговорить", "работать", "идти на рынок"][i % 4])
		assert.ok(out.delta.time?.minutes && out.delta.time.minutes > 0, "время сдвинуто")
		assert.ok(out.delta.channel, "канал указан")
		channels.push(String(out.delta.channel))
		assert.equal(applied.facts.filter((f) => f.kind === "rejection").length, 0)
		s = applied.state
	}
	for (let i = 2; i < channels.length; i += 1) {
		assert.ok(
			!(channels[i] === channels[i - 1] && channels[i] === channels[i - 2]),
			"три хода подряд один канал — нарушение ротации",
		)
	}
})

test("один и тот же ход из одного состояния даёт один и тот же результат", () => {
	const s = base()
	const a = narrate({ state: s, input: "осмотреться", directives: [], facts: [], memory: EMPTY_MEMORY })
	const b = narrate({ state: s, input: "осмотреться", directives: [], facts: [], memory: EMPTY_MEMORY })
	assert.equal(a.prose, b.prose)
	assert.deepEqual(a.delta, b.delta)

	const later = normalizeState({ ...s, clock: { ...s.clock, turn: 5, minuteOfDay: 600 } })
	const c = narrate({ state: later, input: "осмотреться", directives: [], facts: [], memory: EMPTY_MEMORY })
	assert.notEqual(a.prose, c.prose, "другой ход — другая сцена")
})

test("проза читается абзацами и не повторяет фразу дважды", () => {
	const s = base()
	const plan = planTurn({ state: s, input: "поговорить с Мартой", directives: [], facts: [], memory: EMPTY_MEMORY })
	const prose = renderProse(plan.beats)
	assert.ok(prose.includes("\n\n"), "есть абзацы")
	assert.ok(wordCount(prose) >= 30, "сцена не в одну строку")
	const sentences = prose.split(/(?<=[.!?])\s+/).map((x) => x.trim().toLowerCase())
	assert.equal(new Set(sentences).size, sentences.length, "нет дословных повторов внутри сцены")
	assert.equal(/\d/.test(prose), false, "в прозе нет цифр")
	// Названия ступеней лестниц вслух не произносятся.
	for (const rung of ["на грани", "изнеможен", "критичен", "обезвожен", "тяжёл"]) {
		assert.equal(prose.toLowerCase().includes(rung), false, rung)
	}
})

test("память рассказчика не даёт повторять одни и те же фразы подряд", () => {
	let s = base()
	let memory = EMPTY_MEMORY
	const proses: string[] = []
	for (let i = 0; i < 12; i += 1) {
		const out = narrate({ state: s, input: "осмотреться", directives: [], facts: [], memory })
		memory = out.memory
		proses.push(out.prose)
		s = applyDelta(s, out.delta).state
	}
	assert.equal(new Set(proses).size, proses.length, "двенадцать осмотров — двенадцать разных сцен")
	assert.ok(memory.recent.length > 0 && memory.recent.length <= 40)
	assert.deepEqual(readMemory(undefined), { recent: [] })
	assert.deepEqual(readMemory({ recent: "мусор" }), { recent: [] })
	assert.deepEqual(readMemory("совсем мусор"), { recent: [] })
})

test("денег не хватает — движок рассказывает отказ, а не просит списание", () => {
	const s = base()
	s.money = 0
	const { out, applied } = turn(s, "купить ночлег")
	assert.ok(!out.delta.money || (out.delta.money.delta ?? 0) >= 0)
	assert.equal(applied.facts.filter((f) => f.kind === "rejection").length, 0)
	assert.match(out.prose, /выше того, что у тебя есть|не торгуют/)
})

test("плата за работу считается от якорей пака, а не из воздуха", () => {
	const s = base()
	s.money = 0
	s.condition = { ...s.condition, fatigue: 0, hunger: 0, thirst: 0, stress: { level: 0, segments: 0 } }
	const { applied } = turn(s, "взяться за работу")
	assert.ok(applied.state.money > 0, "работа приносит деньги")
	const dayFood = s.economy.anchors["еда на день"] ?? 1
	assert.ok(applied.state.money >= dayFood, "заработок не меньше дневной еды")
	assert.ok(applied.state.money <= dayFood * 3 + (s.economy.anchors["ночлег"] ?? 8) * 0.5 * 2)
})

test("незнакомая экономика тоже работает: движок читает якоря, а не знает их наизусть", () => {
	const s = normalizeState({
		...base(),
		money: 100,
		meta: { ...base().meta, setting: "Орбитальная станция «Тишина»", currency: "паёк" },
		economy: { anchors: { "еда на день": 4, "смена в шлюзе": 30 }, regionMultiplier: 1 },
	})
	const { out, applied } = turn(s, "купить еды")
	assert.equal(applied.facts.filter((f) => f.kind === "rejection").length, 0)
	// Цена берётся из якоря и может уйти на торг в обе стороны, но остаётся вокруг якоря.
	const paid = Math.abs(out.delta.money?.delta ?? 0)
	assert.ok(paid >= 3 && paid <= 5, `заплачено ${paid} при якоре 4`)
})

test("требования движка отрабатываются все и в тот же ход", () => {
	const s = base()
	s.unknowns = []
	s.lastUnknownAddTurn = -30
	s.consequences = [{ what: "гильдия узнаёт про долг", cause: "ты говорил лишнее", window: 1, addedTurn: 0 }]
	s.fronts[0].progress = 4
	s.clock.turn = 5
	const directives = calendarPressure(s)
	assert.ok(directives.length >= 3, "движок действительно требует несколько вещей")
	const out = narrate({ state: s, input: "осмотреться", directives, facts: [], memory: EMPTY_MEMORY })
	assert.ok((out.delta.unknowns?.add ?? []).length > 0, "новый открытый вопрос посеян")
	assert.ok((out.delta.consequences?.fire ?? []).includes("гильдия узнаёт про долг"), "последствие закрыто")
	assert.ok((out.delta.fronts ?? []).some((f) => f.name === s.fronts[0].name), "фронт сдвинут")
	const applied = applyDelta(s, out.delta)
	assert.equal(applied.facts.filter((f) => f.kind === "rejection").length, 0)
})

test("факты движка с прошлого хода отыгрываются в прозе", () => {
	const s = base()
	const facts: EngineFact[] = [
		{ kind: "event", code: "attitude_drift", text: "дрейф отношения", forModel: true },
		{ kind: "event", code: "scar_instead_of_death", text: "шрам вместо смерти", forModel: true },
	]
	const out = narrate({ state: s, input: "осмотреться", directives: [], facts, memory: EMPTY_MEMORY })
	assert.match(out.prose, /остывает|помнят хуже/)
	assert.match(out.prose, /вытаскивают|ценой/)
})

test("мёртвый персонаж не получает ни хода, ни дельты", () => {
	const s = base()
	s.dead = true
	const out = narrate({ state: s, input: "встать и идти", directives: [], facts: [], memory: EMPTY_MEMORY })
	assert.deepEqual(out.delta, {})
	assert.match(out.prose, /кончилась/)
})

test("эпилог закрывает историю и не сеет новых загадок", () => {
	const s = base()
	const out = narrate({ state: s, input: EPILOGUE_COMMAND, directives: [], facts: [], memory: EMPTY_MEMORY })
	assert.ok(out.delta.time)
	assert.equal(out.delta.unknowns, undefined)
	assert.equal(out.delta.hooks, undefined)
	assert.match(out.prose, /остаётся/)
})

test("настройка вкуса меняет длину сцены и цену ошибки", () => {
	const short = normalizeState({ ...base(), tuning: presetById("harsh")!.values })
	const long = normalizeState({ ...base(), tuning: presetById("calm")!.values })
	const a = narrate({ state: short, input: "осмотреться", directives: [], facts: [], memory: EMPTY_MEMORY })
	const b = narrate({ state: long, input: "осмотреться", directives: [], facts: [], memory: EMPTY_MEMORY })
	assert.ok((a.delta.time?.minutes ?? 0) < (b.delta.time?.minutes ?? 0), "в суровом мире сцены короче")
})

/* ─────────── Колода действий для 2D ─────────── */

test("колода действий собирается из состояния и подсказывает главное", () => {
	const s = base()
	s.condition.hunger = 2
	s.condition.bleed = 1
	s.obligations = [{ what: "долг Марте", amount: 40, dueDay: 2 }]
	const actions = suggestActions(s)
	assert.ok(actions.length >= 6 && actions.length <= 8)
	const ids = actions.map((a) => a.id)
	assert.ok(ids.includes("eat"), "голодному предлагают поесть")
	assert.ok(ids.includes("heal"), "раненому — рану")
	assert.ok(ids.includes("pay"), "должнику — долг")
	assert.ok(ids.some((i) => i.startsWith("talk:")), "есть с кем поговорить")
	for (const a of actions) {
		assert.ok(a.label.trim() && a.text.trim() && a.hint.trim())
		// Каждое предложенное действие движок обязан понимать.
		const parsed = parseInput(a.text, s, flavorFor(s.meta.setting))
		assert.ok(parsed.confidence > 0, `«${a.text}» должно опознаваться`)
	}
})

test("сытому и целому колода предлагает другое", () => {
	const s = base()
	s.condition.hunger = 0
	s.condition.thirst = 0
	s.condition.bleed = 0
	s.condition.wounds = []
	s.condition.fatigue = 0
	s.obligations = []
	const ids = suggestActions(s).map((a) => a.id)
	assert.equal(ids.includes("eat"), false)
	assert.equal(ids.includes("heal"), false)
	assert.equal(ids.includes("pay"), false)
	assert.ok(ids.includes("work") && ids.includes("look"))
})
