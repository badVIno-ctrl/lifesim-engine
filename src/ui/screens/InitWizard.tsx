// Экран 3. ИНИЦИАЦИЯ: 8 шагов, по одному вопросу на экран.
// Модель здесь не участвует вообще: state собирает код (src/init.ts).
// prompt/INIT.md — человеческая версия тех же восьми вопросов; в контекст игры он не попадает.
import { useMemo, useState } from "react"
import { Notice, Screen } from "../components/Screen.tsx"
import { INIT_STEPS, allDefaults, buildStateFromAnswers, defaultAnswer } from "../../init.ts"
import type { InitAnswers } from "../../init.ts"
import { packById } from "../assets.ts"
import type { State } from "../../types.ts"

import type { Tuning } from "../../tuning.ts"

export function InitWizard(props: {
	packId: string
	tuning: Tuning
	onBack: () => void
	onDone: (state: State) => void | Promise<void>
}) {
	const pack = useMemo(() => packById(props.packId), [props.packId])
	const [index, setIndex] = useState(0)
	const [answers, setAnswers] = useState<InitAnswers>({})
	const [error, setError] = useState<string | null>(null)

	if (!pack) {
		return (
			<Screen title="Инициация" onBack={props.onBack}>
				<Notice kind="bad">Пак «{props.packId}» не найден.</Notice>
			</Screen>
		)
	}

	const step = INIT_STEPS[index]
	const value = answers[step.id] ?? ""
	const last = index === INIT_STEPS.length - 1

	const set = (v: string) => setAnswers((a) => ({ ...a, [step.id]: v }))

	const finish = async (final: InitAnswers) => {
		try {
			const state = buildStateFromAnswers(pack, final, props.tuning)
			await props.onDone(state)
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		}
	}

	return (
		<Screen
			title={step.title}
			subtitle={`шаг ${index + 1} из ${INIT_STEPS.length} · ${pack.setting}`}
			onBack={index === 0 ? props.onBack : () => setIndex(index - 1)}
		>
			<div className="stack">
				<div className="wizard-progress" aria-hidden="true">
					{INIT_STEPS.map((s, i) => (
						<span key={s.id} className={i <= index ? "done" : ""} />
					))}
				</div>

				{error ? <Notice kind="bad">{error}</Notice> : null}

				<h2>{step.question}</h2>
				<p className="muted">{step.hint}</p>

				{step.kind === "choice" ? (
					<div className="stack">
						{(step.choices ?? []).map((c) => (
							<button
								key={c}
								type="button"
								className={value === c ? "tile selected" : "tile"}
								onClick={() => set(c)}
							>
								{c}
							</button>
						))}
					</div>
				) : step.kind === "number" ? (
					<input
						type="number"
						inputMode="numeric"
						value={value}
						placeholder={defaultAnswer(step.id, pack)}
						onChange={(e) => set(e.target.value)}
					/>
				) : (
					<textarea
						rows={3}
						value={value}
						placeholder={defaultAnswer(step.id, pack)}
						onChange={(e) => set(e.target.value)}
					/>
				)}

				<div className="examples">
					<span className="faint">Примеры:</span>
					{step.examples.map((ex, i) => (
						<button key={i} type="button" className="ghost small" onClick={() => set(ex)}>
							{ex}
						</button>
					))}
				</div>

				<div className="row">
					<button
						type="button"
						className="ghost grow"
						onClick={() => {
							const filled = { ...answers, [step.id]: defaultAnswer(step.id, pack) }
							setAnswers(filled)
							if (last) void finish(filled)
							else setIndex(index + 1)
						}}
					>
						Мне всё равно, реши сам
					</button>
					<button
						type="button"
						className="primary grow"
						onClick={() => {
							if (last) void finish(answers)
							else setIndex(index + 1)
						}}
					>
						{last ? "Начать игру" : "Дальше"}
					</button>
				</div>

				<button
					type="button"
					className="ghost"
					onClick={() => void finish({ ...allDefaults(pack), ...answers })}
				>
					Заполнить всё оставшееся и начать
				</button>
			</div>
		</Screen>
	)
}
