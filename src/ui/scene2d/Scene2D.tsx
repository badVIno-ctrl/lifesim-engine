// Кадр сцены в React. Здесь только жизненный цикл: размеры, кадры, курсор, доступность.
// Вся картинка — в compose.ts и paint.ts, вся игра — в ядре.
import { useEffect, useMemo, useRef, useState } from "react"
import { composeScene } from "./compose.ts"
import { hitFigure, paintScene } from "./paint.ts"
import type { State } from "../../types.ts"

/** Кадр не растягивается бесконечно: у сцены есть своя пропорция. */
const ASPECT = 16 / 9
const MAX_DPR = 2

function prefersStill(): boolean {
	if (typeof matchMedia !== "function") return false
	return matchMedia("(prefers-reduced-motion: reduce)").matches
}

export function Scene2D(props: {
	state: State
	/** Нажали на человека в кадре: интерфейс решает, что с этим делать. */
	onPickPerson?: (name: string) => void
	/** Пока идёт ход, кадр приглушается: игрок видит, что мир занят. */
	busy?: boolean
}) {
	const holder = useRef<HTMLDivElement>(null)
	const canvas = useRef<HTMLCanvasElement>(null)
	const [size, setSize] = useState({ w: 640, h: 360 })
	const [hover, setHover] = useState<string | null>(null)
	const hoverRef = useRef<string | null>(null)
	const still = useMemo(prefersStill, [])

	const model = useMemo(() => composeScene(props.state), [props.state])
	const modelRef = useRef(model)
	modelRef.current = model
	hoverRef.current = hover

	// Размер: по ширине контейнера, высота из пропорции. ResizeObserver, а не resize:
	// панель состояния над кадром меняет высоту без изменения окна.
	useEffect(() => {
		const el = holder.current
		if (!el) return
		const measure = (): void => {
			const w = Math.max(240, el.clientWidth)
			// Кадр не съедает прозу и колоду: треть высоты окна — потолок.
			const h = Math.round(Math.min(w / ASPECT, Math.max(170, window.innerHeight * 0.34), 400))
			setSize({ w, h })
		}
		measure()
		if (typeof ResizeObserver === "undefined") {
			window.addEventListener("resize", measure)
			return () => window.removeEventListener("resize", measure)
		}
		const ro = new ResizeObserver(measure)
		ro.observe(el)
		window.addEventListener("resize", measure)
		return () => {
			ro.disconnect()
			window.removeEventListener("resize", measure)
		}
	}, [])

	// Кадры. Статичная сцена рисуется один раз: греть процессор ради ничего нельзя.
	useEffect(() => {
		const el = canvas.current
		if (!el) return
		const ctx = el.getContext("2d")
		if (!ctx) return
		const dpr = Math.min(MAX_DPR, typeof devicePixelRatio === "number" ? devicePixelRatio : 1)
		el.width = Math.round(size.w * dpr)
		el.height = Math.round(size.h * dpr)
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

		let raf = 0
		let stop = false
		const started = typeof performance === "object" ? performance.now() : Date.now()
		const draw = (now: number): void => {
			if (stop) return
			paintScene(ctx, modelRef.current, size, {
				time: (now - started) / 1000,
				still,
				hoverId: hoverRef.current,
			})
			if (!still) raf = requestAnimationFrame(draw)
		}

		if (still) {
			paintScene(ctx, model, size, { time: 0, still: true, hoverId: hover })
		} else {
			raf = requestAnimationFrame(draw)
		}

		// Скрытая вкладка не рисует: телефон это чувствует батареей.
		const onVisibility = (): void => {
			if (document.hidden) {
				cancelAnimationFrame(raf)
			} else if (!still) {
				raf = requestAnimationFrame(draw)
			}
		}
		document.addEventListener("visibilitychange", onVisibility)
		return () => {
			stop = true
			cancelAnimationFrame(raf)
			document.removeEventListener("visibilitychange", onVisibility)
		}
	}, [size, model, still, hover])

	const people = model.figures.filter((f) => f.kind === "npc")

	return (
		<div className="scene" ref={holder} data-busy={props.busy ? "yes" : "no"}>
			<canvas
				ref={canvas}
				className="scene-canvas"
				style={{ width: `${size.w}px`, height: `${size.h}px` }}
				role="img"
				aria-label={`${model.caption}. ${model.phase}, ${model.weather}. Рядом: ${
					people.length ? people.map((f) => f.name).join(", ") : "никого"
				}`}
				onPointerMove={(e) => {
					const rect = e.currentTarget.getBoundingClientRect()
					const id = hitFigure(model, size, e.clientX - rect.left, e.clientY - rect.top)
					if (id !== hover) setHover(id)
				}}
				onPointerLeave={() => setHover(null)}
				onClick={(e) => {
					const rect = e.currentTarget.getBoundingClientRect()
					const id = hitFigure(model, size, e.clientX - rect.left, e.clientY - rect.top)
					const person = model.figures.find((f) => f.id === id && f.kind === "npc")
					if (person && props.onPickPerson) props.onPickPerson(person.name)
				}}
			/>

			<div className="scene-caption">
				<span className="scene-place">{model.caption}</span>
				<span className="scene-weather">
					{model.phase}
					{model.weather === "ясно" ? "" : `, ${model.weather}`}
				</span>
			</div>

			{/* Имена людей в кадре — текстом, а не только силуэтом: иначе кадр нельзя прочитать
			    ни клавиатурой, ни голосом, ни на маленьком экране. */}
			{people.length ? (
				<div className="scene-people">
					{people.map((f) => (
						<button
							key={f.id}
							type="button"
							className="scene-person"
							data-hover={hover === f.id ? "yes" : "no"}
							onPointerEnter={() => setHover(f.id)}
							onPointerLeave={() => setHover(null)}
							onFocus={() => setHover(f.id)}
							onBlur={() => setHover(null)}
							onClick={() => props.onPickPerson?.(f.name)}
						>
							{f.name}
						</button>
					))}
				</div>
			) : null}
		</div>
	)
}
