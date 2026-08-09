// Кисть. Единственный файл проекта, который знает про canvas 2d.
//
// Приём один и он держит весь вид: ничего не заливается ровным цветом.
// Каждая линия дрожит на доли пикселя по детерминированному шуму, силуэты
// набираются штрихами, свет ложится пятном. Это отличает рисунок от
// прямоугольников со скруглением и даёт кадру характер лампы и туши.
import { Rng, hash32 } from "../../narrator/rng.ts"
import { figureBoxes } from "./compose.ts"
import type { Figure, PropShape, SceneModel } from "./compose.ts"
import { paletteFor, withAlpha } from "./palette.ts"
import type { Palette } from "./palette.ts"

export type Size = { w: number; h: number }

export type PaintOptions = {
	/** Секунды с начала показа. Ноль — статичный кадр. */
	time: number
	/** Движение выключено: prefers-reduced-motion или экономия. */
	still: boolean
	/** Кого подсветить: под курсором или под пальцем. */
	hoverId?: string | null
}

/** Тёплая дрожь линии: одна и та же для одной сцены, поэтому кадр не «кипит». */
function wobble(rng: Rng, amount: number): number {
	return rng.range(-amount, amount)
}

function inkPath(
	ctx: CanvasRenderingContext2D,
	points: [number, number][],
	rng: Rng,
	jitter: number,
): void {
	ctx.beginPath()
	points.forEach(([x, y], i) => {
		const px = x + wobble(rng, jitter)
		const py = y + wobble(rng, jitter)
		if (i === 0) ctx.moveTo(px, py)
		else ctx.lineTo(px, py)
	})
}

function fillWobbly(
	ctx: CanvasRenderingContext2D,
	points: [number, number][],
	color: string,
	rng: Rng,
	jitter = 1.2,
): void {
	inkPath(ctx, points, rng, jitter)
	ctx.closePath()
	ctx.fillStyle = color
	ctx.fill()
}

function sky(ctx: CanvasRenderingContext2D, size: Size, p: Palette, model: SceneModel): void {
	const g = ctx.createLinearGradient(0, 0, 0, size.h * model.horizon)
	g.addColorStop(0, p.skyTop)
	g.addColorStop(1, p.skyBottom)
	ctx.fillStyle = g
	ctx.fillRect(0, 0, size.w, size.h * model.horizon + 1)

	// Луна или солнце: одна деталь, по которой читается час.
	const m = model.minuteOfDay
	const dayLight = m > 330 && m < 1230
	const t = dayLight ? (m - 330) / 900 : ((m + 1440 - 1230) % 1440) / 540
	const x = size.w * (0.12 + t * 0.76)
	const y = size.h * model.horizon * (0.72 - Math.sin(t * Math.PI) * 0.5)
	if (!model.indoor) {
		ctx.beginPath()
		ctx.arc(x, y, size.h * (dayLight ? 0.028 : 0.022), 0, Math.PI * 2)
		ctx.fillStyle = withAlpha(dayLight ? "#f7e6bd" : "#cfd8e6", dayLight ? 0.5 : 0.7)
		ctx.fill()
	}
}

function prop(ctx: CanvasRenderingContext2D, s: PropShape, size: Size, p: Palette, rng: Rng): void {
	const groundY = size.h * model_horizon(size, s)
	const color = s.layer === 0 ? p.far : s.layer === 1 ? p.mid : p.near
	const w = s.w * size.w
	const h = s.h * size.h
	const x = s.x * size.w - w / 2
	const top = groundY - h

	switch (s.kind) {
		case "дерево": {
			const trunkW = Math.max(2, w * 0.16)
			fillWobbly(
				ctx,
				[
					[x + w / 2 - trunkW / 2, groundY],
					[x + w / 2 - trunkW / 2, top + h * 0.45],
					[x + w / 2 + trunkW / 2, top + h * 0.45],
					[x + w / 2 + trunkW / 2, groundY],
				],
				color,
				rng,
				1,
			)
			ctx.beginPath()
			const cx = x + w / 2
			const cy = top + h * 0.34
			for (let i = 0; i < 12; i += 1) {
				const a = (i / 12) * Math.PI * 2
				const r = (w / 2) * (0.75 + rng.range(-0.18, 0.22))
				const px = cx + Math.cos(a) * r
				const py = cy + Math.sin(a) * r * 0.8
				if (i === 0) ctx.moveTo(px, py)
				else ctx.lineTo(px, py)
			}
			ctx.closePath()
			ctx.fillStyle = color
			ctx.fill()
			break
		}
		case "кран": {
			ctx.strokeStyle = color
			ctx.lineWidth = Math.max(2, w * 0.06)
			inkPath(ctx, [[x + w * 0.3, groundY], [x + w * 0.3, top]], rng, 1)
			ctx.stroke()
			inkPath(ctx, [[x, top + h * 0.1], [x + w, top + h * 0.22]], rng, 1)
			ctx.stroke()
			inkPath(ctx, [[x + w * 0.85, top + h * 0.19], [x + w * 0.85, top + h * 0.46]], rng, 1)
			ctx.stroke()
			break
		}
		case "труба": {
			fillWobbly(
				ctx,
				[
					[x, groundY],
					[x + w * 0.18, top],
					[x + w * 0.82, top],
					[x + w, groundY],
				],
				color,
				rng,
				1,
			)
			break
		}
		case "столб": {
			ctx.strokeStyle = color
			ctx.lineWidth = Math.max(2, w * size.w * 0.02)
			inkPath(ctx, [[x + w / 2, groundY], [x + w / 2, top]], rng, 0.8)
			ctx.stroke()
			break
		}
		case "окно": {
			fillWobbly(
				ctx,
				[
					[x, top],
					[x + w, top],
					[x + w, top + h],
					[x, top + h],
				],
				withAlpha(p.lamp, 0.22 + p.darkness * 0.5),
				rng,
				0.8,
			)
			ctx.strokeStyle = withAlpha(p.groundLine, 0.8)
			ctx.lineWidth = 1.5
			inkPath(ctx, [[x + w / 2, top], [x + w / 2, top + h]], rng, 0.6)
			ctx.stroke()
			break
		}
		case "дверь": {
			fillWobbly(
				ctx,
				[
					[x, groundY],
					[x, top],
					[x + w, top],
					[x + w, groundY],
				],
				withAlpha(p.near, 0.95),
				rng,
				0.9,
			)
			ctx.strokeStyle = withAlpha(p.groundLine, 0.9)
			ctx.lineWidth = 1.5
			ctx.stroke()
			break
		}
		case "телега": {
			fillWobbly(
				ctx,
				[
					[x, groundY - h * 0.35],
					[x + w, groundY - h * 0.5],
					[x + w, groundY - h * 0.1],
					[x, groundY - h * 0.1],
				],
				color,
				rng,
				1,
			)
			for (const wx of [x + w * 0.2, x + w * 0.78]) {
				ctx.beginPath()
				ctx.arc(wx, groundY - h * 0.08, h * 0.16, 0, Math.PI * 2)
				ctx.strokeStyle = color
				ctx.lineWidth = 2
				ctx.stroke()
			}
			break
		}
		case "ящик":
		case "бочка": {
			if (s.kind === "бочка") {
				fillWobbly(
					ctx,
					[
						[x + w * 0.1, groundY],
						[x, groundY - h * 0.75],
						[x + w * 0.15, groundY - h],
						[x + w * 0.85, groundY - h],
						[x + w, groundY - h * 0.75],
						[x + w * 0.9, groundY],
					],
					color,
					rng,
					0.9,
				)
			} else {
				fillWobbly(
					ctx,
					[
						[x, groundY],
						[x, groundY - h],
						[x + w, groundY - h * 1.06],
						[x + w, groundY],
					],
					color,
					rng,
					0.9,
				)
			}
			break
		}
		default: {
			// Стена или крыша: неровный верх — самое важное в силуэте города.
			const steps = 4
			const pts: [number, number][] = [[x, groundY]]
			for (let i = 0; i <= steps; i += 1) {
				pts.push([x + (w * i) / steps, top + rng.range(-h * 0.06, h * 0.06)])
			}
			pts.push([x + w, groundY])
			fillWobbly(ctx, pts, color, rng, 1.1)
			break
		}
	}
}

// Земля у всех силуэтов одна, но близкие стоят ниже: так читается глубина.
function model_horizon(_size: Size, s: PropShape): number {
	return s.layer === 0 ? 0.6 : s.layer === 1 ? 0.63 : 0.72
}

function ground(ctx: CanvasRenderingContext2D, size: Size, p: Palette, model: SceneModel, rng: Rng): void {
	const y = size.h * model.horizon
	ctx.fillStyle = p.ground
	ctx.fillRect(0, y, size.w, size.h - y)
	ctx.strokeStyle = withAlpha(p.groundLine, 0.9)
	ctx.lineWidth = 1
	inkPath(ctx, [[0, y], [size.w, y]], rng, 1)
	ctx.stroke()

	// Фактура: камень, доски или земля — тремя разными штрихами.
	ctx.strokeStyle = withAlpha(p.groundLine, 0.45)
	const rows = 7
	for (let r = 0; r < rows; r += 1) {
		const ry = y + ((size.h - y) * (r + 1)) / (rows + 1)
		const scale = 1 + r * 0.5
		if (model.ground === "доски") {
			inkPath(ctx, [[0, ry], [size.w, ry]], rng, 1.5)
			ctx.stroke()
		} else if (model.ground === "камень") {
			const cells = Math.max(3, Math.round(6 * scale))
			for (let c = 0; c < cells; c += 1) {
				const cx = (size.w * (c + rng.range(0.2, 0.8))) / cells
				inkPath(ctx, [[cx, ry], [cx + size.w / cells / 2, ry]], rng, 1.4)
				ctx.stroke()
			}
		} else {
			for (let c = 0; c < 5; c += 1) {
				const cx = size.w * rng.float()
				inkPath(ctx, [[cx, ry], [cx + 6 * scale, ry + 1]], rng, 1.6)
				ctx.stroke()
			}
		}
	}
}

function lampLight(
	ctx: CanvasRenderingContext2D,
	size: Size,
	p: Palette,
	model: SceneModel,
	opts: PaintOptions,
): void {
	for (const [i, lamp] of model.lamps.entries()) {
		const flicker = opts.still ? 1 : 0.94 + Math.sin(opts.time * (3.1 + i) + i) * 0.03 + Math.sin(opts.time * 11.3) * 0.03
		const cx = lamp.x * size.w
		const cy = lamp.y * size.h
		const r = lamp.r * Math.min(size.w, size.h) * 2.2 * flicker
		const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
		const strength = (0.16 + p.darkness * 0.42) * lamp.warmth
		g.addColorStop(0, withAlpha(p.lamp, strength))
		g.addColorStop(0.45, withAlpha(p.lamp, strength * 0.35))
		g.addColorStop(1, withAlpha(p.lamp, 0))
		ctx.fillStyle = g
		ctx.fillRect(0, 0, size.w, size.h)

		ctx.beginPath()
		ctx.arc(cx, cy, Math.max(2, size.h * 0.008 * flicker), 0, Math.PI * 2)
		ctx.fillStyle = withAlpha(p.lamp, 0.9)
		ctx.fill()
	}
}

function figure(
	ctx: CanvasRenderingContext2D,
	f: Figure,
	box: { x: number; y: number; w: number; h: number },
	p: Palette,
	opts: PaintOptions,
	rng: Rng,
): void {
	const breath = opts.still ? 0 : Math.sin(opts.time * 1.6 + f.x * 9) * box.h * 0.006
	const hunch = f.mood === "устал" || f.mood === "ранен" ? box.h * 0.05 : 0
	const dead = f.mood === "мёртв"
	const top = box.y + hunch + breath
	const cx = box.x + box.w / 2
	const bottom = box.y + box.h
	const color = f.kind === "player" ? p.figure : withAlpha(p.figure, 0.88)

	ctx.save()
	if (dead) {
		ctx.translate(cx, bottom)
		ctx.rotate(Math.PI / 2)
		ctx.translate(-cx, -bottom)
	}

	// Подсветка под курсором: слабое тёплое кольцо, а не рамка.
	if (opts.hoverId === f.id) {
		const g = ctx.createRadialGradient(cx, bottom, 0, cx, bottom, box.h * 0.6)
		g.addColorStop(0, withAlpha(p.lamp, 0.3))
		g.addColorStop(1, withAlpha(p.lamp, 0))
		ctx.fillStyle = g
		ctx.fillRect(cx - box.h, bottom - box.h, box.h * 2, box.h * 1.4)
	}

	// Тень: смещение и мягкость, а не круг под ногами.
	ctx.fillStyle = withAlpha("#000000", 0.35 - p.darkness * 0.2)
	ctx.beginPath()
	ctx.ellipse(cx + box.w * 0.25, bottom, box.w * 0.75, box.h * 0.035, 0, 0, Math.PI * 2)
	ctx.fill()

	const headR = box.w * 0.28
	// Ноги: две стойки от полы до земли. Без них силуэт читается мешком.
	const legTop = bottom - box.h * 0.26
	const stride = f.mood === "устал" || f.mood === "ранен" ? 0.07 : 0.11
	for (const dir of [-1, 1]) {
		fillWobbly(
			ctx,
			[
				[cx + dir * box.w * 0.06, legTop],
				[cx + dir * box.w * stride * 1.6, bottom],
				[cx + dir * box.w * (stride * 1.6 + 0.16), bottom],
				[cx + dir * box.w * 0.22, legTop],
			],
			color,
			rng,
			0.7,
		)
	}
	// Плащ: от плеч до бедра, полой наружу. Человек, а не палка.
	fillWobbly(
		ctx,
		[
			[cx - box.w * 0.36, legTop + box.h * 0.03],
			[cx - box.w * 0.42, top + box.h * 0.34],
			[cx - box.w * 0.19, top + box.h * 0.21],
			[cx + box.w * 0.19, top + box.h * 0.21],
			[cx + box.w * 0.42, top + box.h * 0.34],
			[cx + box.w * 0.36, legTop + box.h * 0.03],
		],
		color,
		rng,
		0.9,
	)
	// Плечи и шея: короткая перекладина, которая держит голову на месте.
	ctx.strokeStyle = color
	ctx.lineWidth = Math.max(2, box.w * 0.12)
	inkPath(
		ctx,
		[
			[cx - box.w * 0.22, top + box.h * 0.23],
			[cx + box.w * 0.22, top + box.h * 0.23],
		],
		rng,
		0.5,
	)
	ctx.stroke()
	ctx.beginPath()
	ctx.arc(cx + f.facing * box.w * 0.04, top + box.h * 0.12, headR, 0, Math.PI * 2)
	ctx.fillStyle = color
	ctx.fill()

	// Блик со стороны лампы: без него силуэт выглядит наклейкой.
	ctx.strokeStyle = withAlpha(p.figureLight, 0.7)
	ctx.lineWidth = Math.max(1, box.w * 0.055)
	inkPath(
		ctx,
		[
			[cx + box.w * 0.26, top + box.h * 0.2],
			[cx + box.w * 0.33, legTop],
		],
		rng,
		0.7,
	)
	ctx.stroke()

	if (f.mood === "ранен") {
		ctx.strokeStyle = withAlpha("#8c2f26", 0.85)
		ctx.lineWidth = Math.max(1.5, box.w * 0.07)
		inkPath(
			ctx,
			[
				[cx - box.w * 0.1, top + box.h * 0.36],
				[cx + box.w * 0.16, top + box.h * 0.52],
			],
			rng,
			0.8,
		)
		ctx.stroke()
	}
	ctx.restore()
}

function weather(
	ctx: CanvasRenderingContext2D,
	size: Size,
	p: Palette,
	model: SceneModel,
	opts: PaintOptions,
): void {
	if (model.weather === "ясно") return
	const rng = new Rng(model.seed ^ 0x5f3a)
	if (model.weather === "туман") {
		const g = ctx.createLinearGradient(0, size.h * (model.horizon - 0.12), 0, size.h)
		g.addColorStop(0, withAlpha(p.haze, 0))
		g.addColorStop(0.6, withAlpha(p.haze, 0.3))
		g.addColorStop(1, withAlpha(p.haze, 0.12))
		ctx.fillStyle = g
		ctx.fillRect(0, size.h * (model.horizon - 0.12), size.w, size.h)
		return
	}
	const count = model.weather === "пыль" ? 60 : 110
	const speed = model.weather === "снег" ? 26 : model.weather === "пыль" ? 40 : 420
	const drift = model.weather === "снег" ? 14 : model.weather === "пыль" ? 60 : 40
	for (let i = 0; i < count; i += 1) {
		const seedX = rng.float()
		const seedY = rng.float()
		const t = opts.still ? seedY : (seedY + (opts.time * speed) / size.h) % 1
		const x = (seedX * size.w + (opts.still ? 0 : Math.sin(opts.time * 0.6 + i) * drift) + size.w) % size.w
		const y = t * size.h
		if (model.weather === "дождь") {
			ctx.strokeStyle = withAlpha(p.particle, 0.28)
			ctx.lineWidth = 1
			ctx.beginPath()
			ctx.moveTo(x, y)
			ctx.lineTo(x - 2, y + size.h * 0.03)
			ctx.stroke()
		} else {
			ctx.fillStyle = withAlpha(p.particle, model.weather === "снег" ? 0.5 : 0.18)
			ctx.beginPath()
			ctx.arc(x, y, model.weather === "снег" ? 1.6 : 1.1, 0, Math.PI * 2)
			ctx.fill()
		}
	}
}

function grainAndVignette(ctx: CanvasRenderingContext2D, size: Size, p: Palette, seed: number): void {
	// Зерно: тысяча точек по детерминированному шуму. Дешевле шумовой текстуры
	// и не даёт кадру выглядеть векторной заливкой.
	const rng = new Rng(seed ^ 0x9e37)
	ctx.globalAlpha = 0.05
	for (let i = 0; i < Math.min(1400, Math.round((size.w * size.h) / 900)); i += 1) {
		ctx.fillStyle = rng.chance(0.5) ? "#ffffff" : "#000000"
		ctx.fillRect(rng.float() * size.w, rng.float() * size.h, 1, 1)
	}
	ctx.globalAlpha = 1

	const g = ctx.createRadialGradient(
		size.w * 0.5,
		size.h * 0.52,
		Math.min(size.w, size.h) * 0.25,
		size.w * 0.5,
		size.h * 0.52,
		Math.max(size.w, size.h) * 0.78,
	)
	g.addColorStop(0, withAlpha("#000000", 0))
	g.addColorStop(1, withAlpha("#000000", 0.45 + p.darkness * 0.2))
	ctx.fillStyle = g
	ctx.fillRect(0, 0, size.w, size.h)
}

/** Один кадр целиком. Порядок слоёв — это и есть глубина. */
export function paintScene(
	ctx: CanvasRenderingContext2D,
	model: SceneModel,
	size: Size,
	opts: PaintOptions,
): void {
	const p = paletteFor(model.minuteOfDay, model.indoor)
	// Кисть детерминирована зерном сцены: кадр не дрожит между перерисовками.
	const rng = new Rng(model.seed)
	ctx.clearRect(0, 0, size.w, size.h)
	ctx.lineJoin = "round"
	ctx.lineCap = "round"

	sky(ctx, size, p, model)
	for (const layer of [0, 1, 2] as const) {
		for (const s of model.props.filter((x) => x.layer === layer)) prop(ctx, s, size, p, rng)
	}
	ground(ctx, size, p, model, rng)
	lampLight(ctx, size, p, model, opts)

	const boxes = figureBoxes(model, size)
	for (const f of model.figures) {
		const box = boxes.find((b) => b.id === f.id)
		if (box) figure(ctx, f, box, p, opts, rng)
	}

	weather(ctx, size, p, model, opts)
	grainAndVignette(ctx, size, p, model.seed)
}

export function hitFigure(model: SceneModel, size: Size, x: number, y: number): string | null {
	const boxes = figureBoxes(model, size)
	// Сверху вниз: близкая фигура важнее далёкой.
	for (const b of [...boxes].reverse()) {
		const pad = Math.max(8, b.w * 0.4)
		if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) return b.id
	}
	return null
}

export const SCENE_SEED_SALT = hash32("сцена")
