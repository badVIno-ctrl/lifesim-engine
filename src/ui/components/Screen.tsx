// Общая рамка экрана: шапка + прокручиваемое тело. Mobile-first.
import type { ReactNode } from "react"

export function Screen(props: {
	title: string
	subtitle?: string
	onBack?: () => void
	action?: ReactNode
	children: ReactNode
	footer?: ReactNode
}) {
	return (
		<div className="app">
			<header className="topbar">
				{props.onBack ? (
					<button type="button" className="ghost small" onClick={props.onBack} aria-label="Назад">
						←
					</button>
				) : null}
				<div className="grow">
					<h1>{props.title}</h1>
					{props.subtitle ? <div className="sub">{props.subtitle}</div> : null}
				</div>
				{props.action}
			</header>
			<main className="scroll">{props.children}</main>
			{props.footer}
		</div>
	)
}

export function Notice(props: { kind?: "bad" | "good"; children: ReactNode }) {
	const cls = props.kind ? `notice ${props.kind}` : "notice"
	return <div className={cls}>{props.children}</div>
}
