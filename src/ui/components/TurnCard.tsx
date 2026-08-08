// Одна запись ленты. Игрок видит только прозу; JSON показывается только в режиме отладки (G).
import type { TranscriptEntry } from "../../storage/types.ts"

function usageLine(d: NonNullable<TranscriptEntry["debug"]>): string {
	const u = d.usage
	const tokens = u ? `${u.total} токенов (вход ${u.prompt}, выход ${u.completion})` : "токены не сообщены"
	const mode = d.mode === "json_schema" ? "structured output" : "разбор <delta>"
	return `${tokens} · ${mode} · ${d.model || "модель не указана"} · ${Math.round(d.ms)} мс · сообщений в контексте: ${d.contextMessages}${d.retried ? " · был ретрай разбора" : ""}`
}

export function TurnCard(props: { entry: TranscriptEntry; debug: boolean }) {
	const e = props.entry
	const debug = props.debug ? e.debug : undefined

	return (
		<article className={`turn-${e.kind === "prose" ? "prose" : e.kind}`}>
			{e.kind === "player" ? <span className="faint">вы:</span> : null}
			{e.text.split(/\n{2,}/).map((para, i) => (
				<p key={i}>
					{para.split("\n").map((chunk, j, all) => (
						<span key={j}>
							{chunk}
							{j < all.length - 1 ? <br /> : null}
						</span>
					))}
				</p>
			))}

			{debug ? (
				<details className="debug">
					<summary>Отладка хода {e.turn}</summary>
					<div className="muted">{usageLine(debug)}</div>

					<h5>Сырая дельта</h5>
					<pre>{debug.rawDelta ?? "дельта не пришла"}</pre>

					<h5>Применено</h5>
					{debug.applied.length ? (
						<ul>
							{debug.applied.map((a, i) => (
								<li key={i} className="app">
									{a}
								</li>
							))}
						</ul>
					) : (
						<div className="faint">ничего</div>
					)}

					<h5>Отклонено</h5>
					{debug.rejected.length ? (
						<ul>
							{debug.rejected.map((r, i) => (
								<li key={i} className="rej">
									<code>{r.code}</code> {r.text}
								</li>
							))}
						</ul>
					) : (
						<div className="faint">ничего</div>
					)}

					<h5>Было обязательно к отработке</h5>
					{debug.directives.length ? (
						<ul>
							{debug.directives.map((d, i) => (
								<li key={i}>{d}</li>
							))}
						</ul>
					) : (
						<div className="faint">календарь молчал</div>
					)}
				</details>
			) : null}
		</article>
	)
}
