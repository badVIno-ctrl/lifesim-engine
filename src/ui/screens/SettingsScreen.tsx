// Экран 2. НАСТРОЙКИ. Всё хранится в localStorage.
// Ключ уходит только на указанный эндпоинт — транзитом через локальный прокси,
// который его не хранит и не пишет в лог.
import { useState } from "react"
import { Notice, Screen } from "../components/Screen.tsx"
import { probeConnection } from "../../llm.ts"
import { DEFAULT_SETTINGS, VOICE_PREFERENCES } from "../settings.ts"
import { DEFAULT_TRANSCRIBE_MODEL, voiceModeExplanation } from "../../voice.ts"
import { voiceCapabilities } from "../voice-input.ts"
import type { Settings } from "../settings.ts"

const VOICE_LABELS: Record<Settings["voice"], string> = {
	auto: "Автоматически",
	web: "Браузером (бесплатно)",
	whisper: "На эндпоинте (whisper)",
	off: "Выключен",
}

export function SettingsScreen(props: {
	settings: Settings
	onChange: (s: Settings) => void
	onBack: () => void
}) {
	const s = props.settings
	const [probe, setProbe] = useState<{ ok: boolean; message: string } | null>(null)
	const [busy, setBusy] = useState(false)

	const patch = (part: Partial<Settings>) => props.onChange({ ...s, ...part })
	// Возможности браузера считаем на каждом рендере: они меняются вместе с ключом.
	const caps = voiceCapabilities(Boolean(s.apiKey.trim()))

	const check = async () => {
		setBusy(true)
		setProbe(null)
		try {
			const r = await probeConnection({
				baseUrl: s.baseUrl,
				apiKey: s.apiKey,
				model: s.model,
				temperature: s.temperature,
				proxyPath: "/api/llm",
				structured: false,
				stream: false,
			})
			setProbe(r)
		} catch (e) {
			setProbe({ ok: false, message: e instanceof Error ? e.message : String(e) })
		} finally {
			setBusy(false)
		}
	}

	const local = s.engine === "local"

	return (
		<Screen title="Настройки" subtitle="ключ хранится только в этом браузере" onBack={props.onBack}>
			<div className="stack">
				{/* Первый выбор на экране — кто рассказывает. Всё остальное ниже
				    имеет смысл только во втором случае. */}
				<section className="tuning">
					<header className="tuning-head">
						<h3>Рассказчик</h3>
						<span className="tuning-label" data-custom={local ? "no" : "yes"}>
							{local ? "свой движок" : "модель по ключу"}
						</span>
					</header>
					<div className="tuning-presets" role="radiogroup" aria-label="Кто ведёт ход">
						<label className="tuning-preset" data-on={local ? "yes" : "no"}>
							<input
								type="radio"
								name="engine"
								checked={local}
								onChange={() => patch({ engine: "local" })}
							/>
							<span className="tuning-preset-body">
								<strong>Свой движок</strong>
								<span className="muted">
									Играет без ключей и без сети. Видит состояние целиком, поэтому не выдумывает
									чисел и всегда отрабатывает требования движка. Пишет суше живой модели.
								</span>
							</span>
						</label>
						<label className="tuning-preset" data-on={local ? "no" : "yes"}>
							<input
								type="radio"
								name="engine"
								checked={!local}
								onChange={() => patch({ engine: "llm" })}
							/>
							<span className="tuning-preset-body">
								<strong>Модель по ключу</strong>
								<span className="muted">
									Проза живее, но нужен ключ, сеть и токены. Ключ хранится только в этом браузере и
									уходит ровно в тот эндпоинт, который вы укажете.
								</span>
							</span>
						</label>
					</div>
				</section>

				<label className="field">
					<span>Вид по умолчанию</span>
					<select value={s.view} onChange={(e) => patch({ view: e.target.value as Settings["view"] })}>
						<option value="2d">2D-сцена и колода действий</option>
						<option value="text">Только текст</option>
					</select>
				</label>

				{local ? null : (
				<>
				<label className="field">
					<span>Базовый URL эндпоинта (совместимый с OpenAI API)</span>
					<input
						type="url"
						inputMode="url"
						autoComplete="off"
						spellCheck={false}
						placeholder={DEFAULT_SETTINGS.baseUrl}
						value={s.baseUrl}
						onChange={(e) => patch({ baseUrl: e.target.value })}
					/>
				</label>

				<label className="field">
					<span>Ключ</span>
					<input
						type="password"
						autoComplete="off"
						spellCheck={false}
						placeholder="sk-..."
						value={s.apiKey}
						onChange={(e) => patch({ apiKey: e.target.value })}
					/>
				</label>

				<label className="field">
					<span>Имя модели</span>
					<input
						type="text"
						autoComplete="off"
						spellCheck={false}
						placeholder={DEFAULT_SETTINGS.model}
						value={s.model}
						onChange={(e) => patch({ model: e.target.value })}
					/>
				</label>

				<label className="field">
					<span>Температура: {s.temperature.toFixed(2)}</span>
					<input
						type="range"
						min={0}
						max={2}
						step={0.05}
						value={s.temperature}
						onChange={(e) => patch({ temperature: Number(e.target.value) })}
					/>
				</label>

				<div className="row">
					<button type="button" className="primary grow" onClick={() => void check()} disabled={busy}>
						{busy ? "Проверяю…" : "Проверить соединение"}
					</button>
				</div>
				{probe ? <Notice kind={probe.ok ? "good" : "bad"}>{probe.message}</Notice> : null}

				<label className="toggle">
					<input
						type="checkbox"
						checked={s.twoPhase}
						onChange={(e) => patch({ twoPhase: e.target.checked })}
					/>
					<span>
						Двухфазный ход
						<em className="faint">
							{" "}
							— сначала дельта, потом проза по уже применённому состоянию. Проза перестаёт описывать
							то, что движок отклонил. Стоит два запроса вместо одного
						</em>
					</span>
				</label>
				<label className="toggle">
					<input type="checkbox" checked={s.stream} onChange={(e) => patch({ stream: e.target.checked })} />
					<span>
						Потоковый вывод
						<em className="faint"> — если эндпоинт умеет SSE</em>
					</span>
				</label>

				<label className="toggle">
					<input
						type="checkbox"
						checked={s.structured}
						onChange={(e) => patch({ structured: e.target.checked })}
					/>
					<span>
						Structured output (json_schema)
						<em className="faint"> — схема дельты генерится из типов; при отказе отключается сама</em>
					</span>
				</label>

				</>
				)}

				<label className="toggle">
					<input type="checkbox" checked={s.debug} onChange={(e) => patch({ debug: e.target.checked })} />
					<span>
						Режим отладки
						<em className="faint"> — сырая дельта, что применилось, что отклонено, токены</em>
					</span>
				</label>

				<label className="field">
					<span>Голосовой ввод</span>
					<select value={s.voice} onChange={(e) => patch({ voice: e.target.value as Settings["voice"] })}>
						{VOICE_PREFERENCES.map((v) => (
							<option key={v} value={v}>
								{VOICE_LABELS[v]}
							</option>
						))}
					</select>
				</label>
				<div className="faint">{voiceModeExplanation(s.voice, caps)}</div>

				<label className="field">
					<span>Язык речи</span>
					<input
						type="text"
						autoComplete="off"
						spellCheck={false}
						placeholder={DEFAULT_SETTINGS.voiceLang}
						value={s.voiceLang}
						onChange={(e) => patch({ voiceLang: e.target.value })}
					/>
				</label>

				{!local && (s.voice === "whisper" || (s.voice === "auto" && !caps.webSpeech)) ? (
					<label className="field">
						<span>Модель расшифровки</span>
						<input
							type="text"
							autoComplete="off"
							spellCheck={false}
							placeholder={DEFAULT_TRANSCRIBE_MODEL}
							value={s.transcribeModel}
							onChange={(e) => patch({ transcribeModel: e.target.value })}
						/>
					</label>
				) : null}

				<label className="toggle">
					<input type="checkbox" checked={s.speak} onChange={(e) => patch({ speak: e.target.checked })} />
					<span>
						Читать прозу вслух
						<em className="faint"> — голосом браузера, без токенов</em>
					</span>
				</label>

				<div className="card faint">
					{local
						? "Со своим движком сеть не нужна вообще: ход считается в браузере, партия хранится в браузере, наружу не уходит ничего."
						: "Запросы идут через локальный прокси /api/llm: он нужен только чтобы обойти CORS браузера. Прокси ходит по белому списку адресов, не логирует ключ и ничего не хранит."}
				</div>

				<button
					type="button"
					className="ghost"
					onClick={() => {
						if (confirm("Сбросить настройки к умолчаниям? Ключ будет стёрт.")) {
							props.onChange({ ...DEFAULT_SETTINGS })
							setProbe(null)
						}
					}}
				>
					Сбросить настройки
				</button>
			</div>
		</Screen>
	)
}
