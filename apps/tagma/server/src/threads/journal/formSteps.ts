import { type ThreadFormBase, ThreadFormRefused, type ThreadFormRecord, type ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { sql, type SQL } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { ENTRY_FIELDS, MESSAGE_FIELDS, PAYLOAD_FIELDS } from '../store/fields.js';
import { threadRolloutForm } from '../store/journal.js';

export const formedThread = (threadId: AnySQLiteColumn | SQL, last: string | null): SQL | undefined =>
  last === null
    ? undefined
    : sql`exists (select 1 from ${threadRolloutForm} where ${threadRolloutForm.threadId} = ${threadId}
        and ${threadRolloutForm.refusal} is null and ${threadRolloutForm.publishing} is null and ${threadRolloutForm.step} >= ${last})`;

const NAME = /^\d{14}_[a-z0-9]+(?:_[a-z0-9]+)*$/u;

const STABLE: Readonly<Record<ThreadFormRecord, readonly string[]>> = {
  entry: ENTRY_FIELDS,
  payload: PAYLOAD_FIELDS,
  message: MESSAGE_FIELDS,
  reading: [],
  meta: [],
  inbox: ['id', 'threadId', 'sender', 'kind', 'body.intent', 'state', 'deliveredToRunId', 'closedAt', 'closedBy', 'occurredAt'],
};

const RECORDS = Object.keys(STABLE) as readonly ThreadFormRecord[];

type Held = Readonly<Record<string, unknown>>;

const valueAt = (held: Held, path: string): string | undefined => {
  let at: unknown = held;
  for (const key of path.split('.')) {
    if (typeof at !== 'object' || at === null) return undefined;
    at = (at as Held)[key];
  }
  return at === undefined ? undefined : JSON.stringify(at);
};

const guarded = (step: ThreadFormStep): ThreadFormStep => {
  const forms: Partial<Record<ThreadFormRecord, (held: Held) => Held | null>> = {};
  for (const record of RECORDS) {
    const form = step[record];
    if (form === undefined) continue;
    forms[record] = (held) => {
      const next = form(held);
      if (next === null) return null;
      const moved = STABLE[record].find((path) => valueAt(held, path) !== valueAt(next, path));
      if (moved !== undefined) {
        throw new ThreadFormRefused({
          step: step.name,
          issue: `it changes ${moved}, which queries over many threads read; that change is a schema change of the history table`,
        });
      }
      return next;
    };
  }
  return { name: step.name, samples: step.samples, ...forms };
};

export const JOURNAL_BASE: ThreadFormBase | null = null;

export function journalSteps(
  declared: readonly (readonly ThreadFormStep[])[],
  base: ThreadFormBase | null = JOURNAL_BASE,
): readonly ThreadFormStep[] {
  const named = new Set<string>();
  for (const steps of declared) {
    steps.forEach((step, at) => {
      if (!NAME.test(step.name)) throw new Error(`Form step ${step.name} is not named <yyyymmddhhmmss>_<words>.`);
      if (named.has(step.name)) throw new Error(`Form step ${step.name} is declared twice.`);
      if (base !== null && step.name <= base.step)
        throw new Error(`Form step ${step.name} is folded into the base ${base.step}: delete it.`);
      const before = steps[at - 1];
      if (before !== undefined && before.name > step.name) throw new Error(`Form step ${step.name} is declared after ${before.name}.`);
      named.add(step.name);
    });
  }
  return declared
    .flat()
    .toSorted((one, other) => (one.name < other.name ? -1 : 1))
    .map(guarded);
}
