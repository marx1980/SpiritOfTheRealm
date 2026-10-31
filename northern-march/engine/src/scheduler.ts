// A2: the scheduler jumps to the next scheduled item; ties break by insertion order.
// Items are data (handler name + JSON args), so the queue is serialisable and replayable.

export interface Scheduled {
  tick: number;
  seq: number;
  handler: string;
  args: Record<string, unknown>;
}

export class Scheduler {
  private heap: Scheduled[] = [];
  private seq = 0;
  private now = 0;

  get size(): number {
    return this.heap.length;
  }

  peekTick(): number | undefined {
    return this.heap[0]?.tick;
  }

  push(tick: number, handler: string, args: Record<string, unknown>): void {
    if (!Number.isSafeInteger(tick)) throw new Error(`tick must be an integer: ${tick}`);
    if (tick < this.now) throw new Error(`cannot schedule in the past (${tick} < ${this.now})`);
    const item = { tick, seq: this.seq++, handler, args };
    const h = this.heap;
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(h[i], h[p])) break;
      [h[i], h[p]] = [h[p], h[i]];
      i = p;
    }
  }

  pop(): Scheduled | undefined {
    const h = this.heap;
    if (!h.length) return undefined;
    const top = h[0];
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < h.length && less(h[l], h[m])) m = l;
        if (r < h.length && less(h[r], h[m])) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    this.now = top.tick;
    return top;
  }
}

function less(a: Scheduled, b: Scheduled): boolean {
  return a.tick < b.tick || (a.tick === b.tick && a.seq < b.seq);
}
