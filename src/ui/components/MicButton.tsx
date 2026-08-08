// Кнопка микрофона. Тупая по умыслу: вся логика режимов — в GameScreen и src/voice.ts.
export function MicButton(props: {
	listening: boolean
	busy: boolean
	disabled: boolean
	hint: string
	onClick: () => void
}) {
	const label = props.listening ? "Остановить запись" : "Голосовой ввод"
	return (
		<button
			type="button"
			className={props.listening ? "mic listening" : "mic"}
			disabled={props.disabled}
			aria-label={label}
			aria-pressed={props.listening}
			title={props.hint}
			onClick={props.onClick}
		>
			{props.busy ? <span className="spinner" aria-hidden="true" /> : props.listening ? "■" : "🎤"}
		</button>
	)
}
