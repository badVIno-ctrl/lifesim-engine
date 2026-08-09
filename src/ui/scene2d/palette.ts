// Палитра сцены: свет часа, погода, тепло лампы. Чистые функции, ни DOM, ни canvas.
//
// Цвет здесь не украшение, а информация: по кадру должно быть видно время суток
// раньше, чем игрок прочтёт цифры в панели. Поэтому небо, силуэты и земля берут
// цвет из одного набора, а не из случайного градиента.
export type Palette = {
	skyTop: string
	skyBottom: string
	far: string
	mid: string
	near: string
	ground: string
	groundLine: string
	figure: string
	figureLight: string
	lamp: string
	haze: string
	particle: string
	/** Насколько кадр тёмный: от этого зависит сила света лампы. */
	darkness: number
}

type Stop = { at: number; p: Omit<Palette, "darkness"> }

const NIGHT: Omit<Palette, "darkness"> = {
	skyTop: "#080a10",
	skyBottom: "#141a24",
	far: "#0e131b",
	mid: "#0a0e15",
	near: "#06090e",
	ground: "#0b0e13",
	groundLine: "#1b2230",
	figure: "#04060a",
	figureLight: "#2b3444",
	lamp: "#f0c063",
	haze: "#1a2233",
	particle: "#8fa2bd",
}

const DAWN: Omit<Palette, "darkness"> = {
	skyTop: "#1d2436",
	skyBottom: "#7b6a63",
	far: "#2a2f3c",
	mid: "#1d222c",
	near: "#12161d",
	ground: "#1a1d22",
	groundLine: "#333a45",
	figure: "#0c0f14",
	figureLight: "#4a5666",
	lamp: "#f3c877",
	haze: "#4c4c53",
	particle: "#b9c4d2",
}

const DAY: Omit<Palette, "darkness"> = {
	skyTop: "#7d8ea3",
	skyBottom: "#b9bcb6",
	far: "#5c6672",
	mid: "#3f4753",
	near: "#2a3038",
	ground: "#3a3b38",
	groundLine: "#5b5c56",
	figure: "#171a1f",
	figureLight: "#6d7684",
	lamp: "#e8c07a",
	haze: "#a9aeae",
	particle: "#e6e9ec",
}

const DUSK: Omit<Palette, "darkness"> = {
	skyTop: "#2a2233",
	skyBottom: "#b06a3c",
	far: "#3a2c33",
	mid: "#251d24",
	near: "#171217",
	ground: "#221b1c",
	groundLine: "#3d3030",
	figure: "#0a0709",
	figureLight: "#5a4148",
	lamp: "#ffcb6b",
	haze: "#6b4a3f",
	particle: "#d8b79c",
}

const STOPS: Stop[] = [
	{ at: 0, p: NIGHT },
	{ at: 300, p: NIGHT },
	{ at: 380, p: DAWN },
	{ at: 540, p: DAY },
	{ at: 1020, p: DAY },
	{ at: 1140, p: DUSK },
	{ at: 1290, p: NIGHT },
	{ at: 1440, p: NIGHT },
]

function hexToRgb(hex: string): [number, number, number] {
	const h = hex.replace("#", "")
	return [
		Number.parseInt(h.slice(0, 2), 16),
		Number.parseInt(h.slice(2, 4), 16),
		Number.parseInt(h.slice(4, 6), 16),
	]
}

function mixHex(a: string, b: string, t: number): string {
	const [r1, g1, b1] = hexToRgb(a)
	const [r2, g2, b2] = hexToRgb(b)
	const to = (x: number, y: number): string =>
		Math.round(x + (y - x) * t)
			.toString(16)
			.padStart(2, "0")
	return `#${to(r1, r2)}${to(g1, g2)}${to(b1, b2)}`
}

const KEYS: (keyof Omit<Palette, "darkness">)[] = [
	"skyTop",
	"skyBottom",
	"far",
	"mid",
	"near",
	"ground",
	"groundLine",
	"figure",
	"figureLight",
	"lamp",
	"haze",
	"particle",
]

/** Свет плавно едет по суткам: между двумя ключевыми часами цвет смешивается. */
export function paletteFor(minuteOfDay: number, indoor: boolean): Palette {
	const m = ((minuteOfDay % 1440) + 1440) % 1440
	let lo = STOPS[0]
	let hi = STOPS[STOPS.length - 1]
	for (let i = 0; i < STOPS.length - 1; i += 1) {
		if (m >= STOPS[i].at && m <= STOPS[i + 1].at) {
			lo = STOPS[i]
			hi = STOPS[i + 1]
			break
		}
	}
	const span = hi.at - lo.at || 1
	const t = Math.max(0, Math.min(1, (m - lo.at) / span))
	const out = {} as Palette
	for (const k of KEYS) out[k] = mixHex(lo.p[k], hi.p[k], t)
	// Внутри всегда темнее и теплее: свет там от лампы, а не от неба.
	if (indoor) {
		for (const k of KEYS) out[k] = mixHex(out[k], "#120d09", 0.45)
	}
	const brightness = hexToRgb(out.skyBottom).reduce((a, b) => a + b, 0) / (3 * 255)
	out.darkness = Math.max(0, Math.min(1, 1 - brightness))
	return out
}

export function withAlpha(hex: string, alpha: number): string {
	const [r, g, b] = hexToRgb(hex)
	return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`
}
