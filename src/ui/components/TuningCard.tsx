// Настройка вкуса партии. Один выбор пресета на виду, тонкие ручки — в свёрнутом блоке.
// Ярлык не хранится: он всегда выводится из значений (labelOf), поэтому крутнул ручку —
// подпись сама стала «Своё», совпало с пресетом — вернулось его имя.
import { useId, useState } from "react"
import {
	TUNING_LIMITS,
	TUNING_PRESETS,
	labelOf,
	labelTitle,
	pressureProfile,
} from "../../tuning.ts"
import type { DeathRule, SceneLength, Tuning } from "../../tuning.ts"

const PRESSURE_WORDS = ["мир терпит", "мир помнит", "мир считает", "мир торопит", "мир не ждёт"]

const SCENE_LENGTHS: { id: SceneLength; hint: string }[] = [
	{ id: "короткая", hint: "минуты" },
	{ id: "средняя", hint: "полчаса-час" },
	{ id: "длинная", hint: "полдня" },
]

const DEATH_RULES: { id: DeathRule; label: string; hint: string }[] = [
	{ id: "смерть", label: "Смерть", hint: "партия заканчивается" },
	{ id: "шрам", label: "Шрам", hint: "выживает с необратимым увечьем" },
]

export function TuningCard(props: {
	value: Tuning
	onChange: (next: Tuning) => void
	/** Ручки открыты сразу — для экрана правил уже начатой партии. */
	openKnobs?: boolean
}) {
	const t = props.value
	const label = labelOf(t)
	const [open, setOpen] = useState(Boolean(props.openKnobs))
	const group = useId()
	const prof = pressureProfile(t)
	const set = <K extends keyof Tuning>(key: K, v: Tuning[K]): void =>
		props.onChange({ ...t, [key]: v })

	return (
		<section className="tuning">
			<header className="tuning-head">
				<h3>Правила партии</h3>
				<span className="tuning-label" data-custom={label === "custom" ? "yes" : "no"}>
					{labelTitle(label)}
				</span>
			</header>

			<div className="tuning-presets" role="radiogroup" aria-label="Пресет правил">
				{TUNING_PRESETS.map((p) => (
					<label key={p.id} className="tuning-preset" data-on={label === p.id ? "yes" : "no"}>
						<input
							type="radio"
							name={`${group}-preset`}
							checked={label === p.id}
							onChange={() => props.onChange({ ...p.values })}
						/>
						<span className="tuning-preset-body">
							<strong>{p.title}</strong>
							<span className="muted">{p.blurb}</span>
						</span>
					</label>
				))}
			</div>

			<button
				type="button"
				className="ghost small tuning-toggle"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
			>
				{open ? "Скрыть тонкие ручки" : "Тонкие ручки"}
			</button>

			{!open ? null : (
				<div className="tuning-knobs">
					<label className="knob">
						<span className="knob-name">
							Давление мира
							<em>
								{t.worldPressure}/5 · {PRESSURE_WORDS[t.worldPressure - 1]}
							</em>
						</span>
						<input
							type="range"
							min={TUNING_LIMITS.worldPressure.min}
							max={TUNING_LIMITS.worldPressure.max}
							step={1}
							value={t.worldPressure}
							onChange={(e) => set("worldPressure", Number(e.target.value))}
						/>
						<span className="knob-note">
							просрочка идёт по ступеням на {prof.overdueStages.join(", ")} день; движок настаивает{" "}
							{prof.directivePatience} ходов
						</span>
					</label>

					<div className="knob">
						<span className="knob-name">Длина сцены</span>
						<div className="seg">
							{SCENE_LENGTHS.map((o) => (
								<button
									key={o.id}
									type="button"
									className="seg-item"
									data-on={t.sceneLength === o.id ? "yes" : "no"}
									aria-pressed={t.sceneLength === o.id}
									onClick={() => set("sceneLength", o.id)}
								>
									{o.id}
									<em>{o.hint}</em>
								</button>
							))}
						</div>
						<span className="knob-note">
							ход обычно занимает около {prof.sceneMinutes.base} минут игрового времени
						</span>
					</div>

					<div className="knob">
						<span className="knob-name">Если приходит смерть</span>
						<div className="seg">
							{DEATH_RULES.map((o) => (
								<button
									key={o.id}
									type="button"
									className="seg-item"
									data-on={t.deathRule === o.id ? "yes" : "no"}
									aria-pressed={t.deathRule === o.id}
									onClick={() => set("deathRule", o.id)}
								>
									{o.label}
									<em>{o.hint}</em>
								</button>
							))}
						</div>
						<span className="knob-note">
							шрам не лечится и остаётся в состоянии до конца партии
						</span>
					</div>

					<label className="knob">
						<span className="knob-name">
							Отношения остывают
							<em>{t.bondCoolDays} дн. без встречи</em>
						</span>
						<input
							type="range"
							min={TUNING_LIMITS.bondCoolDays.min}
							max={TUNING_LIMITS.bondCoolDays.max}
							step={1}
							value={t.bondCoolDays}
							onChange={(e) => set("bondCoolDays", Number(e.target.value))}
						/>
						<span className="knob-note">считается по игровым дням, а не по числу ходов</span>
					</label>

					<label className="knob">
						<span className="knob-name">
							Настойчивость с вопросами
							<em>напоминание через {t.unknownsPatience} ходов</em>
						</span>
						<input
							type="range"
							min={TUNING_LIMITS.unknownsPatience.min}
							max={TUNING_LIMITS.unknownsPatience.max}
							step={1}
							value={t.unknownsPatience}
							onChange={(e) => set("unknownsPatience", Number(e.target.value))}
						/>
						<span className="knob-note">
							если реестр неустановленного не пополняется, движок сам требует новую неясность
						</span>
					</label>
				</div>
			)}
		</section>
	)
}
