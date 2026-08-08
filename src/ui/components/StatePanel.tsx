// Сворачиваемая панель состояния. Только чтение: всё рисуется из state,
// руками не редактируется и никакой логики мира здесь не дублируется.
import type { ReactNode } from "react"
import { Bar } from "./Bar.tsx"
import { LADDERS, clockLabel, phaseOf } from "../../ladders.ts"
import type { State } from "../../types.ts"

const STRESS_SEGMENTS = 5
const FRONT_STEPS = 5

function rung(ladder: readonly string[], index: number): string {
	const i = Math.max(0, Math.min(ladder.length - 1, Math.round(index)))
	return ladder[i] ?? "—"
}

function Group(props: { title: string; count?: number; children: ReactNode }) {
	return (
		<section className="group">
			<h3>
				{props.title}
				{typeof props.count === "number" ? <span className="faint"> · {props.count}</span> : null}
			</h3>
			{props.children}
		</section>
	)
}

function Kv(props: { k: string; v: ReactNode }) {
	return (
		<div className="kv">
			<span className="k">{props.k}</span>
			<span className="v">{props.v}</span>
		</div>
	)
}

function Empty(props: { children: ReactNode }) {
	return <div className="faint">{props.children}</div>
}

export function StatePanel(props: { state: State; open: boolean; onToggle: () => void }) {
	const s = props.state
	const c = s.condition
	const cur = s.meta.currency
	const day = s.clock.day

	// Сроки считает движок; здесь только подсветка того, что уже в состоянии.
	const overdue = (dueDay?: number) => typeof dueDay === "number" && dueDay < day
	const dueToday = (dueDay?: number) => typeof dueDay === "number" && dueDay === day

	return (
		<div className="panel">
			<button
				type="button"
				className="ghost wide"
				aria-expanded={props.open}
				onClick={props.onToggle}
			>
				<span className={props.open ? "caret open" : "caret"} aria-hidden="true" />
				День {day}, {clockLabel(s.clock.minuteOfDay)} · {rung(LADDERS.health, c.health)} · {s.money} {cur}
				{s.dead ? <span className="tag bad">мёртв</span> : null}
			</button>

			{!props.open ? null : (
				<div className="panel-body">
					<Group title="Время и место">
						<Kv k="Ход" v={s.clock.turn} />
						<Kv k="День" v={`${day}, ${clockLabel(s.clock.minuteOfDay)} (${phaseOf(s.clock.minuteOfDay)})`} />
						<Kv k="Место" v={s.scene.location || "—"} />
						<Kv k="Положение" v={`${s.scene.posture || "—"} · ${s.scene.light || "—"}`} />
						{s.scene.participants.length > 0 ? (
							<Kv k="Рядом" v={s.scene.participants.join(", ")} />
						) : null}
					</Group>

					<Group title="Тело">
						<Kv k="Здоровье" v={rung(LADDERS.health, c.health)} />
						<Kv k="Кровотечение" v={rung(LADDERS.bleed, c.bleed)} />
						<Kv k="Усталость" v={rung(LADDERS.fatigue, c.fatigue)} />
						<Kv k="Голод" v={rung(LADDERS.hunger, c.hunger)} />
						<Kv k="Жажда" v={rung(LADDERS.thirst, c.thirst)} />
						<Bar
							name={`Стресс: ${rung(LADDERS.stress, c.stress.level)}`}
							value={c.stress.segments}
							max={STRESS_SEGMENTS}
							label={`${c.stress.segments}/${STRESS_SEGMENTS}`}
							hot={c.stress.level >= 2}
						/>
					</Group>

					<Group title="Раны" count={c.wounds.length}>
						{c.wounds.length === 0 ? (
							<Empty>цел</Empty>
						) : (
							c.wounds.map((w) => (
								<Kv key={`${w.zone}:${w.rank}`} k={w.zone} v={rung(LADDERS.wound, w.rank)} />
							))
						)}
					</Group>

					{s.effects.length > 0 ? (
						<Group title="Состояния" count={s.effects.length}>
							{s.effects.map((e) => (
								<Kv
									key={e.name}
									k={e.name}
									v={e.expiresAtTurn === null ? "без срока" : `до хода ${e.expiresAtTurn}`}
								/>
							))}
						</Group>
					) : null}

					<Group title="Карман">
						<Kv k="Деньги" v={`${s.money} ${cur}`} />
						{s.capital.length > 0 ? <Kv k="Капитал" v={s.capital.join(", ")} /> : null}
					</Group>

					<Group title="Имущество" count={s.inventory.length}>
						{s.inventory.length === 0 ? (
							<Empty>пусто</Empty>
						) : (
							s.inventory.map((i) => (
								<Kv
									key={i.name}
									k={i.qty > 1 ? `${i.name} ×${i.qty}` : i.name}
									v={rung(LADDERS.object, i.wear)}
								/>
							))
						)}
					</Group>

					<Group title="Навыки" count={s.skills.length}>
						{s.skills.length === 0 ? (
							<Empty>ничего не умеет</Empty>
						) : (
							s.skills.map((k) => <Kv key={k.name} k={k.name} v={rung(LADDERS.skill, k.rank)} />)
						)}
					</Group>

					<Group title="Обязательства" count={s.obligations.length}>
						{s.obligations.length === 0 ? (
							<Empty>никому не должен</Empty>
						) : (
							s.obligations.map((o) => (
								<Kv
									key={o.what}
									k={o.what}
									v={
										<>
											{typeof o.amount === "number" ? `${o.amount} ${cur}` : "—"}
											{typeof o.dueDay === "number" ? (
												<span
													className={overdue(o.dueDay) ? "tag bad" : dueToday(o.dueDay) ? "tag warn" : "tag"}
												>
													{overdue(o.dueDay)
														? `просрочено, был день ${o.dueDay}`
														: dueToday(o.dueDay)
															? "сегодня"
															: `до дня ${o.dueDay}`}
												</span>
											) : null}
										</>
									}
								/>
							))
						)}
					</Group>

					<Group title="Люди" count={s.npcs.length}>
						{s.npcs.length === 0 ? (
							<Empty>никого рядом</Empty>
						) : (
							s.npcs.map((n) => (
								<Kv
									key={n.name}
									k={n.name}
									v={
										<>
											{rung(LADDERS.attitude, n.attitude)}
											{n.promises.length > 0 ? (
												<span className="tag warn">обещано: {n.promises.join("; ")}</span>
											) : null}
										</>
									}
								/>
							))
						)}
					</Group>

					<Group title="Фронты" count={s.fronts.length}>
						{s.fronts.length === 0 ? (
							<Empty>мир замер</Empty>
						) : (
							s.fronts.map((f) => (
								<div key={f.name} className="front">
									<Bar
										name={f.name}
										value={f.progress}
										max={FRONT_STEPS}
										label={`${f.progress}/${FRONT_STEPS}`}
										hot={f.progress >= 4}
									/>
									<div className="faint">
										двинется, когда: {f.advanceCondition}
										{typeof f.advanceOnDay === "number" ? (
											<span className={f.advanceOnDay <= day ? "tag bad" : "tag"}>
												день {f.advanceOnDay}
											</span>
										) : null}
									</div>
								</div>
							))
						)}
					</Group>

					<Group title="Крючки" count={s.hooks.filter((h) => !h.sleeping).length}>
						{s.hooks.length === 0 ? (
							<Empty>ничего не посеяно</Empty>
						) : (
							s.hooks.map((h) => (
								<Kv
									key={h.text}
									k={h.text}
									v={
										h.sleeping ? (
											<span className="tag">спит</span>
										) : (
											`окно до хода ${h.sownTurn + h.window}`
										)
									}
								/>
							))
						)}
					</Group>

					{/* F. Реестр неустановленного — отдельный блок, всегда на виду. */}
					<Group title="Неустановленное" count={s.unknowns.length}>
						{s.unknowns.length === 0 ? (
							<div className="tag bad">реестр пуст — сверка считает это дефектом</div>
						) : (
							<ul className="plain">
								{s.unknowns.map((u) => (
									<li key={u}>{u}</li>
								))}
							</ul>
						)}
						<div className="faint">пополнялся на ходу {s.lastUnknownAddTurn}</div>
					</Group>

					<Group title="Цели" count={s.goals.length}>
						{s.goals.length === 0 ? (
							<Empty>целей нет</Empty>
						) : (
							<ul className="plain">
								{s.goals.map((g) => (
									<li key={g}>{g}</li>
								))}
							</ul>
						)}
					</Group>

					{s.consequences.length > 0 ? (
						<Group title="Отложенные последствия" count={s.consequences.length}>
							{s.consequences.map((k) => (
								<Kv key={k.what} k={k.what} v={`созреет к ходу ${k.addedTurn + k.window}`} />
							))}
						</Group>
					) : null}

					{s.revelations.length > 0 ? (
						<Group title="Переломы" count={s.revelations.length}>
							{s.revelations.map((r) => (
								<Kv key={`${r.turn}:${r.criterion}`} k={`ход ${r.turn}`} v={r.what} />
							))}
						</Group>
					) : null}

					<Group title="Константы">
						<Kv
							k="сила / ловкость / ум / обаяние / воля"
							v={`${s.constants.str} · ${s.constants.dex} · ${s.constants.int} · ${s.constants.cha} · ${s.constants.wil}`}
						/>
						<Kv k="Жёсткость мира" v={s.meta.worldLevel} />
						<Kv k="Вехи" v={`${s.milestones}/5`} />
					</Group>
				</div>
			)}
		</div>
	)
}
