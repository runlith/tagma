import { Data, Effect } from 'effect';
import { uuidv7 } from 'uuidv7';
import { SPOKEN_LENGTH } from '../../../platform/contract/wire/ids.js';

export function mintBlockId(): string {
  return uuidv7();
}

export function mintedAt(id: string): Date | null {
  const match = /^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-/i.exec(id);
  return match === null ? null : new Date(Number.parseInt(`${match[1]}${match[2]}`, 16));
}

export function spokenIds(ids: Iterable<string>): Map<string, string> {
  const entries = [...new Set(ids)].map((id) => ({ id, compact: id.replaceAll('-', '') }));
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const suffix = entry.compact.slice(-SPOKEN_LENGTH);
    const group = groups.get(suffix) ?? [];
    group.push(entry);
    groups.set(suffix, group);
  }
  const out = new Map<string, string>();
  for (const group of groups.values()) {
    for (const entry of group) {
      let length = SPOKEN_LENGTH;
      let extended = entry.compact.slice(-length);
      while (length < entry.compact.length && group.some((other) => other.id !== entry.id && other.compact.endsWith(extended))) {
        length += 4;
        extended = entry.compact.slice(-length);
      }
      out.set(entry.id, extended);
    }
  }
  return out;
}

export class SpokenIdError extends Data.TaggedError('SpokenIdError')<{
  readonly reason: 'invalid' | 'not-found' | 'ambiguous';
  readonly spoken: string;
  readonly candidates: readonly string[];
}> {}

export function resolveSpokenId(spoken: string, ids: Iterable<string>): Effect.Effect<string, SpokenIdError> {
  const needle = spoken.toLowerCase().replaceAll('-', '');
  if (needle === '' || !/^[0-9a-f]+$/.test(needle)) {
    return Effect.fail(new SpokenIdError({ reason: 'invalid', spoken, candidates: [] }));
  }
  const candidates: string[] = [];
  for (const id of ids) {
    if (id.replaceAll('-', '').endsWith(needle)) candidates.push(id);
  }
  if (candidates.length === 1) return Effect.succeed(candidates[0] as string);
  if (candidates.length === 0) return Effect.fail(new SpokenIdError({ reason: 'not-found', spoken, candidates: [] }));
  return Effect.fail(new SpokenIdError({ reason: 'ambiguous', spoken, candidates }));
}
