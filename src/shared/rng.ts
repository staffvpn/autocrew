// Детерминированный генератор случайных чисел. Одинаковый ключ даёт одинаковую
// последовательность, поэтому повторный расчёт мира на сервере не меняет результат.

function hash(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export interface Rng { next(): number; int(min: number, max: number): number; pick<T>(arr: T[]): T; weighted<T extends { weight: number }>(arr: T[]): T; chance(p: number): boolean }

export function rng(key: string): Rng {
  let a = hash(key);
  const next = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: arr => arr[Math.floor(next() * arr.length)],
    weighted: arr => {
      const total = arr.reduce((s, x) => s + x.weight, 0);
      let r = next() * total;
      for (const x of arr) { if ((r -= x.weight) < 0) return x; }
      return arr[arr.length - 1];
    },
    chance: p => next() < p,
  };
}
