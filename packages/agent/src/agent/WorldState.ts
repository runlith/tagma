import { Effect, Schema } from 'effect';
import type { TextPart } from '@runlith/llm/schema/messages';

export type PriorSection<A> = { readonly kind: 'absent' } | { readonly kind: 'unknown' } | { readonly kind: 'known'; readonly value: A };

export const unreadable = Symbol.for('@runlith/agent/WorldState.unreadable');
export type Unreadable = typeof unreadable;

export const withdrawn = Symbol.for('@runlith/agent/WorldState.withdrawn');
export type Withdrawn = typeof withdrawn;

export type WorldStateSection<A> = {
  readonly id: string;
  readonly codec: Schema.Codec<A, unknown>;
  readonly read: () => A | Unreadable | Withdrawn | Effect.Effect<A | Unreadable | Withdrawn>;
  readonly baseline: (current: A) => string | TextPart;
  readonly update: (previous: A | undefined, current: A) => string | TextPart;
  readonly removed?: (previous: A | undefined) => string | TextPart;
};

declare const packed: unique symbol;
export type PackedWorldStateSection = { readonly id: string; readonly [packed]: true };

export function worldStateSection<A>(section: WorldStateSection<A>): PackedWorldStateSection {
  return section as unknown as PackedWorldStateSection;
}

function readSection<A>(section: WorldStateSection<A>): Effect.Effect<A | Unreadable | Withdrawn> {
  const value = section.read();
  return Effect.isEffect(value) ? value : Effect.succeed(value);
}

export type WorldStateSnapshot = Readonly<Record<string, unknown>>;

export type WorldStateDiff =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'changed'; readonly text: string; readonly content: readonly TextPart[]; readonly snapshot: WorldStateSnapshot };

export const renderWorldState = Effect.fn('WorldState.render')(function* (
  packedSections: readonly PackedWorldStateSection[],
  previous: WorldStateSnapshot,
): Effect.fn.Return<WorldStateDiff> {
  const sections = packedSections as unknown as readonly WorldStateSection<unknown>[];
  const seen = new Set<string>();
  const snapshot: Record<string, unknown> = {};
  const parts: TextPart[] = [];

  for (const section of sections) {
    if (seen.has(section.id)) return yield* Effect.die(new Error(`Duplicate world state section: ${section.id}.`));
    seen.add(section.id);

    const current = yield* readSection(section);
    const prior = priorOf(section, previous);

    if (current === unreadable) {
      if (Object.hasOwn(previous, section.id)) snapshot[section.id] = previous[section.id];
      continue;
    }

    if (current === withdrawn) {
      if (prior.kind === 'absent') continue;
      const removal = section.removed?.(priorValue(prior));
      if (removal) parts.push(typeof removal === 'string' ? { type: 'text', text: removal } : removal);
      continue;
    }

    snapshot[section.id] = Schema.encodeSync(section.codec)(current);
    if (prior.kind === 'known' && equals(section, prior.value, current)) continue;
    const rendered = prior.kind === 'absent' ? section.baseline(current) : section.update(priorValue(prior), current);
    parts.push(typeof rendered === 'string' ? { type: 'text', text: rendered } : rendered);
  }

  if (parts.length === 0) return { kind: 'unchanged' };
  return { kind: 'changed', text: parts.map((part) => part.text).join('\n\n'), content: parts, snapshot };
});

function priorOf<A>(section: WorldStateSection<A>, previous: WorldStateSnapshot): PriorSection<A> {
  if (!Object.hasOwn(previous, section.id)) return { kind: 'absent' };
  const decoded = decode(section, previous[section.id]);
  return decoded === undefined ? { kind: 'unknown' } : { kind: 'known', value: decoded };
}

function priorValue<A>(prior: PriorSection<A>): A | undefined {
  return prior.kind === 'known' ? prior.value : undefined;
}

function decode<A>(section: WorldStateSection<A>, stored: unknown): A | undefined {
  try {
    return Schema.decodeUnknownSync(section.codec)(stored);
  } catch {
    return undefined;
  }
}

function equals<A>(section: WorldStateSection<A>, left: A, right: A): boolean {
  const encode = Schema.encodeSync(section.codec);
  return JSON.stringify(encode(left)) === JSON.stringify(encode(right));
}
