import { Schema } from 'effect';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';

const operatorOnly = {
  approval: ASKS_NEVER,
  doors: { http: true },
  callers: 'operator',
  subject: 'none',
  place: 'machine',
  graph: 'none',
  waits: [],
  lifetimes: [],
} as const;

export const freshStanding = {
  root: Schema.String,
  release: Schema.NullOr(Schema.String),
  running: Schema.Boolean,
  url: Schema.String,
} as const;

const REFUSALS = ['fresh-no-feed', 'fresh-no-release', 'fresh-unavailable', 'fresh-host'] as const;

export const FRESH_OPERATIONS = {
  open_fresh_world: operation('open_fresh_world', {
    ...operatorOnly,
    meaning:
      'Open the published Tagma release beside this one in a world of its own, as a new user gets it, or start that world over from nothing.',
    grammar:
      'The world stands in ~/.tagma-fresh with a home of its own, so its data, keychain, junction and harness configs are nobody else’s and this server is untouched. While it runs, the act brings its window forward; standing and closed, it opens it again. `over`, `release` or `from` start it over: the running world quits, everything it wrote and what macOS keeps for its bundle are removed, and the release opens on its first launch. Without `release` and `from` the release is the newest the release feed offers; `release` names one the feed lists; `from` is a local `.app`, `.dmg` or release archive. A release taken from the feed is kept, so a start over downloads nothing. `started` is false when the world was already running. It refuses `fresh-no-feed` when this build knows no release feed and neither `from` nor a kept release serves, `fresh-no-release` when the feed lists no such release for this Mac, `fresh-unavailable` when the feed, the download or the archive failed, and `fresh-host` when a step on the Mac failed.',
    input: Schema.Struct({
      over: Schema.optional(Schema.Boolean),
      release: Schema.optional(Schema.String),
      from: Schema.optional(Schema.String),
    }),
    answer: arms({ opened: { ...freshStanding, started: Schema.Boolean } }),
    refusals: [...REFUSALS],
    effect: 'external',
    identity: { key: 'call' },
    subjects: () => [],
    confirmation: () => ({ summary: 'Open the release in a fresh world?' }),
    confirmLabel: 'Open',
    presentation: { running: 'Opening the fresh world', done: 'The fresh world is open' },
  }),
  read_fresh_world: operation('read_fresh_world', {
    ...operatorOnly,
    meaning:
      'Read where the fresh world of the published release stands: its root, the release placed in it, whether it runs and its address.',
    grammar: '`release` is null when no world stands. A read: nothing is written.',
    input: Schema.Struct({}),
    answer: arms({ read: freshStanding }),
    refusals: ['fresh-host'],
    effect: 'read',
    identity: 'none',
    subjects: () => [],
    confirmation: () => ({ summary: 'Read the fresh world?' }),
    confirmLabel: 'Read fresh world',
    presentation: { running: 'Reading the fresh world', done: 'Read the fresh world' },
  }),
};
