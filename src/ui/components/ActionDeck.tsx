// Колода действий: во что играть, если ничего не печатать.
// Список приходит из src/narrator/index.ts и собирается из состояния,
// поэтому он всегда про эту сцену, а не про «меню игры».
import type { SuggestedAction } from "../../narrator/index.ts"

const TONE_ORDER: SuggestedAction["tone"][] = ["люди", "деньги", "тело", "мир", "риск"]

export function ActionDeck(props: {
	actions: SuggestedAction[]
	disabled?: boolean
	onPick: (text: string) => void
}) {
	const sorted = [...props.actions].sort(
		(a, b) => TONE_ORDER.indexOf(a.tone) - TONE_ORDER.indexOf(b.tone),
	)
	return (
		<div className="deck" role="group" aria-label="Что сделать">
			{sorted.map((a, i) => (
				<button
					key={a.id}
					type="button"
					className="deck-card"
					data-tone={a.tone}
					// Появление колоды идёт волной: 40 мс между картами, не больше.
					style={{ ["--i" as string]: String(i) }}
					disabled={props.disabled}
					onClick={() => props.onPick(a.text)}
				>
					<span className="deck-label">{a.label}</span>
					<span className="deck-hint">{a.hint}</span>
				</button>
			))}
		</div>
	)
}
