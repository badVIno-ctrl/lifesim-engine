// Панель команд кнопками. Список берётся из src/session.ts — чтобы UI не дублировал ядро.
// Локальные команды перехватываются в Session и НЕ уходят в модель; эпилог — единственное исключение.
import { LOCAL_COMMANDS, MODEL_COMMANDS } from "../../session.ts"

export function CommandBar(props: {
	onCommand: (text: string) => void
	disabled?: boolean
	undoDepth: number
}) {
	return (
		<div className="commands">
			{LOCAL_COMMANDS.map((c) => {
				const isUndo = c.id === "undo"
				const off = props.disabled || (isUndo && props.undoDepth === 0)
				return (
					<button
						key={c.id}
						type="button"
						className="ghost small"
						disabled={off}
						onClick={() => props.onCommand(c.text)}
						title={isUndo ? `в стеке отката: ${props.undoDepth}` : c.text}
					>
						{c.label}
						{isUndo && props.undoDepth > 0 ? ` · ${props.undoDepth}` : ""}
					</button>
				)
			})}
			{MODEL_COMMANDS.map((c) => (
				<button
					key={c.id}
					type="button"
					className="ghost small"
					disabled={props.disabled}
					onClick={() => props.onCommand(c.text)}
					title="уходит в модель"
				>
					{c.label}
				</button>
			))}
		</div>
	)
}
