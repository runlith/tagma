import { Schema } from 'effect';
import { ThreadId } from '../../../platform/contract/wire/thread.js';

const clockTerms = {
  createdSince: Schema.optional(Schema.String),
  createdBefore: Schema.optional(Schema.String),
  updatedSince: Schema.optional(Schema.String),
  updatedBefore: Schema.optional(Schema.String),
  readerSince: Schema.optional(Schema.String),
  readerBefore: Schema.optional(Schema.String),
  archivedSince: Schema.optional(Schema.String),
  archivedBefore: Schema.optional(Schema.String),
};

export const threadClockTerms = clockTerms;

export const threadSelectionQuerySchema = Schema.Struct({
  set: Schema.optional(Schema.String),
  state: Schema.optional(Schema.String),
  ids: Schema.optional(Schema.String),
  plugin: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  of: Schema.optional(Schema.String),
  reach: Schema.optional(Schema.String),
  models: Schema.optional(Schema.String),
  providers: Schema.optional(Schema.String),
  ranSince: Schema.optional(Schema.String),
  ranBefore: Schema.optional(Schema.String),
  activeSince: Schema.optional(Schema.String),
  activeBefore: Schema.optional(Schema.String),
  ...clockTerms,
  limit: Schema.optional(Schema.String),
  before: Schema.optional(Schema.String),
});
export type ThreadSelectionQuery = typeof threadSelectionQuerySchema.Type;

const SWEEP_WINDOWS = [
  ['createdSince', 'created since'],
  ['createdBefore', 'created before'],
  ['updatedSince', 'moved since'],
  ['updatedBefore', 'no movement since'],
  ['readerSince', 'last read since'],
  ['readerBefore', 'last read before'],
  ['archivedSince', 'put away since'],
  ['archivedBefore', 'put away before'],
] as const;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
function instantWorded(raw: string, now: Date): string {
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return raw;
  const apart = Math.abs(now.getTime() - at.getTime());
  const distance =
    apart < MINUTE
      ? 'now'
      : (() => {
          const [count, unit] =
            apart < HOUR
              ? [Math.round(apart / MINUTE), 'minute']
              : apart < DAY
                ? [Math.round(apart / HOUR), 'hour']
                : [Math.round(apart / DAY), 'day'];
          const measure = `${count} ${unit}${count === 1 ? '' : 's'}`;
          return at.getTime() <= now.getTime() ? `${measure} ago` : `in ${measure}`;
        })();
  const day = at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: at.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
  const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day}, ${time} · ${distance}`;
}
export function sweepFacts(input: Record<string, unknown>) {
  const now = new Date();
  return SWEEP_WINDOWS.flatMap(([term, label]) => {
    const raw = input[term];
    return typeof raw === 'string' ? [{ label, value: instantWorded(raw, now) }] : [];
  });
}

export type ThreadSelectorInput = {
  readonly ids?: readonly string[];
  readonly plugin?: string;
  readonly title?: string;
  readonly of?: string;
  readonly reach?: string;
  readonly set?: string;
  readonly state?: string;
  readonly models?: readonly string[];
  readonly providers?: readonly string[];
  readonly ranSince?: string;
  readonly ranBefore?: string;
  readonly activeSince?: string;
  readonly activeBefore?: string;
  readonly createdSince?: string;
  readonly createdBefore?: string;
  readonly updatedSince?: string;
  readonly updatedBefore?: string;
  readonly readerSince?: string;
  readonly readerBefore?: string;
  readonly archivedSince?: string;
  readonly archivedBefore?: string;
};

export const THREAD_INSTANT = Schema.String.check(Schema.isMinLength(1)).annotate({
  description: 'An ISO instant, e.g. 2026-08-25T00:00:00Z.',
});

export const THREAD_SELECTOR = {
  ids: Schema.optional(Schema.Array(ThreadId)).annotate({ description: 'Exactly these threads.' }),
  plugin: Schema.optional(Schema.String.check(Schema.isMinLength(1))).annotate({
    description:
      'The threads whose bindings name this plugin. Without `plugin` or `ids`, the general list leaves out the threads of every plugin that runs in their project and does not list its threads (`contributes.threads.listed`).',
  }),
  title: Schema.optional(Schema.String.check(Schema.isMinLength(1))).annotate({
    description: "Part of the thread's title or of its agent's team name — either half of the list's `title (name)`.",
  }),
  of: Schema.optional(ThreadId).annotate({ description: 'The thread whose relations are selected.' }),
  reach: Schema.optional(Schema.Literals(['children', 'descendants', 'tree'])),
  set: Schema.optional(Schema.Literals(['live', 'archived', 'all'])),
  state: Schema.optional(Schema.Literals(['running', 'stalled'])).annotate({
    description:
      'running: a run or a CLI session is going. stalled: a native run, not waiting on a question, with no durable movement for longer than the widest gap its bounds allow — its heartbeat proves only that its process lives.',
  }),
  models: Schema.optional(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
  providers: Schema.optional(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
  ranSince: Schema.optional(THREAD_INSTANT),
  ranBefore: Schema.optional(THREAD_INSTANT),
  activeSince: Schema.optional(THREAD_INSTANT).annotate({
    description: 'An activity of the thread opened at or after this instant: "what happened in this project in the last five minutes".',
  }),
  activeBefore: Schema.optional(THREAD_INSTANT),
  createdSince: Schema.optional(THREAD_INSTANT),
  createdBefore: Schema.optional(THREAD_INSTANT),
  updatedSince: Schema.optional(THREAD_INSTANT).annotate({
    description: 'Durable movement at or after this instant — a turn, a run, a rename.',
  }),
  updatedBefore: Schema.optional(THREAD_INSTANT).annotate({
    description: 'No durable movement since this instant: "idle for three days" is now minus three days here.',
  }),
  readerSince: Schema.optional(THREAD_INSTANT),
  readerBefore: Schema.optional(THREAD_INSTANT),
  archivedSince: Schema.optional(THREAD_INSTANT),
  archivedBefore: Schema.optional(THREAD_INSTANT),
} as const;

export const THREAD_SELECTOR_GRAMMAR = `The live set unless \`set\` names another. Clocks are ISO instants, \`since\` inclusive and \`before\` exclusive: created, updated (durable movement), reader (the last reader message), archived. An archived range on the live set refuses \`selection-shape\`.
\`state\` selects what is going now: \`running\`, or \`stalled\` — measured at the moment the selection opens.
\`activeSince\`/\`activeBefore\` select threads with an activity opened in that window, read from the activity record and so only as far back as it is kept.
\`models\`/\`providers\`/\`ranSince\`/\`ranBefore\` match a RUN, all of them against the same run, so a thread moved to another model since is still selected by the work it did. \`of\` with \`reach\` selects lineage regardless of archive state: \`children\` one hop, \`descendants\` everything below it and not itself, \`tree\` the whole spawn tree including its root.`;
