import type { Incarnation } from '@runlith/executions/protocol/execution';

export const RETAINED_GENERATION_LIMIT = 2;

export const RETAINED_RESERVE_DIVISOR = 10;

export type GenerationSize =
  | { readonly _tag: 'Measured'; readonly bytes: number }
  | { readonly _tag: 'Capped'; readonly bytes: number }
  | { readonly _tag: 'Unknown'; readonly error: string };

export type SizedRetiredGeneration = {
  readonly incarnation: Incarnation;
  readonly evicting: boolean;
  readonly size: GenerationSize;
};

export type Selection = {
  readonly victims: ReadonlyArray<Incarnation>;
  readonly volumeUnmeasured: boolean;
  readonly unknownBarrier: { readonly incarnation: Incarnation; readonly error: string } | undefined;
};

export const selectGenerationVictims = (
  retired: ReadonlyArray<SizedRetiredGeneration>,
  current: Incarnation,
  reserve: number | undefined,
): Selection => {
  const ordered = retired
    .filter((generation) => generation.incarnation !== current && !generation.evicting)
    .sort((left, right) => left.incarnation - right.incarnation);
  const cap = reserve !== undefined && Number.isFinite(reserve) && reserve >= 0 ? reserve / RETAINED_RESERVE_DIVISOR : undefined;
  const victims: Array<Incarnation> = [];
  let cursor = Math.max(0, ordered.length - RETAINED_GENERATION_LIMIT);
  for (let index = 0; index < cursor; index += 1) {
    victims.push((ordered[index] as SizedRetiredGeneration).incarnation);
  }
  if (cap !== undefined) {
    let bound = 0;
    for (let index = cursor; index < ordered.length; index += 1) {
      bound += lowerBound((ordered[index] as SizedRetiredGeneration).size);
    }
    while (bound > cap && cursor < ordered.length) {
      const oldest = ordered[cursor] as SizedRetiredGeneration;
      if (oldest.size._tag === 'Unknown') break;
      victims.push(oldest.incarnation);
      bound -= lowerBound(oldest.size);
      cursor += 1;
    }
  }
  const retained = ordered.slice(cursor);
  const barrier = retained.find((generation) => generation.size._tag === 'Unknown');
  return {
    victims,
    volumeUnmeasured: cap !== undefined && barrier !== undefined,
    unknownBarrier:
      barrier === undefined || barrier.size._tag !== 'Unknown'
        ? undefined
        : { incarnation: barrier.incarnation, error: barrier.size.error },
  };
};

const lowerBound = (size: GenerationSize): number => {
  if (size._tag === 'Unknown') return 0;
  return clampedBytes(size.bytes);
};

export type EvictionOutcome = 'removed' | 'blocked';

export type EvictionPass = {
  readonly removed: ReadonlyArray<Incarnation>;
  readonly blockedOn: Incarnation | undefined;
};

export const planEvictionPass = (
  candidates: ReadonlyArray<Incarnation>,
  outcomeOf: (incarnation: Incarnation) => EvictionOutcome,
): EvictionPass => {
  const removed: Array<Incarnation> = [];
  for (const candidate of candidates) {
    if (outcomeOf(candidate) === 'blocked') return { removed, blockedOn: candidate };
    removed.push(candidate);
  }
  return { removed, blockedOn: undefined };
};

export type EvictionDrain = {
  readonly readers: number;
  readonly waitedMs: number;
  readonly ceilingMs: number;
};

export type EvictionStep = 'delete' | 'await-drain' | 'refuse';

export const evictionDrainStep = (drain: EvictionDrain): EvictionStep => {
  if (drain.readers <= 0) return 'delete';
  return drain.waitedMs >= drain.ceilingMs ? 'refuse' : 'await-drain';
};

export const ledgerSizeOf = (bytes: number | null, uncertain: boolean): GenerationSize => {
  if (bytes === null || uncertain) {
    return {
      _tag: 'Unknown',
      error: bytes === null ? 'no ledger row: bytes never tracked' : 'unnoted record bytes outstanding',
    };
  }
  return { _tag: 'Measured', bytes };
};

const clampedBytes = (bytes: number): number => (Number.isFinite(bytes) ? Math.max(0, Math.floor(bytes)) : 0);
