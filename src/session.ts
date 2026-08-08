// Контур хода. Изоморфно: ни fs, ни path, ни process.
// Сессия не содержит логики мира — только оркестровка: что отправить, как разобрать,
// когда сохранить. Все числа меняет только applyDelta.
import {
	HISTORY_TAIL,
	SNAPSHOT_EVERY,
	applyDelta,
	audit,
	calendarPressure,
	clone,
} from "./engine.ts"
import {
	renderDigest,
	renderEngineBlock,
	renderLedger,
	renderPrices,
	renderSnapshot,
	renderStateForModel,
} from "./render.ts"
import { LlmError } from "./llm.ts"
import type { LlmCallOptions, LlmCaller, LlmMessage } from "./llm.ts"
import type { Delta, EngineFact, State } from "./types.ts"
import type { GameRecord, Storage, TranscriptEntry, TurnDebug, UndoFrame } from "./storage/types.ts"

export type ParsedTurn = { prose: string; delta: Delta | null; raw: string | null; error?: string }

/** Разбор текстового ответа: проза + блок <delta>{...}</delta>. */
export function parseTurn(raw: string): ParsedTurn {
	const match = raw.match(/<delta>([\s\S]*?)<\/delta>/i)
	const prose = raw.replace(/<delta>[\s\S]*?<\/delta>/gi, "").trim()
	if (!match) return { prose, delta: null, raw: null, error: "в ответе нет блока <delta>" }
	const body = stripFence(match[1].trim())
	try {
		const delta = JSON.parse(body) as Delta
		if (typeof delta !== "object" || delta === null || Array.isArray(delta)) {
			return { prose, delta: null, raw: body, error: "блок <delta> — не объект" }
		}
		return { prose, delta, raw: body }
	} catch (e) {
		return {
			prose,
			delta: null,
			raw: body,
			error: `невалидный JSON в <delta>: ${e instanceof Error ? e.message : String(e)}`,
		}
	}
}

function stripFence(s: string): string {
	const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
	return fence ? fence[1] : s
}

/** Локальные команды перехватываются и НЕ уходят в модель. */
export const LOCAL_COMMANDS = [
	{ id: "snapshot", label: "Снапшот", text: "((снапшот))" },
	{ id: "audit", label: "Аудит", text: "((аудит))" },
	{ id: "log", label: "Лог", text: "((лог))" },
	{ id: "prices", label: "Цены", text: "((цены))" },
	{ id: "undo", label: "Откат", text: "((откат))" },
	{ id: "export", label: "Экспорт", text: "((экспорт))" },
] as const

/** Эти две команды — единственные, которые уходят модели. */
export const MODEL_COMMANDS = [{ id: "epilogue", label: "Эпилог", text: "((эпилог))" }] as const

export function isLocalCommand(input: string): boolean {
	const t = input.trim()
	if (/^\(\(поправка:/i.test(t)) return true
	return LOCAL_COMMANDS.some((c) => c.text === t)
}

export type SessionDeps = {
	record: GameRecord
	storage: Storage
	prompts: { core: string; schema: string }
	llm: LlmCaller
	modelName?: string
	now?: () => number
	newId?: () => string
}

export type TurnOutcome = {
	entries: TranscriptEntry[]
	applied: boolean
	error?: string
}

let counter = 0
function defaultId(): string {
	counter += 1
	return `e${Date.now().toString(36)}${counter.toString(36)}`
}

export class Session {
	record: GameRecord
	storage: Storage
	prompts: { core: string; schema: string }
	llm: LlmCaller
	modelName: string
	now: () => number
	newId: () => string

	constructor(deps: SessionDeps) {
		this.record = deps.record
		this.storage = deps.storage
		this.prompts = deps.prompts
		this.llm = deps.llm
		this.modelName = deps.modelName ?? ""
		this.now = deps.now ?? (() => Date.now())
		this.newId = deps.newId ?? defaultId
	}

	get state(): State {
		return this.record.state
	}

	private entry(kind: TranscriptEntry["kind"], text: string, debug?: TurnDebug): TranscriptEntry {
		return {
			id: this.newId(),
			turn: this.record.state.clock.turn,
			kind,
			text,
			at: this.now(),
			...(debug ? { debug } : {}),
		}
	}

	/**
	 * H. В модель уходит: CORE + DELTA-SCHEMA + снапшот-дайджест + компактное состояние
	 * + блок движка (A/D/F) + последние 8 сообщений + реплика игрока. Вся история — никогда.
	 */
	buildMessages(playerInput: string, retryNote?: string): LlmMessage[] {
		const r = this.record
		const msgs: LlmMessage[] = []
		msgs.push({ role: "system", content: `${this.prompts.core.trim()}\n\n${this.prompts.schema.trim()}` })
		if (r.digest) {
			msgs.push({
				role: "system",
				content: `СЖАТАЯ ИСТОРИЯ (пишет движок; раздел ПАМЯТЬ — то, что персонажи помнят без напоминаний):\n${r.digest}`,
			})
		}
		msgs.push({ role: "system", content: renderStateForModel(r.state) })
		const engineBlock = renderEngineBlock(r.pendingFacts, calendarPressure(r.state))
		if (engineBlock) msgs.push({ role: "system", content: engineBlock })
		for (const m of r.history.slice(-HISTORY_TAIL)) msgs.push(m)
		msgs.push({
			role: "user",
			content: retryNote ? `${playerInput}\n\n[система: ${retryNote}]` : playerInput,
		})
		return msgs
	}

	/** Локальные команды: ответ считает код, модель не участвует. */
	async runLocalCommand(input: string): Promise<TurnOutcome> {
		const t = input.trim()
		const r = this.record
		const push = async (text: string): Promise<TurnOutcome> => {
			const e = this.entry("system", text)
			r.transcript.push(e)
			await this.save()
			return { entries: [e], applied: false }
		}

		if (t === "((снапшот))") {
			r.state.snapshotSeq += 1
			return push(renderSnapshot(r.state, { spoilers: true }))
		}
		if (t === "((аудит))") {
			const issues = audit(r.state)
			return push(issues.length ? `Сверка: ${issues.join("; ")}` : "Сверка: чисто")
		}
		if (t === "((лог))") return push(renderLedger(r.state, 15))
		if (t === "((цены))") return push(`Якоря цен: ${renderPrices(r.state)}`)
		if (t === "((экспорт))") {
			// Дамп на сотни килобайт в ленте убивает и чтение, и следующий скролл.
			const json = this.exportJson()
			const kb = Math.max(1, Math.round(json.length / 1024))
			return push(
				`Экспорт готов: ${kb} КБ, файл «${exportFileName(r.title, r.state.clock.turn)}».`,
			)
		}
		if (t === "((откат))") {
			const ok = await this.undo()
			const e = this.entry(
				"system",
				ok ? `Откат выполнен. Сейчас ход ${r.state.clock.turn}, день ${r.state.clock.day}.` : "Откатываться некуда.",
			)
			r.transcript.push(e)
			await this.save()
			return { entries: [e], applied: false }
		}
		const fix = t.match(/^\(\(поправка:\s*([\s\S]+?)\)\)$/i)
		if (fix) {
			r.state.precedents.push(fix[1].trim())
			return push(`Прецедент записан: ${fix[1].trim()}`)
		}
		return push("Неизвестная команда.")
	}

	/**
	 * Один ход. J: сбой не теряет состояние — при любой ошибке состояние остаётся прежним.
	 * A: ретрай только на невалидный JSON в <delta>, никогда — ради устранения отклонения.
	 */
	async turn(playerInput: string, opts: LlmCallOptions = {}): Promise<TurnOutcome> {
		const input = playerInput.trim()
		if (!input) return { entries: [], applied: false }
		if (isLocalCommand(input)) return this.runLocalCommand(input)

		const r = this.record
		const started = this.now()
		let retried = false
		let messages = this.buildMessages(input)

		let prose = ""
		let delta: Delta | null = null
		let rawDelta: string | null = null
		let usage = null as TurnDebug["usage"]
		let mode = "text"

		try {
			let res = await this.llm(messages, opts)
			usage = res.usage
			mode = res.mode
			if (res.structured) {
				prose = res.structured.prose.trim()
				delta = res.structured.delta
				rawDelta = JSON.stringify(res.structured.delta)
			} else {
				const parsed = parseTurn(res.text)
				prose = parsed.prose
				delta = parsed.delta
				rawDelta = parsed.raw
				if (!delta) {
					// Единственный допустимый ретрай.
					retried = true
					messages = this.buildMessages(
						input,
						`предыдущий ответ не разобран (${parsed.error}). Повтори тот же ход целиком: проза, затем ровно один блок <delta>{...}</delta> с валидным JSON без комментариев и без текста после него.`,
					)
					res = await this.llm(messages, opts)
					usage = res.usage ?? usage
					mode = res.mode
					if (res.structured) {
						prose = res.structured.prose.trim()
						delta = res.structured.delta
						rawDelta = JSON.stringify(res.structured.delta)
					} else {
						const again = parseTurn(res.text)
						prose = again.prose
						delta = again.delta
						rawDelta = again.raw
						if (!delta) {
							return this.failTurn(
								"Модель дважды вернула ход без пригодного блока дельты. Состояние мира не изменилось — повторите действие или возьмите модель посильнее.",
							)
						}
					}
				}
			}
		} catch (e) {
			const msg =
				e instanceof LlmError
					? e.message
					: `Не удалось выполнить ход: ${e instanceof Error ? e.message : String(e)}`
			return this.failTurn(msg)
		}

		if (!prose.trim()) prose = "(модель не прислала текст сцены)"

		const directives = calendarPressure(r.state).map((d) => d.text)
		return this.commit(input, prose, delta, {
			rawDelta,
			usage,
			mode,
			ms: this.now() - started,
			contextMessages: messages.length,
			retried,
			directives,
		})
	}

	private async failTurn(message: string): Promise<TurnOutcome> {
		const e = this.entry("system", message)
		this.record.transcript.push(e)
		await this.save()
		return { entries: [e], applied: false, error: message }
	}

	/** Применение хода: кадр отката → applyDelta → лента → сжатие → автосохранение. */
	private async commit(
		playerInput: string,
		prose: string,
		delta: Delta | null,
		meta: {
			rawDelta: string | null
			usage: TurnDebug["usage"]
			mode: string
			ms: number
			contextMessages: number
			retried: boolean
			directives: string[]
		},
	): Promise<TurnOutcome> {
		const r = this.record

		// C. Кадр отката снимается ДО изменений.
		const frame: UndoFrame = {
			state: clone(r.state),
			transcriptLength: r.transcript.length,
			historyLength: r.history.length,
			digest: r.digest,
			pendingFacts: clone(r.pendingFacts),
		}
		await this.storage.pushUndo(r.id, frame)

		const playerEntry = this.entry("player", playerInput)
		const result = applyDelta(r.state, delta ?? {})
		r.state = result.state
		r.lastDelta = delta

		const debug: TurnDebug = {
			rawDelta: meta.rawDelta,
			applied: result.applied,
			rejected: result.facts
				.filter((f) => f.kind === "rejection" || f.kind === "limit" || f.kind === "clamp")
				.map((f) => ({ code: f.code, text: f.text })),
			directives: meta.directives,
			usage: meta.usage,
			mode: meta.mode,
			model: this.modelName,
			ms: meta.ms,
			contextMessages: meta.contextMessages,
			retried: meta.retried,
		}

		playerEntry.turn = r.state.clock.turn
		const proseEntry = this.entry("prose", prose, debug)
		r.transcript.push(playerEntry, proseEntry)

		// A. Факты движка уйдут модели ровно один раз — в следующем ходе.
		r.pendingFacts = result.facts.filter((f: EngineFact) => f.forModel)

		r.history.push({ role: "user", content: playerInput })
		r.history.push({ role: "assistant", content: prose })

		// H. Раз в SNAPSHOT_EVERY ходов снапшот заменяет старую переписку. Пишет его код.
		if (r.state.clock.turn > 0 && r.state.clock.turn % SNAPSHOT_EVERY === 0) {
			r.state.snapshotSeq += 1
			r.digest = renderDigest(r.state)
			r.history = r.history.slice(-2)
		}

		r.updatedAt = this.now()
		await this.save()
		return { entries: [playerEntry, proseEntry], applied: true }
	}

	/** C. Детерминированный откат: состояние и лента возвращаются к одному и тому же ходу. */
	async undo(): Promise<boolean> {
		const frame = await this.storage.popUndo(this.record.id)
		if (!frame) return false
		const r = this.record
		r.state = frame.state
		r.transcript = r.transcript.slice(0, frame.transcriptLength)
		r.history = r.history.slice(0, frame.historyLength)
		r.digest = frame.digest
		r.pendingFacts = frame.pendingFacts
		r.updatedAt = this.now()
		await this.save()
		return true
	}

	async save(): Promise<void> {
		this.record.updatedAt = this.now()
		await this.storage.saveGame(this.record)
	}

	exportJson(): string {
		return JSON.stringify(this.record, null, "\t")
	}
}

/** Создание пустой записи партии из готового состояния. */
/** Имя файла экспорта: по нему должно быть видно, что за партия и какой ход. */
export function exportFileName(title: string, turn: number): string {
	const slug = title.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "")
	return `${slug.slice(0, 40) || "sim"}-ход-${turn}.json`
}

export function createGameRecord(args: {
	id: string
	title: string
	packId: string
	state: State
	now?: number
}): GameRecord {
	const at = args.now ?? Date.now()
	return {
		id: args.id,
		title: args.title,
		packId: args.packId,
		createdAt: at,
		updatedAt: at,
		state: args.state,
		transcript: [],
		history: [],
		digest: null,
		pendingFacts: [],
		lastDelta: null,
	}
}
