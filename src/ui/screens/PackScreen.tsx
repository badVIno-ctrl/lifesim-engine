// Экран выбора контент-пака (I).
// Список собирается из packs/*.json на этапе сборки: добавление пака — это файл, а не правка кода.
import { useMemo, useState } from "react"
import { Notice, Screen } from "../components/Screen.tsx"
import { packs } from "../assets.ts"

export function PackScreen(props: { onBack: () => void; onPick: (packId: string) => void }) {
	const list = useMemo(() => {
		try {
			return { items: packs(), error: null as string | null }
		} catch (e) {
			return { items: [], error: e instanceof Error ? e.message : String(e) }
		}
	}, [])
	const [picked, setPicked] = useState<string | null>(list.items[0]?.id ?? null)

	return (
		<Screen title="Новая партия" subtitle="выберите мир" onBack={props.onBack}>
			<div className="stack">
				{list.error ? <Notice kind="bad">{list.error}</Notice> : null}
				{!list.error && list.items.length === 0 ? (
					<Notice kind="bad">В папке packs/ нет ни одного файла.</Notice>
				) : null}

				{list.items.map((p) => (
					<button
						key={p.id}
						type="button"
						className={picked === p.id ? "tile selected" : "tile"}
						onClick={() => setPicked(p.id)}
					>
						<strong>{p.setting}</strong>
						<div className="muted">{p.character}</div>
						<div className="faint">{p.description}</div>
						<div className="faint">
							фронтов {p.counts.fronts} · людей {p.counts.npcs} · крючков {p.counts.hooks} · неустановленного{" "}
							{p.counts.unknowns}
						</div>
					</button>
				))}

				<button
					type="button"
					className="primary wide"
					disabled={!picked}
					onClick={() => picked && props.onPick(picked)}
				>
					Дальше — инициация
				</button>
			</div>
		</Screen>
	)
}
