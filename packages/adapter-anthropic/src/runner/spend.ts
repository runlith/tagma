import type { Usage } from '@runlith/acp/methods';
import type { Measured } from '@runlith/hosted-runner/wire/extensions';
import { readingOf, spent, usageOf, ZERO, type Cost, type Reading } from './translate.js';

type Counts = {
  readonly nonCached: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly output: number;
  readonly reasoning: number;
};

const NONE: Counts = { nonCached: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 };

export type Mark = { readonly reading: Reading | null; readonly asked: Counts };

export type Settled = { readonly usage?: Usage; readonly _meta?: { readonly 'tagma/cost': Cost } };

const countsOf = (usage: Usage): Counts => ({
  nonCached: usage.inputTokens - (usage.cachedReadTokens ?? 0) - (usage.cachedWriteTokens ?? 0),
  cacheRead: usage.cachedReadTokens ?? 0,
  cacheWrite: usage.cachedWriteTokens ?? 0,
  output: usage.outputTokens,
  reasoning: usage.thoughtTokens ?? 0,
});

export class Spend {
  private current: Reading | null;
  private asked: Counts = NONE;

  constructor(
    fresh: boolean,
    private readonly stderr: (line: string) => void,
  ) {
    this.current = fresh ? ZERO : null;
  }

  mark(): Mark {
    return { reading: this.current, asked: this.asked };
  }

  requested(measured: Measured): void {
    const asked = this.asked;
    this.asked = {
      nonCached: asked.nonCached + measured.input - measured.cacheRead - measured.cacheWrite,
      cacheRead: asked.cacheRead + measured.cacheRead,
      cacheWrite: asked.cacheWrite + measured.cacheWrite,
      output: asked.output + measured.output,
      reasoning: asked.reasoning + (measured.reasoning ?? 0),
    };
  }

  record(result: unknown): void {
    this.current = readingOf(result);
  }

  restart(fresh: boolean): void {
    this.current = fresh ? ZERO : null;
  }

  settled(mark: Mark): Settled {
    const current = this.current;
    if (mark.reading === null || current === null) return {};
    const whole = spent(mark.reading, current);
    const total = countsOf(whole.usage);
    const asked = this.asked;
    const rest = {
      nonCached: total.nonCached - (asked.nonCached - mark.asked.nonCached),
      cacheRead: total.cacheRead - (asked.cacheRead - mark.asked.cacheRead),
      cacheWrite: total.cacheWrite - (asked.cacheWrite - mark.asked.cacheWrite),
      output: total.output - (asked.output - mark.asked.output),
      reasoning: Math.max(0, total.reasoning - (asked.reasoning - mark.asked.reasoning)),
    };
    const cost = { _meta: { 'tagma/cost': whole.cost } };
    if (rest.nonCached < 0 || rest.cacheRead < 0 || rest.cacheWrite < 0 || rest.output < 0) {
      this.stderr(`Claude Code reported less cumulative usage than its requests: ${JSON.stringify({ whole: total, rest })}\n`);
      return cost;
    }
    return { usage: usageOf(rest), ...cost };
  }
}
