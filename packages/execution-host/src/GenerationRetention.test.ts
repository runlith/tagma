import { describe, expect, it } from 'bun:test';
import { Schema } from 'effect';
import { Incarnation } from '@runlith/executions/protocol/execution';
import {
  evictionDrainStep,
  ledgerSizeOf,
  planEvictionPass,
  selectGenerationVictims,
  type GenerationSize,
  type SizedRetiredGeneration,
} from './GenerationRetention';

const decode = Schema.decodeUnknownSync(Incarnation);

const measured = (bytes: number): GenerationSize => ({ _tag: 'Measured', bytes });

const capped = (bytes: number): GenerationSize => ({ _tag: 'Capped', bytes });

const unknown = (error = 'stat records: PermissionDenied'): GenerationSize => ({ _tag: 'Unknown', error });

const gen = (incarnation: number, size: GenerationSize, evicting = false): SizedRetiredGeneration => ({
  incarnation: decode(incarnation),
  evicting,
  size,
});

const select = (
  retired: ReadonlyArray<SizedRetiredGeneration>,
  current: number,
  reserve: number | undefined,
): {
  readonly victims: ReadonlyArray<number>;
  readonly volumeUnmeasured: boolean;
  readonly unknownBarrier: { readonly incarnation: number; readonly error: string } | undefined;
} => {
  const selection = selectGenerationVictims(retired, decode(current), reserve);
  return {
    victims: selection.victims.map(Number),
    volumeUnmeasured: selection.volumeUnmeasured,
    unknownBarrier:
      selection.unknownBarrier === undefined
        ? undefined
        : { incarnation: Number(selection.unknownBarrier.incarnation), error: selection.unknownBarrier.error },
  };
};

const oldestFirst = (retired: ReadonlyArray<SizedRetiredGeneration>): ReadonlyArray<SizedRetiredGeneration> =>
  [...retired].sort((left, right) => Number(left.incarnation) - Number(right.incarnation));

const composed = (full: ReadonlyArray<SizedRetiredGeneration>, current: number, reserve: number | undefined): ReturnType<typeof select> => {
  const ordered = oldestFirst(full);
  const cut = Math.max(0, ordered.length - 2);
  const second = select(ordered.slice(cut), current, reserve);
  return {
    victims: [...ordered.slice(0, cut).map((generation) => Number(generation.incarnation)), ...second.victims],
    volumeUnmeasured: second.volumeUnmeasured,
    unknownBarrier: second.unknownBarrier,
  };
};

describe('selectGenerationVictims', () => {
  it('retains an empty retired set', () => {
    expect(select([], 5, 100)).toEqual({ victims: [], volumeUnmeasured: false, unknownBarrier: undefined });
  });

  it('retains one small generation', () => {
    expect(select([gen(3, measured(4))], 5, 100).victims).toEqual([]);
  });

  it('retains two generations at the count limit', () => {
    expect(select([gen(3, measured(4)), gen(4, measured(4))], 5, 100).victims).toEqual([]);
  });

  it('evicts the oldest past two without a volume reading', () => {
    expect(select([gen(2, measured(4)), gen(3, measured(4)), gen(4, measured(4))], 5, undefined)).toEqual({
      victims: [2],
      volumeUnmeasured: false,
      unknownBarrier: undefined,
    });
  });

  it('evicts the oldest past two when the volume is not pressured', () => {
    expect(select([gen(2, measured(4)), gen(3, measured(4)), gen(4, measured(4))], 5, 1_000_000).victims).toEqual([2]);
  });

  it('evicts oldest first down to two', () => {
    expect(select([gen(1, measured(1)), gen(2, measured(1)), gen(3, measured(1)), gen(4, measured(1))], 5, 1_000_000).victims).toEqual([
      1, 2,
    ]);
  });

  it('evicts only the oldest while the remainder fits the volume cap', () => {
    expect(select([gen(3, measured(7)), gen(4, measured(4))], 5, 100).victims).toEqual([3]);
  });

  it('evicts an oldest that alone exceeds the cap', () => {
    expect(select([gen(3, measured(50)), gen(4, measured(5))], 5, 100).victims).toEqual([3]);
  });

  it('retains a remainder exactly at ten percent of the reserve', () => {
    expect(select([gen(3, measured(6)), gen(4, measured(4))], 5, 100).victims).toEqual([]);
  });

  it('evicts every positive-byte generation under a zero reserve', () => {
    expect(select([gen(3, measured(5)), gen(4, measured(0))], 5, 0).victims).toEqual([3]);
  });

  it('retains zero-byte generations under a zero reserve', () => {
    expect(select([gen(3, measured(0)), gen(4, measured(0))], 5, 0).victims).toEqual([]);
  });

  it('never names the current generation and never counts it', () => {
    expect(select([gen(3, measured(4)), gen(4, measured(4)), gen(5, measured(1_000_000))], 5, 1_000_000).victims).toEqual([]);
  });

  it('evicts the oldest retired while the current generation stands apart', () => {
    expect(
      select([gen(2, measured(4)), gen(3, measured(4)), gen(4, measured(4)), gen(9, measured(1_000_000))], 9, 1_000_000).victims,
    ).toEqual([2]);
  });

  it('decides oldest first regardless of input order', () => {
    expect(select([gen(4, measured(1)), gen(1, measured(1)), gen(3, measured(1)), gen(2, measured(1))], 5, 1_000_000).victims).toEqual([
      1, 2,
    ]);
  });

  it('treats unmeasurable byte figures as zero', () => {
    expect(select([gen(3, measured(Number.NaN)), gen(4, measured(-3))], 5, 100).victims).toEqual([]);
    expect(select([gen(3, measured(Number.POSITIVE_INFINITY)), gen(4, measured(4))], 5, 100).victims).toEqual([]);
  });

  it('enforces only the count ceiling under an unmeasurable reserve', () => {
    expect(select([gen(2, measured(4)), gen(3, measured(4)), gen(4, measured(4))], 5, Number.NaN).victims).toEqual([2]);
    expect(select([gen(2, measured(4)), gen(3, measured(4)), gen(4, measured(4))], 5, -1).victims).toEqual([2]);
    expect(select([gen(3, measured(40)), gen(4, measured(40))], 5, Number.NaN).victims).toEqual([]);
  });

  it('evicts across both ceilings oldest first', () => {
    expect(select([gen(1, measured(9)), gen(2, measured(9)), gen(3, measured(9)), gen(4, measured(9))], 5, 100).victims).toEqual([1, 2, 3]);
  });

  it('counts repeated incarnations positionally', () => {
    expect(select([gen(3, measured(1)), gen(3, measured(1)), gen(4, measured(1))], 5, 1_000_000).victims).toEqual([3]);
  });

  it('never names a marked generation and never counts it', () => {
    expect(select([gen(2, measured(1_000), true), gen(3, measured(4)), gen(4, measured(4))], 5, 100).victims).toEqual([]);
  });

  it('ignores marked generations when applying the count ceiling', () => {
    expect(
      select([gen(1, measured(1), true), gen(2, measured(1)), gen(3, measured(1)), gen(4, measured(1))], 5, 1_000_000).victims,
    ).toEqual([2]);
  });

  it('ignores marked generations when applying the volume ceiling', () => {
    expect(select([gen(2, measured(1_000), true), gen(3, measured(7)), gen(4, measured(4))], 5, 100).victims).toEqual([3]);
  });

  it('evicts on a capped lower bound and keeps the remainder', () => {
    expect(select([gen(3, capped(12)), gen(4, measured(4))], 5, 100).victims).toEqual([3]);
  });

  it('counts a capped figure at its stopped sum', () => {
    expect(select([gen(3, measured(2)), gen(4, capped(9))], 5, 100).victims).toEqual([3]);
  });

  it('evicts a capped generation under a zero reserve', () => {
    expect(select([gen(3, capped(5))], 5, 0).victims).toEqual([3]);
  });

  it('suspends volume selection at an unknown oldest', () => {
    expect(select([gen(2, unknown('stat a: PermissionDenied')), gen(3, measured(50))], 5, 100)).toEqual({
      victims: [],
      volumeUnmeasured: true,
      unknownBarrier: { incarnation: 2, error: 'stat a: PermissionDenied' },
    });
  });

  it('retains an unknown remainder the volume ceiling cannot prove over', () => {
    expect(select([gen(3, unknown())], 5, 100)).toEqual({
      victims: [],
      volumeUnmeasured: true,
      unknownBarrier: { incarnation: 3, error: 'stat records: PermissionDenied' },
    });
  });

  it('suspends volume selection from an unknown remainder onward', () => {
    expect(select([gen(2, measured(1)), gen(3, measured(1)), gen(4, unknown())], 5, 100)).toEqual({
      victims: [2],
      volumeUnmeasured: true,
      unknownBarrier: { incarnation: 4, error: 'stat records: PermissionDenied' },
    });
  });

  it('suspends at an unknown middle without touching younger generations', () => {
    expect(select([gen(2, measured(1)), gen(3, unknown()), gen(4, measured(50))], 5, 100)).toEqual({
      victims: [2],
      volumeUnmeasured: true,
      unknownBarrier: { incarnation: 3, error: 'stat records: PermissionDenied' },
    });
  });

  it('reports the first retained unknown barrier with its own error', () => {
    expect(select([gen(2, unknown('stat a: EACCES')), gen(3, measured(50)), gen(4, unknown('readDirectory b: EIO'))], 5, 100)).toEqual({
      victims: [2, 3],
      volumeUnmeasured: true,
      unknownBarrier: { incarnation: 4, error: 'readDirectory b: EIO' },
    });
  });

  it('runs the count ceiling over unknown generations', () => {
    expect(select([gen(2, unknown()), gen(3, unknown()), gen(4, unknown())], 5, 100)).toEqual({
      victims: [2],
      volumeUnmeasured: true,
      unknownBarrier: { incarnation: 3, error: 'stat records: PermissionDenied' },
    });
  });

  it('runs the count ceiling over an unknown oldest without a reserve', () => {
    expect(select([gen(2, unknown()), gen(3, measured(1)), gen(4, measured(1))], 5, undefined)).toEqual({
      victims: [2],
      volumeUnmeasured: false,
      unknownBarrier: undefined,
    });
  });

  it('applies the count ceiling past an unknown oldest within budget', () => {
    expect(select([gen(2, unknown()), gen(3, measured(4)), gen(4, measured(4)), gen(5, measured(4))], 9, 100)).toEqual({
      victims: [2, 3],
      volumeUnmeasured: false,
      unknownBarrier: undefined,
    });
  });

  it('evicts a long history oldest first regardless of input order', () => {
    const ordered = Array.from({ length: 12 }, (_, index) => gen(index + 1, measured(3)));
    const shuffled = [...ordered].reverse();
    expect(select(shuffled, 20, 100)).toEqual({
      victims: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      volumeUnmeasured: false,
      unknownBarrier: undefined,
    });
  });

  it('matches count-first composition on reordered inputs with an unknown count victim', () => {
    const full = [gen(5, measured(4)), gen(2, unknown()), gen(4, measured(4)), gen(3, measured(4)), gen(6, measured(4))];
    expect(composed(full, 9, 100)).toEqual(select(full, 9, 100));
    expect(select(full, 9, 100).victims).toEqual([2, 3, 4]);
  });

  it('matches count-first composition with a capped survivor', () => {
    const full = [gen(4, capped(9)), gen(2, measured(1)), gen(3, measured(1))];
    expect(composed(full, 9, 100)).toEqual(select(full, 9, 100));
    expect(select(full, 9, 100).victims).toEqual([2]);
  });

  it('matches count-first composition past an unknown count victim', () => {
    const full = [gen(4, measured(1)), gen(2, unknown()), gen(5, measured(1)), gen(3, measured(50))];
    expect(composed(full, 9, 100)).toEqual(select(full, 9, 100));
    expect(select(full, 9, 100).victims).toEqual([2, 3]);
  });
});

describe('evictionDrainStep', () => {
  it('deletes only with no readers held', () => {
    expect(evictionDrainStep({ readers: 0, waitedMs: 0, ceilingMs: 30_000 })).toBe('delete');
    expect(evictionDrainStep({ readers: -1, waitedMs: 0, ceilingMs: 30_000 })).toBe('delete');
    expect(evictionDrainStep({ readers: 0, waitedMs: 60_000, ceilingMs: 30_000 })).toBe('delete');
  });

  it('waits while readers stand inside the ceiling', () => {
    expect(evictionDrainStep({ readers: 1, waitedMs: 0, ceilingMs: 30_000 })).toBe('await-drain');
    expect(evictionDrainStep({ readers: 4, waitedMs: 29_999, ceilingMs: 30_000 })).toBe('await-drain');
  });

  it('refuses once the ceiling is reached with readers still held', () => {
    expect(evictionDrainStep({ readers: 1, waitedMs: 30_000, ceilingMs: 30_000 })).toBe('refuse');
    expect(evictionDrainStep({ readers: 2, waitedMs: 45_000, ceilingMs: 30_000 })).toBe('refuse');
  });

  it('retries to delete after readers drain following a timeout', () => {
    expect(evictionDrainStep({ readers: 3, waitedMs: 0, ceilingMs: 30_000 })).toBe('await-drain');
    expect(evictionDrainStep({ readers: 3, waitedMs: 30_000, ceilingMs: 30_000 })).toBe('refuse');
    expect(evictionDrainStep({ readers: 0, waitedMs: 30_000, ceilingMs: 30_000 })).toBe('delete');
  });
});

describe('ledgerSizeOf', () => {
  it('reports a missing row as unknown', () => {
    expect(ledgerSizeOf(null, false)).toEqual({ _tag: 'Unknown', error: 'no ledger row: bytes never tracked' });
  });

  it('reports a dirty row as unknown even with bytes present', () => {
    expect(ledgerSizeOf(40, true)).toEqual({ _tag: 'Unknown', error: 'unnoted record bytes outstanding' });
    expect(ledgerSizeOf(null, true)).toEqual({ _tag: 'Unknown', error: 'no ledger row: bytes never tracked' });
  });

  it('reports a clean row at its ledger figure', () => {
    expect(ledgerSizeOf(40, false)).toEqual({ _tag: 'Measured', bytes: 40 });
    expect(ledgerSizeOf(0, false)).toEqual({ _tag: 'Measured', bytes: 0 });
  });
});

describe('planEvictionPass', () => {
  const incarnation = (value: number): Incarnation => decode(value);

  it('removes every candidate when none blocks', () => {
    expect(planEvictionPass([incarnation(2), incarnation(3)], () => 'removed')).toEqual({
      removed: [incarnation(2), incarnation(3)],
      blockedOn: undefined,
    });
  });

  it('stops at a blocked oldest without touching younger candidates', () => {
    const consulted: Array<number> = [];
    const pass = planEvictionPass([incarnation(2), incarnation(3), incarnation(4)], (candidate) => {
      consulted.push(Number(candidate));
      return candidate === incarnation(2) ? 'blocked' : 'removed';
    });
    expect(pass).toEqual({ removed: [], blockedOn: incarnation(2) });
    expect(consulted).toEqual([2]);
  });

  it('keeps removals before a blocked middle and stops the pressure retry', () => {
    const pass = planEvictionPass([incarnation(5), incarnation(6)], (candidate) => (candidate === incarnation(5) ? 'removed' : 'blocked'));
    expect(pass).toEqual({ removed: [incarnation(5)], blockedOn: incarnation(6) });
  });
});
