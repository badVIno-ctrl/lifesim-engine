// Сохранение файла на устройство. Грязный браузерный слой: в изоморфном src/*.ts ему места нет.

/** Скачивает текст как файл. Возвращает false, если среда не браузерная. */
export function downloadText(text: string, fileName: string, mime = "application/json"): boolean {
	if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return false
	const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
	const a = document.createElement("a")
	a.href = url
	a.download = fileName
	a.rel = "noopener"
	document.body.append(a)
	a.click()
	a.remove()
	// Отдаём браузеру время на старт загрузки, иначе Safari отменяет её.
	setTimeout(() => URL.revokeObjectURL(url), 10_000)
	return true
}
