// Экран 1. НАЧАЛО. Здесь решается, начнёт человек играть или закроет вкладку.
// Поэтому первая кнопка — «Играть сразу»: без ключа, без настроек, без вопросов.
// Всё остальное (свой мир, свой персонаж, свои правила) живёт рядом и не мешает.
import { useRef } from "react"
import { Notice, Screen } from "../components/Screen.tsx"
import type { Settings } from "../settings.ts"
import type { GameSummary } from "../../storage/types.ts"

function when(ts: number): string {
	const d = new Date(ts)
	const pad = (n: number) => String(n).padStart(2, "0")
	return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function StartScreen(props: {
	games: GameSummary[]
	settings: Settings
	error: string | null
	onContinue: (id: string) => void
	onDelete: (id: string) => void | Promise<void>
	onExport: (id: string) => void | Promise<void>
	onImport: (text: string) => void | Promise<void>
	onQuickStart: () => void | Promise<void>
	onNew: () => void
	onSettings: () => void
}) {
	const fileRef = useRef<HTMLInputElement>(null)
	const local = props.settings.engine === "local"

	return (
		<Screen
			title="Симулятор мира"
			subtitle="жизнь одного человека, посчитанная по правилам"
			action={
				<button type="button" className="ghost small" onClick={props.onSettings}>
					Настройки
				</button>
			}
		>
			<div className="stack">
				{props.error ? <Notice kind="bad">{props.error}</Notice> : null}

				<div className="start-hero">
					<h2>Текстовая жизнь, в которую можно войти с улицы</h2>
					<p className="lead">
						Вы заявляете, что делает человек. Мир считает, чем это обошлось: временем, деньгами,
						телом, чужим отношением. Числа считает движок, сцену пишет рассказчик, и ни то ни другое
						не спрашивает у вас разрешения.
					</p>
					<div className="engine-note">
						{local ? (
							<>
								<b>Рассказчик — свой движок.</b> Без ключей, без сети, без токенов.
							</>
						) : (
							<>Рассказчик — модель по вашему ключу. Свой движок включается в настройках.</>
						)}
					</div>
				</div>

				<button type="button" className="primary wide" onClick={() => void props.onQuickStart()}>
					Играть сразу
				</button>

				<div className="row">
					<button type="button" className="ghost grow" onClick={props.onNew}>
						Свой мир и свой персонаж
					</button>
					<button type="button" className="ghost grow" onClick={() => fileRef.current?.click()}>
						Импорт из JSON
					</button>
					<input
						ref={fileRef}
						type="file"
						accept="application/json,.json"
						hidden
						onChange={async (e) => {
							const file = e.target.files?.[0]
							e.target.value = ""
							if (!file) return
							await props.onImport(await file.text())
						}}
					/>
				</div>

				{props.games.length === 0 ? null : (
					<>
						<h3 className="group-title">Сохранённые партии</h3>
						{props.games.map((g) => (
							<div key={g.id} className="game-row">
								<div className="grow">
									<strong>{g.title}</strong>
									<div className="muted">
										ход {g.turn} · день {g.day} · пак {g.packId}
										{g.dead ? " · персонаж мёртв" : ""}
									</div>
									<div className="faint">изменено {when(g.updatedAt)}</div>
								</div>
								<div className="row">
									<button
										type="button"
										className="primary small"
										onClick={() => props.onContinue(g.id)}
									>
										Продолжить
									</button>
									<button
										type="button"
										className="ghost small"
										onClick={() => void props.onExport(g.id)}
									>
										Экспорт
									</button>
									<button
										type="button"
										className="danger small"
										onClick={() => {
											if (confirm(`Удалить «${g.title}» безвозвратно?`)) void props.onDelete(g.id)
										}}
									>
										Удалить
									</button>
								</div>
							</div>
						))}
					</>
				)}
			</div>
		</Screen>
	)
}
