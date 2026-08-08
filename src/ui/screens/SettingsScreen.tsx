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

	return (
		<Screen title="Настройки" subtitle="ключ хранится только в этом браузере" onBack={props.onBack}>
			<div className="stack">
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
					<input type="checkbox" checked={s.debug} onChange={(e) => patch({ debug: e.target.checked })} />
					<span>
						Режим отладки
						<em className="faint"> — сырая дельта, что применилось, что отклонено, токены</em>
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

				{s.voice === "whisper" || (s.voice === "auto" && !caps.webSpeech) ? (
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
					Запросы идут через локальный прокси <code>/api/llm</code>: он нужен только чтобы обойти CORS
					браузера. Никакой логики мира и никакого хранения ключа на сервере нет.
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
