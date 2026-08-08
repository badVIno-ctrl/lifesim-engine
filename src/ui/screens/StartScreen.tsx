// Экран 1. НАЧАЛО: список партий, импорт/экспорт, новая партия, настройки.
// Работает без ключа: без него просто висит предупреждение со ссылкой в настройки.
import { useRef } from "react"
import { Notice, Screen } from "../components/Screen.tsx"
import { isConfigured } from "../settings.ts"
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
	onNew: () => void
	onSettings: () => void
}) {
	const fileRef = useRef<HTMLInputElement>(null)

	return (
		<Screen
			title="Симулятор мира"
			subtitle="текстовая жизнь одного человека · v13.1"
			action={
				<button type="button" className="ghost small" onClick={props.onSettings}>
					Настройки
				</button>
			}
		>
			<div className="stack">
				{props.error ? <Notice kind="bad">{props.error}</Notice> : null}

				{!isConfigured(props.settings) ? (
					<Notice>
						Ключ модели не задан. Игра откроется и без него, но ходы не пойдут.{" "}
						<button type="button" className="ghost small" onClick={props.onSettings}>
							Открыть настройки
						</button>
					</Notice>
				) : null}

				<button type="button" className="primary wide" onClick={props.onNew}>
					Новая партия
				</button>

				<div className="row">
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

				<h3 className="muted">Сохранённые партии</h3>
				{props.games.length === 0 ? (
					<div className="card faint">Пусто. Начните новую партию или импортируйте файл.</div>
				) : (
					props.games.map((g) => (
						<div key={g.id} className="card">
							<div className="grow">
								<strong>{g.title}</strong>
								<div className="muted">
									ход {g.turn} · день {g.day} · пак {g.packId}
									{g.dead ? " · персонаж мёртв" : ""}
								</div>
								<div className="faint">изменено {when(g.updatedAt)}</div>
							</div>
							<div className="row">
								<button type="button" className="primary small" onClick={() => props.onContinue(g.id)}>
									Продолжить
								</button>
								<button type="button" className="ghost small" onClick={() => void props.onExport(g.id)}>
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
					))
				)}
			</div>
		</Screen>
	)
}
