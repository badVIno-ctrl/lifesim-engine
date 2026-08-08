// Точка входа клиента. Никакой логики мира здесь нет и быть не может.
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { registerSW } from "virtual:pwa-register"
import { App } from "./App.tsx"
import "./styles.css"

const host = document.getElementById("root")
if (!host) throw new Error("нет элемента #root в index.html")

createRoot(host).render(
	<StrictMode>
		<App />
	</StrictMode>,
)

// Оффлайн-оболочка и установка на домашний экран. В dev это пустая заглушка.
registerSW({ immediate: true })
