/**
 * Deterministic seeded PRNG (mulberry32). All authoritative simulation randomness goes through this;
 * Math.random must never be used in simulation code. The whole generator state is one 32-bit integer,
 * so it can be snapshotted and restored for replays.
 */
export class SeededRandom {
  private s: number

  constructor(seed: number) {
    this.s = seed >>> 0
  }

  get state(): number {
    return this.s
  }

  set state(v: number) {
    this.s = v >>> 0
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next()
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  chance(p: number): boolean {
    return this.next() < p
  }

  /** Standard normal sample (Box-Muller). */
  gaussian(): number {
    const u = Math.max(1e-12, this.next())
    const v = this.next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick() from empty array')
    return items[Math.floor(this.next() * items.length)] as T
  }
}

/** Derive an independent seed from a base seed and a label (FNV-1a mix). */
export function deriveSeed(base: number, label: string): number {
  let h = 0x811c9dc5 ^ (base >>> 0)
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
