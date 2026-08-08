// Полоса шкалы. Только отображение: значения приходят из state, руками не меняются.

export function Bar(props: {
	name: string
	value: number
	max: number
	label?: string
	hot?: boolean
}) {
	const max = Math.max(1, props.max)
	const value = Math.max(0, Math.min(max, props.value))
	const pct = Math.round((value / max) * 100)
	return (
		<div className="bar">
			<span className="name">{props.name}</span>
			<span
				className="track"
				role="meter"
				aria-valuenow={value}
				aria-valuemin={0}
				aria-valuemax={max}
				aria-label={props.name}
			>
				<span className={props.hot ? "fill hot" : "fill"} style={{ width: `${pct}%` }} />
			</span>
			<span className="value">{props.label ?? `${value}/${max}`}</span>
		</div>
	)
}
