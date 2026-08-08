// Единственная точка изменения состояния. Изоморфно: ни fs, ни path, ни process.
import { LADDERS, stepLadder, phaseOf, bar } from "./ladders.ts"
import type {
	ApplyResult,
	Consequence,
	Delta,
	Directive,
	EngineFact,
	EngineFactKind,
	Front,
	Hook,
	Obligation,
	RevelationCriterion,
	State,
} from "./types.ts"

export const LIMITS = { fronts: 3, consequences: 5, hooks: 7, npcsWithAgenda: 5 }

/** H. Раз в столько ходов движок сам делает снапшот и сжимает им переписку. */
export const SNAPSHOT_EVERY = 7
/** H. Сколько последних сообщений уходит в модель. */
export const HISTORY_TAIL = 8
/** C. Глубина стека отката. */
export const UNDO_DEPTH = 20
/** F. Сколько ходов реестр неустановленного может не пополняться до напоминания. */
export const UNKNOWNS_REMINDER_AFTER = 10
/** B. Перелом — редкое событие. Редкость стережёт код, а не текст промпта. */
export const REVELATION_COOLDOWN = 10

export const MILESTONE_CRITERIA = ["project", "fear", "price"] as const
export const REVELATION_CRITERIA = ["model_broken", "near_death", "own_failure_analyzed"] as const

const REVELATION_LABEL: Record<RevelationCriterion, string> = {
	model_broken: "мир оказался устроен иначе, чем он считал",
	near_death: "он был в шаге от смерти",
	own_failure_analyzed: "он разобрал собственный провал до причины",
}

export function clone<T>(x: T): T {
	return JSON.parse(JSON.stringify(x)) as T
}

/**
 * Подготовка чужого JSON к работе: добивка новых полей и миграция с 13.0.
 * Нужна и при импорте сохранёнки, и при загрузке контент-пака.
 */
export function normalizeState(raw: unknown): State {
	const s = clone(raw) as Record<string, any>
	if (!s || typeof s !== "object") throw new Error("состояние не является объектом")
	s.version = "13.1"
	delete s.insight // B: шкалы озарения больше нет
	s.meta = s.meta ?? {}
	s.meta.character = s.meta.character ?? "безымянный"
	s.meta.setting = s.meta.setting ?? "неизвестное место"
	s.meta.worldLevel = s.meta.worldLevel ?? "суровый"
	s.meta.toneOff = Array.isArray(s.meta.toneOff) ? s.meta.toneOff : []
	s.meta.currency = s.meta.currency ?? "монет"
	s.clock = s.clock ?? { turn: 0, day: 1, minuteOfDay: 480 }
	s.clock.turn = num(s.clock.turn, 0)
	s.clock.day = num(s.clock.day, 1)
	s.clock.minuteOfDay = ((num(s.clock.minuteOfDay, 480) % 1440) + 1440) % 1440
	s.snapshotSeq = num(s.snapshotSeq, 0)
	s.dead = Boolean(s.dead)
	s.scene = s.scene ?? { location: "неизвестно", posture: "стоишь", light: "", participants: [] }
	s.scene.participants = Array.isArray(s.scene.participants) ? s.scene.participants : []
	s.constants = s.constants ?? { str: 10, dex: 10, int: 10, cha: 10, wil: 10 }
	s.skills = Array.isArray(s.skills) ? s.skills : []
	s.condition = s.condition ?? {}
	s.condition.health = num(s.condition.health, 0)
	s.condition.wounds = Array.isArray(s.condition.wounds) ? s.condition.wounds : []
	s.condition.bleed = num(s.condition.bleed, 0)
	s.condition.fatigue = num(s.condition.fatigue, 0)
	s.condition.hunger = num(s.condition.hunger, 0)
	s.condition.thirst = num(s.condition.thirst, 0)
	s.condition.stress = s.condition.stress ?? { level: 0, segments: 0 }
	s.effects = Array.isArray(s.effects) ? s.effects : []
	s.milestones = num(s.milestones, 0)
	s.revelations = Array.isArray(s.revelations) ? s.revelations : []
	s.inventory = Array.isArray(s.inventory) ? s.inventory : []
	s.money = num(s.money, 0)
	s.obligations = Array.isArray(s.obligations) ? s.obligations : []
	s.capital = Array.isArray(s.capital) ? s.capital : []
	s.npcs = Array.isArray(s.npcs) ? s.npcs : []
	for (const n of s.npcs) {
		n.promises = Array.isArray(n.promises) ? n.promises : []
		n.attitude = num(n.attitude, 3)
		n.lastContactTurn = num(n.lastContactTurn, s.clock.turn)
	}
	s.consequences = Array.isArray(s.consequences) ? s.consequences : []
	s.fronts = Array.isArray(s.fronts) ? s.fronts : []
	for (const f of s.fronts) {
		f.progress = num(f.progress, 0)
		if (f.advanceOnDay === undefined) f.advanceOnDay = null
	}
	s.hooks = Array.isArray(s.hooks) ? s.hooks : []
	for (const h of s.hooks) {
		h.sownTurn = num(h.sownTurn, s.clock.turn)
		h.window = num(h.window, 10)
	}
	s.unknowns = Array.isArray(s.unknowns) ? s.unknowns : []
	s.lastUnknownAddTurn = num(s.lastUnknownAddTurn, s.clock.turn)
	s.precedents = Array.isArray(s.precedents) ? s.precedents : []
	s.goals = Array.isArray(s.goals) ? s.goals : []
	s.channelHistory = Array.isArray(s.channelHistory) ? s.channelHistory : []
	s.ledger = Array.isArray(s.ledger) ? s.ledger : []
	s.economy = s.economy ?? { anchors: {}, regionMultiplier: 1 }
	s.economy.anchors = s.economy.anchors ?? {}
	s.economy.regionMultiplier = num(s.economy.regionMultiplier, 1)
	return s as State
}

function num(x: unknown, fallback: number): number {
	return typeof x === "number" && Number.isFinite(x) ? x : fallback
}

/**
 * D + F. Давление мира считается из календаря, а не из доброты рассказчика.
 * Функция чистая: одно и то же состояние всегда даёт одни и те же директивы.
 */
export function calendarPressure(s: State): Directive[] {
	const out: Directive[] = []
	if (s.dead) return out

	for (const o of s.obligations) {
		if (typeof o.dueDay !== "number") continue
		const sum = typeof o.amount === "number" ? `, сумма ${o.amount} ${s.meta.currency}` : ""
		if (s.clock.day > o.dueDay) {
			out.push({
				code: "obligation_overdue",
				text: `срок обязательства «${o.what}» просрочен (был день ${o.dueDay}, сейчас день ${s.clock.day})${sum} — тот, кому должны, действует`,
			})
		} else if (s.clock.day === o.dueDay) {
			out.push({
				code: "obligation_due",
				text: `сегодня, день ${s.clock.day}, истекает срок обязательства «${o.what}»${sum}`,
			})
		}
	}

	for (const c of s.consequences) {
		if (s.clock.turn - c.addedTurn >= c.window) {
			out.push({
				code: "consequence_due",
				text: `созрело отложенное последствие «${c.what}» (причина: ${c.cause}) — оно наступает в этом ходу; закрой его через consequences.fire`,
			})
		}
	}

	for (const h of s.hooks) {
		if (h.expiredTurn === s.clock.turn) {
			out.push({
				code: "hook_expired",
				text: `окно крючка «${h.text}» истекло — он ушёл в фон без ответа; мир продолжается без него`,
			})
		}
	}

	for (const f of s.fronts) {
		if (typeof f.advanceOnDay === "number" && s.clock.day >= f.advanceOnDay && f.progress < 5) {
			out.push({
				code: "front_date_due",
				text: `у фронта «${f.name}» наступила календарная дата продвижения (день ${f.advanceOnDay}) — мир делает шаг: ${f.nextAction}`,
			})
		}
		// Ровно 4: на 5 фронт уже разрешён, и напоминание превращалось в вечный шум.
		if (f.progress === 4) {
			out.push({
				code: "front_ready",
				text: `фронт «${f.name}» на пороге развязки — следующее действие мира: ${f.nextAction}`,
			})
		}
	}

	const idle = s.clock.turn - s.lastUnknownAddTurn
	if (idle >= UNKNOWNS_REMINDER_AFTER) {
		out.push({
			code: "unknowns_stale",
			text: `реестр неустановленного не пополнялся ${idle} ходов — введи в сцену хотя бы один новый открытый вопрос через unknowns.add и не выдавай ответов на нерешённые`,
		})
	}

	return out
}

/**
 * Единственная точка изменения состояния. Детерминирована, чиста, тестируема.
 * Модель предлагает изменения — движок решает, какие допустимы.
 */
export function applyDelta(prev: State, delta: Delta): ApplyResult {
	const s = clone(prev)
	const facts: EngineFact[] = []
	const parts: string[] = []

	const fact = (kind: EngineFactKind, code: string, text: string, forModel: boolean): void => {
		facts.push({ kind, code, text, forModel })
	}
	// A. Отклонение — факт мира: уходит модели следующим системным сообщением.
	const reject = (code: string, text: string): void => fact("rejection", code, text, true)
	const limit = (code: string, text: string): void => fact("limit", code, text, true)
	// Урезание по лестнице модели повторять не нужно: она видит итог в рендере состояния.
	const clamp = (code: string, text: string): void => fact("clamp", code, text, false)

	if (s.dead) {
		reject("dead", "персонаж мёртв: дельта отклонена, нужна новая инициация")
		return {
			state: s,
			facts,
			warnings: facts.map((f) => f.text),
			applied: [],
			microLog: "",
			due: { consequences: [], hooksExpiring: [], frontsReady: [], obligations: [] },
		}
	}

	// --- время ---
	s.clock.turn += 1
	const mins = delta.time?.minutes ?? (delta.time?.days ? delta.time.days * 1440 : 0)
	// Время — главный ресурс игры. Если модель его не тратит, она должна узнать об этом громко:
	// тихое clamp позволяло ей бесконечно держать сцену в одной минуте.
	if (!delta.time)
		limit(
			"no_time",
			"дельта пришла без time: время не сдвинуто. Любое действие что-то стоит — в следующей дельте укажи time.minutes.",
		)
	const total = s.clock.minuteOfDay + mins
	s.clock.day += Math.floor(total / 1440)
	s.clock.minuteOfDay = ((total % 1440) + 1440) % 1440
	parts.push(`ход ${s.clock.turn}`)
	parts.push(
		`день ${s.clock.day}, ${phaseOf(s.clock.minuteOfDay)}${mins ? ` +${humanMinutes(mins)}` : ""}`,
	)

	// --- сцена ---
	if (delta.scene) Object.assign(s.scene, delta.scene)

	// --- канал и ротация ---
	if (delta.channel) {
		s.channelHistory.push(delta.channel)
		s.channelHistory = s.channelHistory.slice(-5)
		const last3 = s.channelHistory.slice(-3)
		if (last3.length === 3 && last3.every((c) => c === last3[0])) {
			limit("channel_rotation", `ротация каналов: три хода подряд канал «${last3[0]}»`)
		}
	} else {
		clamp("no_channel", "дельта без channel")
	}

	// --- стресс ---
	if (delta.stress?.segments) {
		const before = `${LADDERS.stress[s.condition.stress.level]}`
		applyStress(s, delta.stress.segments, clamp)
		const st = s.condition.stress
		parts.push(
			`стресс: ${LADDERS.stress[st.level]} [${bar(st.segments)}] ${delta.stress.segments > 0 ? "▲" : "▼"}`,
		)
		if (before !== LADDERS.stress[st.level]) parts.push(`стресс: уровень → ${LADDERS.stress[st.level]}`)
	}

	// --- тело ---
	if (delta.fatigue?.step) {
		const r = stepLadder("fatigue", s.condition.fatigue, delta.fatigue.step, "усталость")
		s.condition.fatigue = r.value
		if (r.warning) clamp("one_step", r.warning)
		parts.push(`усталость: ${LADDERS.fatigue[s.condition.fatigue]}`)
	}
	if (delta.hunger?.step) {
		const r = stepLadder("hunger", s.condition.hunger, delta.hunger.step, "голод")
		s.condition.hunger = r.value
		if (r.warning) clamp("one_step", r.warning)
		parts.push(`голод: ${LADDERS.hunger[s.condition.hunger]}`)
	}
	if (delta.thirst?.step) {
		const r = stepLadder("thirst", s.condition.thirst, delta.thirst.step, "жажда")
		s.condition.thirst = r.value
		if (r.warning) clamp("one_step", r.warning)
		parts.push(`жажда: ${LADDERS.thirst[s.condition.thirst]}`)
	}
	if (delta.health?.step) {
		const r = stepLadder("health", s.condition.health, delta.health.step, "самочувствие")
		s.condition.health = r.value
		if (r.warning) clamp("one_step", r.warning)
		if (delta.health.step < 0 && !delta.health.cause) clamp("no_cause", "ухудшение самочувствия без cause")
		parts.push(`самочувствие: ${LADDERS.health[s.condition.health]}`)
	}
	for (const wd of delta.wounds ?? []) {
		const found = s.condition.wounds.find((x) => x.zone === wd.zone)
		const cur = found?.rank ?? 0
		const r = stepLadder("wound", cur, wd.step, `рана (${wd.zone})`)
		if (r.warning) clamp("one_step", r.warning)
		if (found) found.rank = r.value
		else if (r.value > 0) s.condition.wounds.push({ zone: wd.zone, rank: r.value })
		s.condition.wounds = s.condition.wounds.filter((x) => x.rank > 0)
		parts.push(`рана ${wd.zone}: ${LADDERS.wound[r.value]}`)
	}
	if (delta.bleed?.step) {
		const r = stepLadder("bleed", s.condition.bleed, delta.bleed.step, "кровопотеря")
		s.condition.bleed = r.value
		if (r.warning) clamp("one_step", r.warning)
		parts.push(`кровопотеря: ${LADDERS.bleed[s.condition.bleed]}`)
	}

	// --- деньги: арифметика всегда в коде ---
	if (delta.money?.delta) {
		const before = s.money
		const after = before + delta.money.delta
		if (after < 0) {
			reject(
				"money_insufficient",
				`денег не хватило — у персонажа ${before} ${s.meta.currency}, требовалось ${Math.abs(delta.money.delta)}`,
			)
		} else {
			s.money = after
			parts.push(`касса: ${before} ${sign(delta.money.delta)} = ${after}`)
		}
	}

	// --- инвентарь ---
	for (const it of delta.inventory?.add ?? []) {
		const ex = s.inventory.find((x) => x.name === it.name)
		if (ex) ex.qty += it.qty ?? 1
		else s.inventory.push({ name: it.name, qty: it.qty ?? 1, wear: 0 })
		parts.push(`+${it.name}`)
	}
	for (const it of delta.inventory?.remove ?? []) {
		const ex = s.inventory.find((x) => x.name === it.name)
		if (!ex) {
			reject(
				"item_missing",
				`отсутствующий предмет: «${it.name}» не числится в имуществе — списание отклонено`,
			)
			continue
		}
		ex.qty -= it.qty ?? 1
		parts.push(`−${it.name}`)
		if (ex.qty <= 0) s.inventory = s.inventory.filter((x) => x !== ex)
	}
	for (const it of delta.inventory?.wear ?? []) {
		const ex = s.inventory.find((x) => x.name === it.name)
		if (!ex) {
			reject("item_missing_wear", `износ несуществующего предмета: ${it.name}`)
			continue
		}
		const r = stepLadder("object", ex.wear, it.step, `износ (${it.name})`)
		ex.wear = r.value
		if (r.warning) clamp("one_step", r.warning)
		parts.push(`${it.name}: ${LADDERS.object[ex.wear]}`)
	}

	// --- NPC ---
	for (const n of delta.npc ?? []) {
		let npc = s.npcs.find((x) => x.name === n.name)
		if (!npc) {
			npc = { name: n.name, attitude: 3, lastContactTurn: s.clock.turn, promises: [] }
			s.npcs.push(npc)
		}
		npc.lastContactTurn = s.clock.turn
		if (n.reason) {
			npc.lastReason = n.reason
			npc.lastReasonTurn = s.clock.turn
		}
		if (n.attitudeStep) {
			const r = stepLadder("attitude", npc.attitude, n.attitudeStep, `отношение (${n.name})`)
			npc.attitude = r.value
			if (r.warning) clamp("one_step", r.warning)
			if (!n.reason) clamp("no_reason", `изменение отношения ${n.name} без reason`)
			parts.push(`${n.name}: ${LADDERS.attitude[npc.attitude]}`)
		}
		if (n.promise) npc.promises.push(n.promise)
		if (n.promiseKept) npc.promises = npc.promises.filter((p) => p !== n.promiseKept)
	}
	// дрейф отношений к нейтралитету: не быстрее ступени за 3 игровых дня без контакта
	for (const npc of s.npcs) {
		const idleTurns = s.clock.turn - npc.lastContactTurn
		if (idleTurns >= 60 && npc.attitude !== 3) {
			npc.attitude += npc.attitude > 3 ? -1 : 1
			npc.lastContactTurn = s.clock.turn
			fact(
				"event",
				"attitude_drift",
				`дрейф отношения: ${npc.name} → ${LADDERS.attitude[npc.attitude]} (долго без контакта)`,
				true,
			)
		}
	}

	// --- навыки ---
	for (const sk of delta.skills ?? []) {
		const ex = s.skills.find((x) => x.name === sk.name)
		const cur = ex?.rank ?? 0
		if (sk.step > 0 && !sk.justification) {
			reject(
				"skill_no_justification",
				`рост навыка ${sk.name} отклонён: нет justification (три применения в риске + разбор провала)`,
			)
			continue
		}
		const r = stepLadder("skill", cur, sk.step, `навык (${sk.name})`)
		if (r.warning) clamp("one_step", r.warning)
		if (ex) ex.rank = r.value
		else s.skills.push({ name: sk.name, rank: r.value })
		parts.push(`навык ${sk.name}: ${LADDERS.skill[r.value]}`)
		if (s.skills.length > 10) limit("skills_overflow", "больше 10 навыков: объедини близкие")
	}

	// --- вехи ---
	if (delta.milestone?.granted) {
		const crit = delta.milestone.criterion ?? ""
		if (!(MILESTONE_CRITERIA as readonly string[]).includes(crit)) {
			reject("milestone_criterion", `веха отклонена: критерий «${crit}» не из списка`)
		} else {
			s.milestones += 1
			parts.push(`веха (${crit}): ${s.milestones}/5`)
			if (s.milestones >= 5) {
				s.milestones = 0
				fact("event", "milestone_five", "5 вех: игрок выбирает константу +1", true)
			}
		}
	}

	// --- B. перелом вместо шкалы озарения ---
	if (delta.revelation) {
		const crit = delta.revelation.criterion
		const what = (delta.revelation.what ?? "").trim()
		const last = s.revelations[s.revelations.length - 1]
		if (!(REVELATION_CRITERIA as readonly string[]).includes(crit)) {
			reject("revelation_criterion", `перелом отклонён: критерий «${crit}» не из списка`)
		} else if (!what) {
			reject("revelation_empty", "перелом отклонён: не сказано, что именно пережито (поле what)")
		} else if (last && s.clock.turn - last.turn < REVELATION_COOLDOWN) {
			reject(
				"revelation_cooldown",
				`перелом отклонён: прошлый был на ходу ${last.turn}, такое случается не чаще раза в ${REVELATION_COOLDOWN} ходов`,
			)
		} else {
			const criterion = crit as RevelationCriterion
			s.revelations.push({ turn: s.clock.turn, criterion, what })
			s.ledger.push({ turn: s.clock.turn, text: `перелом (${criterion}): ${what}` })
			parts.push(`перелом: ${criterion}`)
			fact(
				"event",
				"revelation",
				`персонаж пережил перелом — ${REVELATION_LABEL[criterion]}: ${what}. Это меняет его взгляд и речь, но не даёт никаких чисел и никаких новых умений`,
				true,
			)
		}
	}

	// --- эффекты и таймеры ---
	for (const e of delta.effects?.add ?? []) {
		s.effects.push({
			name: e.name,
			expiresAtTurn: e.expiresInTurns ? s.clock.turn + e.expiresInTurns : null,
		})
		parts.push(`эффект: ${e.name}`)
	}
	for (const name of delta.effects?.remove ?? []) s.effects = s.effects.filter((e) => e.name !== name)
	const expired = s.effects.filter((e) => e.expiresAtTurn !== null && e.expiresAtTurn <= s.clock.turn)
	if (expired.length) {
		s.effects = s.effects.filter((e) => !expired.includes(e))
		fact("event", "effects_expired", `истекли эффекты: ${expired.map((e) => e.name).join(", ")}`, true)
	}

	// --- крючки ---
	for (const h of delta.hooks?.add ?? []) {
		s.hooks.push({ text: h.text, sownTurn: s.clock.turn, window: h.window ?? 10 })
		if (s.hooks.filter((x) => !x.sleeping).length > LIMITS.hooks) {
			limit("hooks_overflow", `лимит крючков (${LIMITS.hooks}) превышен: заверши или усыпи старые`)
		}
	}
	for (const t of delta.hooks?.resolve ?? []) s.hooks = s.hooks.filter((h) => h.text !== t)
	for (const t of delta.hooks?.sleep ?? []) {
		const h = s.hooks.find((x) => x.text === t)
		if (h) h.sleeping = true
	}
	const hooksExpiring = s.hooks.filter((h) => !h.sleeping && s.clock.turn - h.sownTurn >= h.window)
	for (const h of hooksExpiring) {
		h.sleeping = true // истлевает, а не выплачивается насильно
		h.expiredTurn = s.clock.turn
	}

	// --- отложенные последствия ---
	for (const c of delta.consequences?.add ?? []) {
		s.consequences.push({
			what: c.what,
			cause: c.cause,
			window: c.window ?? 5,
			addedTurn: s.clock.turn,
		})
		if (s.consequences.length > LIMITS.consequences) {
			limit("consequences_overflow", `лимит отложенных последствий (${LIMITS.consequences}) превышен`)
		}
	}
	for (const t of delta.consequences?.fire ?? []) {
		const hit = s.consequences.some((c) => c.what === t)
		if (!hit) reject("consequence_missing", `последствия «${t}» нет в списке — закрывать нечего`)
		else {
			s.consequences = s.consequences.filter((c) => c.what !== t)
			parts.push(`последствие отработано: ${t}`)
		}
	}
	const dueConsequences = s.consequences.filter((c) => s.clock.turn - c.addedTurn >= c.window)

	// --- фронты (E) ---
	for (const f of delta.fronts ?? []) {
		const front = s.fronts.find((x) => x.name === f.name)
		if (!front) {
			reject("front_unknown", `неизвестный фронт: ${f.name}`)
			continue
		}
		// Дату движок проверяет сам — подтверждение модели тут не нужно.
		const dateMet = typeof front.advanceOnDay === "number" && s.clock.day >= front.advanceOnDay
		if (f.progressStep > 0 && !dateMet) {
			if (!f.advanceConditionMet) {
				reject(
					"front_condition",
					`фронт «${f.name}» не сдвинут: условие продвижения не подтверждено (${front.advanceCondition})`,
				)
				continue
			}
			if (!f.justification || !f.justification.trim()) {
				reject(
					"front_justification",
					`фронт «${f.name}» не сдвинут: условие продвижения заявлено без justification — что именно случилось`,
				)
				continue
			}
		}
		if (!f.progressStep) continue
		front.progress = Math.max(0, Math.min(5, front.progress + Math.sign(f.progressStep)))
		parts.push(`фронт ${front.name}: [${bar(front.progress)}]`)
	}
	const frontsReady = s.fronts.filter((f) => f.progress >= 4)

	// --- обязательства (D) ---
	for (const o of delta.obligations?.add ?? []) {
		const rec: Obligation = { what: o.what }
		if (typeof o.amount === "number") rec.amount = o.amount
		if (typeof o.dueDay === "number") rec.dueDay = o.dueDay
		s.obligations.push(rec)
		parts.push(`обязательство: ${o.what}${rec.dueDay ? ` — до дня ${rec.dueDay}` : ""}`)
	}
	for (const t of delta.obligations?.settle ?? []) {
		const hit = s.obligations.some((o) => o.what === t)
		if (!hit) reject("obligation_missing", `обязательства «${t}» нет в списке — закрывать нечего`)
		else {
			s.obligations = s.obligations.filter((o) => o.what !== t)
			parts.push(`обязательство закрыто: ${t}`)
		}
	}
	const dueObligations = s.obligations.filter(
		(o) => typeof o.dueDay === "number" && s.clock.day >= o.dueDay,
	)

	// --- реестр неустановленного (F) ---
	let unknownAdded = false
	for (const u of delta.unknowns?.add ?? []) {
		if (!u || !u.trim()) continue
		if (!s.unknowns.includes(u)) {
			s.unknowns.push(u)
			unknownAdded = true
			parts.push(`неустановлено +: ${u}`)
		}
	}
	if (unknownAdded) s.lastUnknownAddTurn = s.clock.turn
	for (const u of delta.unknowns?.resolve ?? []) {
		if (!s.unknowns.includes(u)) {
			reject("unknown_missing", `в реестре нет пункта «${u}» — закрывать нечего`)
			continue
		}
		s.unknowns = s.unknowns.filter((x) => x !== u)
		parts.push(`неустановлено −: ${u}`)
	}

	// --- прочее ---
	for (const g of delta.goals?.add ?? []) if (!s.goals.includes(g)) s.goals.push(g)
	for (const g of delta.goals?.done ?? []) s.goals = s.goals.filter((x) => x !== g)
	if (delta.precedent) s.precedents.push(delta.precedent)
	if (delta.trace) {
		s.ledger.push({ turn: s.clock.turn, text: `след: ${delta.trace}` })
		parts.push(`след: ${delta.trace}`)
	}

	// --- терминальное состояние — только при установленной причине ---
	if (delta.terminal) {
		const lethalCause =
			s.condition.bleed >= 3 ||
			s.condition.health >= 3 ||
			s.condition.wounds.some((x) => x.rank >= 3) ||
			s.condition.thirst >= 3
		if (!lethalCause) {
			reject(
				"terminal_no_cause",
				"терминал отклонён: в состоянии нет установленной смертельной причины (разрушительная рана / смертельная кровопотеря / критическое состояние)",
			)
		} else {
			s.dead = true
			parts.push(`терминал: ${delta.terminal.kind} — ${delta.terminal.cause}`)
		}
	}

	if (delta.channel) parts.push(`канал: ${delta.channel}`)
	const microLog = `[${parts.join(" | ")}]`
	s.ledger.push({ turn: s.clock.turn, text: microLog })
	const rejected = facts.filter((f) => f.kind === "rejection" || f.kind === "limit")
	if (rejected.length) {
		s.ledger.push({ turn: s.clock.turn, text: `⚠ ${rejected.map((f) => f.text).join("; ")}` })
	}
	s.ledger = s.ledger.slice(-200)

	return {
		state: s,
		facts,
		warnings: facts.map((f) => f.text),
		applied: parts,
		microLog,
		due: {
			consequences: dueConsequences,
			hooksExpiring,
			frontsReady,
			obligations: dueObligations,
		},
	}
}

function applyStress(s: State, segments: number, clamp: (code: string, text: string) => void): void {
	const st = s.condition.stress
	const seg = Math.max(-3, Math.min(3, Math.round(segments)))
	if (Math.abs(segments) > 3) clamp("stress_cap", `стресс: запрошено ${segments} сегментов, урезано до ${seg}`)
	const startLevel = st.level
	st.segments += seg
	while (st.segments >= 5) {
		st.segments -= 5
		st.level = Math.min(LADDERS.stress.length - 1, st.level + 1)
	}
	while (st.segments < 0) {
		if (st.level === 0) {
			st.segments = 0
			break
		}
		st.level -= 1
		st.segments += 5
	}
	if (st.level - startLevel > 1) {
		st.level = startLevel + 1
		st.segments = 0
		clamp("stress_level_cap", "обычная сцена не повышает стресс больше чем на ступень: урезано")
	}
}

function sign(n: number): string {
	return n < 0 ? `− ${Math.abs(n)}` : `+ ${n}`
}

function humanMinutes(m: number): string {
	if (m < 60) return `${m} мин`
	if (m < 1440) return `${Math.round((m / 60) * 10) / 10} ч`
	return `${Math.round((m / 1440) * 10) / 10} д`
}

/** Сверка целостности — вызывается при каждом снапшоте и при импорте. */
export function audit(s: State): string[] {
	const issues: string[] = []
	if (s.money < 0) issues.push("отрицательная касса")
	if (s.fronts.length > LIMITS.fronts) issues.push(`фронтов ${s.fronts.length} > ${LIMITS.fronts}`)
	if (s.consequences.length > LIMITS.consequences) issues.push("перебор отложенных последствий")
	if (s.hooks.filter((h) => !h.sleeping).length > LIMITS.hooks) issues.push("перебор активных крючков")
	if (s.npcs.filter((n) => n.hidden).length > LIMITS.npcsWithAgenda) issues.push("перебор NPC с агендой")
	if (s.skills.length > 10) issues.push("больше 10 навыков")
	for (const c of Object.values(s.constants)) {
		if (c < 5 || c > 20) issues.push("константа вне диапазона 5–20")
	}
	if (s.condition.stress.segments > 4 || s.condition.stress.segments < 0)
		issues.push("сегменты стресса вне 0–4")
	// F: пустой реестр неустановленного — это дефект мира, а не норма.
	if (s.unknowns.length === 0) issues.push("реестр неустановленного пуст")
	return issues
}

export type { Consequence, Directive, EngineFact, Front, Hook, State }
