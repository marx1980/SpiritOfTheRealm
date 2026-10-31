// A3: one independent stream per system. Seed = hash(master_seed, stream_name). Integer-only output.
// sfc32 (Chris Doty-Humphrey's Small Fast Counting generator) on 32-bit words; uses only Math.imul,
// shifts and >>> 0, which every JavaScript engine computes identically.

export type RngState = [number, number, number, number];

function cyrb128(str: string): RngState {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export class Rng {
  private a: number; private b: number; private c: number; private d: number;
  draws = 0;

  private constructor(s: RngState) {
    [this.a, this.b, this.c, this.d] = s;
  }

  static fromSeed(master: number, name: string): Rng {
    if (!Number.isInteger(master)) throw new Error("master seed must be an integer");
    const r = new Rng(cyrb128(`${master}|${name}`));
    for (let i = 0; i < 12; i++) r.u32(); // warm up
    r.draws = 0;
    return r;
  }

  static fromState(s: RngState): Rng {
    return new Rng([...s] as RngState);
  }

  getState(): RngState {
    return [this.a, this.b, this.c, this.d];
  }

  u32(): number {
    this.draws++;
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** Uniform integer in [lo, hi], inclusive, by rejection (no modulo bias). */
  int(lo: number, hi: number): number {
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo) throw new Error(`bad range ${lo}..${hi}`);
    const range = hi - lo + 1;
    if (range > 4294967296) throw new Error("range too large");
    const limit = 4294967296 - (4294967296 % range);
    let x = this.u32();
    while (x >= limit) x = this.u32();
    return lo + (x % range);
  }

  /** True with probability p/1000. */
  chancePermille(p: number): boolean {
    return this.int(0, 999) < p;
  }
}
