// Детерминированная случайность. Изоморфно: ни fs, ни path, ни process.
//
// Своему движку нужна не «настоящая» случайность, а воспроизводимая: один и тот же
// ход из одного и того же состояния обязан дать один и тот же результат, иначе
// эталонный прогон ничего не проверяет, а откат перестаёт быть откатом.
// Поэтому зерно собирается из состояния и реплики игрока, а не из времени.

/** FNV-1a: короткая, быстрая, без зависимостей, хорошо перемешивает строки. */
export function hash32(text: string): number {
	let h = 0x811c9dc5
	for (let i = 0; i < text.length; i += 1) {
		h ^= text.charCodeAt(i)
		h = Math.imul(h, 0x01000193)
	}
	return h >>> 0
}

export class Rng {
	private state: number

	constructor(seed: number | string) {
		const s = typeof seed === "number" ? seed >>> 0 : hash32(seed)
		// Нулевое зерно вырождает генератор в константу.
		this.state = s === 0 ? 0x9e3779b9 : s
	}

	/** mulberry32: 32 бита состояния, ровное распределение, две строки кода. */
	float(): number {
		this.state = (this.state + 0x6d2b79f5) >>> 0
		let t = this.state
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}

	/** Целое в диапазоне включительно. */
	int(min: number, max: number): number {
		if (max <= min) return min
		return min + Math.floor(this.float() * (max - min + 1))
	}

	range(min: number, max: number): number {
		return min + this.float() * (max - min)
	}

	chance(p: number): boolean {
		return this.float() < p
	}

	pick<T>(items: readonly T[]): T {
		return items[Math.floor(this.float() * items.length)] ?? items[0]
	}

	/** Выбор с весами: чем больше вес, тем чаще. Вес ≤ 0 отключает вариант. */
	weighted<T>(items: readonly { value: T; weight: number }[]): T {
		const live = items.filter((i) => i.weight > 0)
		const total = live.reduce((sum, i) => sum + i.weight, 0)
		if (!live.length || total <= 0) return items[0]?.value as T
		let roll = this.float() * total
		for (const i of live) {
			roll -= i.weight
			if (roll <= 0) return i.value
		}
		return live[live.length - 1].value
	}

	/** Не повторяться, если есть из чего выбрать: главное лекарство от «одной фразы». */
	pickFresh<T>(items: readonly T[], used: readonly string[], key: (item: T) => string): T {
		const fresh = items.filter((i) => !used.includes(key(i)))
		return this.pick(fresh.length ? fresh : items)
	}

	shuffle<T>(items: readonly T[]): T[] {
		const out = [...items]
		for (let i = out.length - 1; i > 0; i -= 1) {
			const j = this.int(0, i)
			const tmp = out[i]
			out[i] = out[j]
			out[j] = tmp
		}
		return out
	}

	/** Сколько раз подряд выпало «да» — для редких, но не невозможных событий. */
	streak(p: number, max: number): number {
		let n = 0
		while (n < max && this.chance(p)) n += 1
		return n
	}
}
