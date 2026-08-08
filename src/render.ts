// Рендеры состояния. Всё, что видит модель и человек, собирается здесь из state.
// Модель никогда не пишет снапшот и микро-лог руками — это делает код (H).
import { LADDERS, bar, clockLabel, phaseOf } from "./ladders.ts"
import { audit, calendarPressure } from "./engine.ts"
import type { Directive, EngineFact, State } from "./types.ts"

function line(label: string, value: string): string {
	return `${label}: ${value}`
}

function moneyLine(s: State): string {
	return `${s.money} ${s.meta.currency}`
}

function inventoryLine(s: State): string {
	if (!s.inventory.length) return "пусто"
	return s.inventory
		.map((i) => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ""}${i.wear ? ` (${LADDERS.object[i.wear]})` : ""}`)
		.join(", ")
}

function skillsLine(s: State): string {
	if (!s.skills.length) return "нет"
	return s.skills.map((k) => `${k.name} — ${LADDERS.skill[k.rank]}`).join(", ")
}

function obligationsLine(s: State): string {
	if (!s.obligations.length) return "нет"
	return s.obligations
		.map((o) => {
			const amount = typeof o.amount === "number" ? ` — ${o.amount} ${s.meta.currency}` : ""
			const due = typeof o.dueDay === "number" ? ` — срок: день ${o.dueDay}` : ""
			return `${o.what}${amount}${due}`
		})
		.join("; ")
}

function npcLine(s: State, spoilers: boolean): string {
	if (!s.npcs.length) return "нет"
	return s.npcs
		.map((n) => {
			const promises = n.promises.length ? ` [обещано: ${n.promises.join(", ")}]` : ""
			const hidden =
				spoilers && n.hidden
					? ` {хочет: ${n.hidden.wants ?? "—"}; боится: ${n.hidden.fears ?? "—"}; рычаг: ${n.hidden.lever ?? "—"}}`
					: ""
			const why = n.lastReason ? ` (почему: ${n.lastReason})` : ""
			return `${n.name} — ${LADDERS.attitude[n.attitude]}${why}${promises}${hidden}`
		})
		.join("; ")
}

function woundsLine(s: State): string {
	if (!s.condition.wounds.length) return "нет"
	return s.condition.wounds.map((w) => `${w.zone} — ${LADDERS.wound[w.rank]}`).join(", ")
}

/**
 * Полный снапшот для человека и для сжатия истории (H).
 * spoilers=true показывает скрытый слой мира: фронты, крючки, агенды.
 */
export function renderSnapshot(s: State, opts: { spoilers?: boolean } = {}): string {
	const spoilers = opts.spoilers !== false
	const c = s.condition
	const out: string[] = []
	out.push(`═══ СНАПШОТ №${s.snapshotSeq} ═══`)
	out.push(line("Ход", `${s.clock.turn} — день ${s.clock.day}, ${clockLabel(s.clock.minuteOfDay)}, ${phaseOf(s.clock.minuteOfDay)}`))
	out.push(line("Место", `${s.scene.location}${s.scene.light ? `, ${s.scene.light}` : ""}`))
	out.push(line("Положение", `${s.scene.posture}${s.scene.participants.length ? `; рядом: ${s.scene.participants.join(", ")}` : ""}`))
	out.push("")
	out.push(line("Состояние", LADDERS.health[c.health]))
	out.push(line("Раны", woundsLine(s)))
	out.push(line("Кровопотеря", LADDERS.bleed[c.bleed]))
	out.push(line("Усталость", LADDERS.fatigue[c.fatigue]))
	out.push(line("Голод", LADDERS.hunger[c.hunger]))
	out.push(line("Жажда", LADDERS.thirst[c.thirst]))
	out.push(line("Стресс", `${LADDERS.stress[c.stress.level]} [${bar(c.stress.segments)}]`))
	if (s.effects.length) out.push(line("Эффекты", s.effects.map((e) => e.name).join(", ")))
	out.push("")
	out.push(line("Касса", moneyLine(s)))
	out.push(line("Имущество", inventoryLine(s)))
	out.push(line("Навыки", skillsLine(s)))
	out.push(line("Обязательства", obligationsLine(s)))
	if (s.capital.length) out.push(line("Капитал", s.capital.join(", ")))
	out.push(line("Люди", npcLine(s, spoilers)))
	out.push("")
	out.push(line("Цели", s.goals.length ? s.goals.join("; ") : "нет"))
	out.push(line("Неустановленное", s.unknowns.length ? s.unknowns.map((u) => `— ${u}`).join(" ") : "пусто"))
	out.push(line("Вехи", `${s.milestones}/5`))
	if (s.revelations.length) {
		out.push(line("Переломы", s.revelations.map((r) => `ход ${r.turn}: ${r.what}`).join("; ")))
	}
	if (s.precedents.length) out.push(line("Прецеденты", s.precedents.join("; ")))
	if (spoilers) {
		out.push("")
		out.push("─── скрытый слой ───")
		out.push(
			line(
				"Фронты",
				s.fronts.length
					? s.fronts
							.map(
								(f) =>
									`${f.name} [${bar(f.progress)}] → ${f.nextAction} (условие: ${f.advanceCondition}${typeof f.advanceOnDay === "number" ? `, дата: день ${f.advanceOnDay}` : ""})`,
							)
							.join("; ")
					: "нет",
			),
		)
		out.push(
			line(
				"Крючки",
				s.hooks.length
					? s.hooks
							.map((h) => `${h.text}${h.sleeping ? " (спит)" : ` (окно до хода ${h.sownTurn + h.window})`}`)
							.join("; ")
					: "нет",
			),
		)
		out.push(
			line(
				"Отложенные последствия",
				s.consequences.length
					? s.consequences
							.map((x) => `${x.what} ← ${x.cause} (созреет к ходу ${x.addedTurn + x.window})`)
							.join("; ")
					: "нет",
			),
		)
	}
	const issues = audit(s)
	out.push("")
	out.push(line("Сверка", issues.length ? issues.join("; ") : "чисто"))
	return out.join("\n")
}

/**
 * H. Компактный рендер актуального состояния — это всё, что модель знает о числах.
 * Никакой истории, никаких инструкций — только факты.
 */
export function renderStateForModel(s: State): string {
	const c = s.condition
	const out: string[] = []
	out.push(`СОСТОЯНИЕ (истина, ход ${s.clock.turn})`)
	out.push(`Персонаж: ${s.meta.character}`)
	out.push(`Мир: ${s.meta.setting}; уровень ${s.meta.worldLevel}; валюта — ${s.meta.currency}`)
	if (s.meta.toneOff.length) out.push(`Запрет тона: ${s.meta.toneOff.join(", ")}`)
	if (s.meta.specialRule) out.push(`Особое правило: ${s.meta.specialRule}`)
	out.push(`Время: день ${s.clock.day}, ${clockLabel(s.clock.minuteOfDay)} (${phaseOf(s.clock.minuteOfDay)})`)
	out.push(`Сцена: ${s.scene.location}; ${s.scene.posture}; ${s.scene.light || "свет не описан"}; рядом: ${s.scene.participants.join(", ") || "никого"}`)
	out.push(
		`Тело: ${LADDERS.health[c.health]}; раны — ${woundsLine(s)}; кровопотеря — ${LADDERS.bleed[c.bleed]}; усталость — ${LADDERS.fatigue[c.fatigue]}; голод — ${LADDERS.hunger[c.hunger]}; жажда — ${LADDERS.thirst[c.thirst]}; стресс — ${LADDERS.stress[c.stress.level]} [${bar(c.stress.segments)}]`,
	)
	out.push(`Константы: сила ${s.constants.str}, ловкость ${s.constants.dex}, ум ${s.constants.int}, обаяние ${s.constants.cha}, воля ${s.constants.wil}`)
	out.push(`Касса: ${moneyLine(s)}`)
	out.push(`Имущество: ${inventoryLine(s)}`)
	out.push(`Навыки: ${skillsLine(s)}`)
	out.push(`Обязательства: ${obligationsLine(s)}`)
	out.push(`Люди: ${npcLine(s, true)}`)
	out.push(`Цели: ${s.goals.join("; ") || "нет"}`)
	out.push(`Неустановленное (не давать ответов): ${s.unknowns.join("; ") || "пусто"}`)
	if (s.effects.length) out.push(`Эффекты: ${s.effects.map((e) => e.name).join(", ")}`)
	if (s.precedents.length) out.push(`Прецеденты игрока: ${s.precedents.join("; ")}`)
	if (s.revelations.length) {
		out.push(`Пережитые переломы: ${s.revelations.map((r) => r.what).join("; ")}`)
	}
	out.push(
		`Фронты: ${
			s.fronts.map((f) => `${f.name} [${f.progress}/5] → ${f.nextAction} (условие: ${f.advanceCondition})`).join("; ") || "нет"
		}`,
	)
	out.push(
		`Крючки: ${s.hooks.filter((h) => !h.sleeping).map((h) => h.text).join("; ") || "нет активных"}`,
	)
	out.push(
		`Отложенные последствия: ${s.consequences.map((x) => `${x.what} ← ${x.cause}`).join("; ") || "нет"}`,
	)
	out.push(`Якоря цен: ${renderPrices(s)}`)
	return out.join("\n")
}

/** Старое имя той же функции — сохранено для совместимости с ядром V13. */
export function renderContext(s: State): string {
	return renderStateForModel(s)
}

export function renderPrices(s: State): string {
	const m = s.economy.regionMultiplier || 1
	const entries = Object.entries(s.economy.anchors)
	if (!entries.length) return "не заданы"
	return entries.map(([k, v]) => `${k} — ${Math.round(v * m)} ${s.meta.currency}`).join("; ")
}

/**
 * A + D. Блок движка: сначала факты прошлого хода, потом календарные директивы.
 * Это единственный способ, которым движок говорит модели, что произошло помимо её воли.
 */
export function renderEngineBlock(facts: EngineFact[], directives: Directive[]): string {
	const out: string[] = []
	for (const f of facts) {
		if (!f.forModel) continue
		out.push(`[движок: ${f.text}]`)
	}
	if (directives.length) {
		const list = directives.map((d, i) => `${i + 1}) ${d.text}`).join("; ")
		out.push(`[движок: обязательно отработать в этом ходу — ${list}]`)
	}
	if (!out.length) return ""
	out.push(
		"Это уже случилось. Обыграй в новой сцене, не переписывай прошлое и не повторяй прежнюю дельту.",
	)
	return out.join("\n")
}

/** Удобство для UI и CLI: блок движка прямо из состояния. */
export function renderPressure(s: State): string {
	return renderEngineBlock([], calendarPressure(s))
}

export function renderLedger(s: State, count = 15): string {
	const tail = s.ledger.slice(-count)
	if (!tail.length) return "лог пуст"
	return tail.map((l) => `ход ${l.turn}: ${l.text}`).join("\n")
}

/** Куда игрок шёл и зачем. Цели игрока важнее целей фронтов, поэтому они идут первыми. */
function threadLine(s: State): string {
	const parts: string[] = []
	for (const g of s.goals) parts.push(g)
	for (const f of s.fronts) {
		if (f.progress >= 5) continue
		parts.push(`${f.name}: ${f.goal} → сейчас ${f.nextAction}`)
	}
	if (!parts.length) return "не заявлена — выясни в сцене, чего он хочет"
	return parts.join(" | ")
}

/** Кому игрок должен: и деньгами, и словом. Обещания терялись при сжатии чаще всего. */
function debtLine(s: State): string {
	const parts: string[] = []
	for (const o of s.obligations) {
		const amount = typeof o.amount === "number" ? ` — ${o.amount} ${s.meta.currency}` : ""
		const due = typeof o.dueDay === "number" ? ` — срок: день ${o.dueDay}` : ""
		parts.push(`${o.what}${amount}${due}`)
	}
	for (const n of s.npcs) {
		for (const p of n.promises) parts.push(`обещано ${n.name}: ${p}`)
	}
	return parts.length ? parts.join("; ") : "ничего не висит"
}

/** Кто как относится и почему, с пометкой о молчании: оттуда рождаются сцены. */
function facesLine(s: State): string {
	if (!s.npcs.length) return "никого значимого пока нет"
	return s.npcs
		.map((n) => {
			const why = n.lastReason
				? ` — потому что ${n.lastReason}${typeof n.lastReasonTurn === "number" ? ` (ход ${n.lastReasonTurn})` : ""}`
				: ""
			const idle = s.clock.turn - n.lastContactTurn
			const silence = idle >= 20 ? `; молчание ${idle} ходов` : ""
			return `${n.name}: ${LADDERS.attitude[n.attitude]}${why}${silence}`
		})
		.join("\n")
}

/**
 * Память для сжатия истории (H). Снапшот держит числа, но игрок помнит не числа:
 * он помнит, куда шёл, кому должен и почему на него так смотрят. Три этих раздела
 * переживают стирание переписки вместе с хвостом хроники.
 */
export function renderDigest(s: State): string {
	const out: string[] = [renderSnapshot(s, { spoilers: true }), "", "═══ ПАМЯТЬ ═══"]
	out.push(line("Нить", threadLine(s)))
	out.push(line("Долги и обещания", debtLine(s)))
	out.push("Лица:")
	out.push(facesLine(s))
	out.push("")
	out.push("─── хроника ───")
	out.push(renderLedger(s, 15))
	return out.join("\n")
}
