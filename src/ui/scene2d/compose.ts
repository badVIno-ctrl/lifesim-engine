// Из состояния — в картинку. Модуль чистый: ни canvas, ни DOM, ни React.
// Отдельно от рисования нарочно: композицию сцены можно проверить тестом,
// а мазки кистью проверить тестом нельзя.
//
// Ни одной картинки в проекте нет и не будет: сцена собирается из состояния
// и рисуется линиями. Поэтому она работает оффлайн, весит ноль байт
// и подходит любому миру, который придумает игрок, — включая тот, для которого
// никто никогда не нарисует спрайтов.
import { phaseOf } from "../../ladders.ts"
import { flavorFor } from "../../narrator/flavor.ts"
import { Rng, hash32 } from "../../narrator/rng.ts"
import type { State } from "../../types.ts"

export type Weather = "ясно" | "дождь" | "снег" | "пыль" | "туман"
export type Ground = "камень" | "доски" | "земля"
export type PropKind = "стена" | "дверь" | "ящик" | "бочка" | "столб" | "дерево" | "кран" | "труба" | "телега" | "окно"

export type PropShape = {
	kind: PropKind
	/** Доля ширины кадра: 0 — левый край, 1 — правый. */
	x: number
	/** Доля высоты кадра от линии земли вверх. */
	h: number
	w: number
	/** Слой: 0 — далеко, 1 — средне, 2 — близко. */
	layer: 0 | 1 | 2
	tone: number
}

export type Lamp = { x: number; y: number; r: number; warmth: number }

export type FigureMood = "ровно" | "устал" | "ранен" | "напряжён" | "мёртв"

export type Figure = {
	id: string
	name: string
	/** Доля ширины кадра. */
	x: number
	/** Рост в долях высоты кадра. */
	height: number
	kind: "player" | "npc"
	mood: FigureMood
	/** Смотрит вправо или влево. */
	facing: 1 | -1
	/** Отношение NPC: от этого зависит поза и расстояние. */
	attitude?: number
}

export type SceneModel = {
	seed: number
	flavorId: string
	phase: string
	minuteOfDay: number
	weather: Weather
	ground: Ground
	indoor: boolean
	horizon: number
	props: PropShape[]
	lamps: Lamp[]
	figures: Figure[]
	/** Подпись места — её же показывает интерфейс под кадром. */
	caption: string
}

const INDOOR_WORDS = [
	"пакгауз",
	"контор",
	"барак",
	"комнат",
	"трактир",
	"мастерск",
	"склад",
	"погреб",
	"сарай",
	"дом",
	"зал",
	"коридор",
	"каюта",
	"цех",
	"кухн",
	"подвал",
]

function looksIndoor(location: string): boolean {
	const l = location.toLowerCase()
	if (/двор|улиц|площад|переул|дорог|поле|причал|мост|ворот|берег|крыш|сад|лес/.test(l)) return false
	return INDOOR_WORDS.some((w) => l.includes(w))
}

function weatherFor(state: State, rng: Rng): Weather {
	const hay = `${state.meta.setting} ${state.scene.light}`.toLowerCase()
	if (/зим|снег|мороз|стуж/.test(hay)) return rng.chance(0.6) ? "снег" : "ясно"
	if (/шторм|дожд|осен|сыр|туман|порт|гаван/.test(hay)) {
		return rng.weighted([
			{ value: "дождь" as Weather, weight: 3 },
			{ value: "туман" as Weather, weight: 2 },
			{ value: "ясно" as Weather, weight: 3 },
		])
	}
	if (/засух|пыл|степ|пустош|шахт|руд/.test(hay)) return rng.chance(0.5) ? "пыль" : "ясно"
	return rng.weighted([
		{ value: "ясно" as Weather, weight: 5 },
		{ value: "дождь" as Weather, weight: 2 },
		{ value: "туман" as Weather, weight: 1 },
	])
}

function groundFor(flavorId: string, indoor: boolean): Ground {
	if (indoor) return "доски"
	if (flavorId === "порт") return "доски"
	if (flavorId === "село" || flavorId === "дорога") return "земля"
	return "камень"
}

/** Крупные силуэты по вкусу мира: то, чем это место опознаётся с одного взгляда. */
function skyline(flavorId: string, rng: Rng, indoor: boolean): PropShape[] {
	const out: PropShape[] = []
	const put = (kind: PropKind, x: number, w: number, h: number, layer: 0 | 1 | 2): void => {
		out.push({ kind, x, w, h, layer, tone: rng.range(0.25, 0.7) })
	}

	if (indoor) {
		put("стена", 0.5, 1.1, 0.72, 0)
		put("окно", rng.range(0.12, 0.3), 0.1, 0.22, 1)
		put("дверь", rng.range(0.68, 0.86), 0.12, 0.34, 1)
		const crates = rng.int(2, 4)
		for (let i = 0; i < crates; i += 1) {
			put(rng.chance(0.5) ? "ящик" : "бочка", rng.range(0.05, 0.95), rng.range(0.05, 0.1), rng.range(0.08, 0.16), 2)
		}
		return out
	}

	const roofs = rng.int(4, 7)
	for (let i = 0; i < roofs; i += 1) {
		const x = (i + rng.range(0.1, 0.9)) / roofs
		put("стена", x, rng.range(0.1, 0.22), rng.range(0.18, 0.42), 0)
	}
	if (flavorId === "порт") {
		put("кран", rng.range(0.55, 0.85), 0.16, rng.range(0.4, 0.6), 0)
		put("столб", rng.range(0.1, 0.3), 0.02, 0.3, 1)
	}
	if (flavorId === "промысел") {
		put("труба", rng.range(0.6, 0.85), 0.05, rng.range(0.45, 0.65), 0)
		put("телега", rng.range(0.1, 0.35), 0.16, 0.1, 2)
	}
	if (flavorId === "село" || flavorId === "дорога") {
		const trees = rng.int(2, 4)
		for (let i = 0; i < trees; i += 1) {
			put("дерево", rng.range(0.05, 0.95), rng.range(0.08, 0.16), rng.range(0.22, 0.4), 1)
		}
	}
	if (flavorId === "город" || flavorId === "общий") {
		put("дверь", rng.range(0.6, 0.8), 0.1, 0.28, 1)
		put("столб", rng.range(0.15, 0.35), 0.02, 0.32, 1)
	}
	const near = rng.int(1, 3)
	for (let i = 0; i < near; i += 1) {
		put(rng.chance(0.5) ? "ящик" : "бочка", rng.range(0.03, 0.97), rng.range(0.05, 0.1), rng.range(0.07, 0.14), 2)
	}
	return out
}

function moodOf(state: State): FigureMood {
	if (state.dead) return "мёртв"
	const c = state.condition
	if (c.bleed > 0 || c.wounds.some((w) => w.rank >= 2)) return "ранен"
	if (c.stress.level >= 2) return "напряжён"
	if (c.fatigue >= 2 || c.hunger >= 2 || c.health >= 1) return "устал"
	return "ровно"
}

/**
 * Одна и та же сцена из одного и того же состояния выглядит одинаково:
 * зерно собирается из места и дня, а не из времени запуска. Игрок, который
 * вернулся в тот же двор, узнаёт двор.
 */
export function composeScene(state: State): SceneModel {
	const flavor = flavorFor(state.meta.setting, state.meta.specialRule)
	const seed = hash32(`${state.scene.location}|${flavor.id}|${state.meta.setting}`)
	const rng = new Rng(seed)
	const indoor = looksIndoor(state.scene.location)
	const phase = phaseOf(state.clock.minuteOfDay)
	const dayRng = new Rng(hash32(`${state.clock.day}|${state.scene.location}`))
	const weather = indoor ? "ясно" : weatherFor(state, dayRng)

	const props = skyline(flavor.id, rng, indoor)

	const dark = phase === "ночь" || phase === "сумерки" || phase === "предрассвет" || phase === "вечер"
	const lamps: Lamp[] = []
	if (dark || indoor) {
		lamps.push({ x: rng.range(0.62, 0.82), y: rng.range(0.34, 0.46), r: rng.range(0.22, 0.34), warmth: 1 })
		if (rng.chance(0.4)) lamps.push({ x: rng.range(0.08, 0.3), y: rng.range(0.4, 0.5), r: rng.range(0.12, 0.2), warmth: 0.7 })
	}

	const figures: Figure[] = [
		{
			id: "player",
			name: state.meta.character.split(",")[0] || "ты",
			x: 0.34,
			height: 0.3,
			kind: "player",
			mood: moodOf(state),
			facing: 1,
		},
	]

	// В кадре стоят те, кто в сцене. Если движок не назвал участников,
	// показываем тех, кто рядом по состоянию, но не выдумываем людей.
	const namesInScene = state.scene.participants.length
		? state.scene.participants
		: state.npcs.slice(0, 1).map((n) => n.name)
	let slot = 0
	for (const raw of namesInScene.slice(0, 3)) {
		const npc = state.npcs.find((n) => raw.includes(n.name) || n.name.includes(raw.split(",")[0]))
		const attitude = npc?.attitude ?? 3
		// Чем хуже относятся, тем дальше стоят: расстояние — это тоже отношение.
		const distance = 0.58 + slot * 0.15 + (3 - attitude) * 0.02
		figures.push({
			id: npc?.name ?? raw,
			name: (npc?.name ?? raw).split(",")[0],
			x: Math.min(0.94, distance),
			height: 0.28 - slot * 0.015,
			kind: "npc",
			mood: attitude <= 1 ? "напряжён" : "ровно",
			facing: -1,
			attitude,
		})
		slot += 1
	}

	return {
		seed,
		flavorId: flavor.id,
		phase,
		minuteOfDay: state.clock.minuteOfDay,
		weather,
		ground: groundFor(flavor.id, indoor),
		indoor,
		horizon: indoor ? 0.62 : rng.range(0.56, 0.66),
		props,
		lamps,
		figures,
		caption: state.scene.location,
	}
}

/**
 * Прямоугольники фигур в пикселях. Нужны и кисти, и попаданию мышью:
 * по человеку в кадре можно нажать, и это будет разговор с ним.
 */
export function figureBoxes(
	model: SceneModel,
	size: { w: number; h: number },
): { id: string; name: string; kind: Figure["kind"]; x: number; y: number; w: number; h: number }[] {
	const groundY = model.horizon * size.h
	return model.figures.map((f) => {
		const h = f.height * size.h
		const w = h * 0.42
		return {
			id: f.id,
			name: f.name,
			kind: f.kind,
			x: f.x * size.w - w / 2,
			y: groundY + (size.h - groundY) * 0.42 - h,
			w,
			h,
		}
	})
}
