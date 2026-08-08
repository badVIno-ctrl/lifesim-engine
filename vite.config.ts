import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { VitePWA } from "vite-plugin-pwa"
import { llmProxyPlugin } from "./server/vite-plugin-llm-proxy.ts"

// Один конфиг на всё: клиент, прокси к LLM и PWA.
// `npm run dev` поднимает всё это одним процессом.
export default defineConfig({
	plugins: [
		react(),
		llmProxyPlugin(),
		VitePWA({
			registerType: "autoUpdate",
			includeAssets: ["favicon.svg", "apple-touch-icon.png"],
			manifest: {
				name: "Симулятор мира",
				short_name: "Симулятор",
				description: "Текстовый симулятор мира на LLM с детерминированным ядром",
				lang: "ru",
				start_url: "/",
				scope: "/",
				display: "standalone",
				orientation: "portrait",
				background_color: "#0d0f12",
				theme_color: "#0d0f12",
				icons: [
					{ src: "icons/pwa-192.png", sizes: "192x192", type: "image/png" },
					{ src: "icons/pwa-512.png", sizes: "512x512", type: "image/png" },
					{
						src: "icons/maskable-512.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "maskable",
					},
				],
			},
			workbox: {
				globPatterns: ["**/*.{js,css,html,svg,png,woff2,json}"],
				// К модели оффлайн ходить нечего: прокси никогда не кэшируется.
				navigateFallbackDenylist: [/^\/api\//],
				runtimeCaching: [],
			},
			devOptions: {
				enabled: false,
			},
		}),
	],
	server: {
		port: 5173,
		host: true,
		open: false,
	},
	preview: {
		port: 5173,
		host: true,
	},
	build: {
		target: "es2022",
		outDir: "dist",
		sourcemap: false,
	},
})
