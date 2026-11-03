import { Effect, Option, Result } from 'effect';
import { totalmem } from 'node:os';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { Blocks } from '../../graph/contract/service/blocks.js';
import { type BlockRecord, type BlockRow } from '../../graph/contract/service/acts.js';
import { Tags } from '../../graph/contract/service/vocabulary.js';
import { Orientation } from '../../graph/contract/service/orientation.js';
import { enforcementOf } from './law.js';
import { hasTrigger, type LawEnforcement } from '../../graph/contract/wire/enforcement.js';
import { type Descriptions, type Law, type MapReading, readLaw } from '../contract/wire/document.js';
import type { ConfigVersion } from '../../config/contract/service/configs.js';
import { descriptionsAt } from './descriptions.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { UnreadableTag } from '../../graph/contract/wire/tags/table.js';
import { COMMIT_OPERATIONS, LANDING_TRIGGER } from '../contract/wire/landings.js';
import { RuleRevision } from '../contract/service/ruleRevision.js';
import { assembleMap } from './moduleMap.js';

export const within = (places: readonly string[], base: string): string[] => {
  const kept = new Set<string>();
  for (const written of places) {
    const place = written.replace(/\/+$/, '');
    if (base === '' || place === base || place.startsWith(`${base}/`)) kept.add(place);
    else if (place === '' || base.startsWith(`${place}/`)) kept.add(base);
  }
  const sorted = [...kept].sort();
  return sorted.filter((place) => !sorted.some((other) => other !== place && (other === '' || place.startsWith(`${other}/`))));
};

export const covers =
  (places: readonly string[]) =>
  (path: string): boolean =>
    places.some((place) => place === '' || path === place || path.startsWith(`${place}/`));

export const reachOf = Effect.fn('enforcement.reachOf')(function* (
  row: BlockRow,
  base: string,
): Effect.fn.Return<string[], StoreFailure, Orientation> {
  return within((yield* (yield* Orientation).ruleReach(row.projectId)).get(row.id)?.places ?? [], base);
});

const RUNS: ReadonlySet<string> = new Set(['watch', 'gate']);

export const triggerOf = (op: string): string => (COMMIT_OPERATIONS.includes(op) ? LANDING_TRIGGER : op);

type Policy = Pick<LawEnforcement, 'strictness' | 'on'>;

export const runsBefore = (document: Policy, op: string): boolean =>
  RUNS.has(document.strictness) && hasTrigger(document.on, triggerOf(op), 'before');

export const afterTriggered = (document: Policy, op: string): boolean =>
  RUNS.has(document.strictness) && hasTrigger(document.on, triggerOf(op), 'after');

export const runsOn = (document: Policy, op: string): boolean => RUNS.has(document.strictness) && hasTrigger(document.on, triggerOf(op));

type Placed = {
  readonly reach: (base: string) => Effect.Effect<string[], StoreFailure>;
  readonly anchors: readonly string[];
};

type Unreadable = { readonly rule: BlockRecord; readonly document: null; readonly unreadable: GateRefusal<'field-invalid'> };

export type Statute = ({ readonly rule: BlockRecord; readonly document: LawEnforcement } | Unreadable) & Placed;

export type Enforced = ({ readonly rule: BlockRecord; readonly document: Law } | Unreadable) & Placed;

const KEPT = Math.max(1, Math.floor(totalmem() / (256 * 1024 * 1024)));
const snapshots = new Map<string, readonly Statute[]>();
const maps = new Map<string, MapReading>();

const remembered = <V>(held: Map<string, V>, stamp: string, value: V): V => {
  held.set(stamp, value);
  if (held.size > KEPT) held.delete(held.keys().next().value as string);
  return value;
};

const stampOf = Effect.fn('enforcement.stampOf')(function* (projectId: number) {
  const revision = yield* Effect.serviceOption(RuleRevision);
  return Option.isSome(revision) ? yield* revision.value.current(projectId) : null;
});

export const moduleMapOf = Effect.fn('enforcement.moduleMapOf')(function* (projectId: number) {
  const stamp = yield* stampOf(projectId);
  const known = stamp === null ? undefined : maps.get(stamp);
  if (known !== undefined) return known;
  const reading = assembleMap(yield* (yield* Blocks).moduleCards(projectId));
  return stamp === null ? reading : remembered(maps, stamp, reading);
});

const unreadVocabulary = (unread: readonly UnreadableTag[]): GateRefusal<'inspection-failed'> =>
  new GateRefusal(
    'inspection-failed',
    `this project's vocabulary does not read, so the rules it declares cannot be told from the rest: ${unread.map((one) => `${one.name}${one.id === '' ? '' : ` (#${one.id})`}: ${one.reason}`).join('; ')}`,
    [
      'update_block each declaration named here into a shape this server reads, or delete_block it if its type is no longer wanted — its nodes stay, carrying a word nothing declares; the rules are judged again once every declaration reads',
      'read_vocabulary names each declaration that does not read, with its reason',
    ],
  );

export const enforcedStatutes = Effect.fn('enforcement.enforcedStatutes')(function* (projectId: number) {
  const stamp = yield* stampOf(projectId);
  const cached = stamp === null ? undefined : snapshots.get(stamp);
  if (stamp !== null && cached !== undefined) {
    snapshots.delete(stamp);
    snapshots.set(stamp, cached);
    return cached;
  }
  const statutes = yield* statutesOf(projectId, (orientation) => orientation.rules(projectId));
  return stamp === null ? statutes : remembered(snapshots, stamp, statutes);
});

const statutesOf = Effect.fnUntraced(function* (
  projectId: number,
  chosen: (orientation: Orientation['Service']) => Effect.Effect<readonly BlockRecord[], StoreFailure | GateRefusal<'no-root'>>,
) {
  const table = yield* (yield* Tags).of(projectId);
  if (table.unreadable.length > 0) return yield* unreadVocabulary(table.unreadable);
  const orientation = yield* Orientation;
  const reaches = yield* orientation.ruleReach(projectId);
  const statutes: Statute[] = [];
  for (const rule of yield* chosen(orientation)) {
    const reached = reaches.get(rule.id);
    const places = reached?.places ?? [];
    const anchors = reached?.anchors ?? [];
    const reach = (base: string) => Effect.succeed(within(places, base));
    const read = yield* Effect.result(enforcementOf(table, rule));
    if (Result.isFailure(read)) statutes.push({ rule, document: null, unreadable: read.failure, reach, anchors });
    else if (read.success !== undefined) statutes.push({ rule, document: read.success, reach, anchors });
  }
  return statutes;
});

export const switchedOffStatutes = Effect.fn('enforcement.switchedOffStatutes')(function* (projectId: number) {
  return yield* statutesOf(projectId, (orientation) => orientation.rulesOff(projectId));
});

export type DescribedAt = ConfigVersion | Descriptions;

export const enforcedRules = Effect.fn('enforcement.enforcedRules')(function* (
  projectId: number,
  at: DescribedAt,
  read?: MapReading,
  known?: readonly Statute[],
) {
  const statutes = known ?? (yield* enforcedStatutes(projectId));
  if (statutes.every((one) => one.document === null)) return statutes as readonly Enforced[];
  const descriptions = 'tree' in at ? yield* descriptionsAt(at) : at;
  const reading = read ?? (yield* moduleMapOf(projectId));
  return statutes.map((one): Enforced =>
    one.document === null ? one : { ...one, document: readLaw(one.document, descriptions, reading) },
  );
});
