import type { Checker, EngineRow } from '@tagma/server/enforcement/contract/wire/engines';
import { timeAgo } from '$lib/shared/time.js';
import { Refusal } from '$lib/wire/refusal.js';

export type Strictness = NonNullable<EngineRow['strictness']>;

type Trigger = EngineRow['on'][number];

export const STRICTNESS_WORD: Readonly<Record<Strictness, string>> = {
  gate: 'rejects commits',
  watch: 'warns',
  note: 'only notes',
};

export const STRICTNESS_LABEL: Readonly<Record<Strictness, string>> = {
  gate: 'Blocks',
  watch: 'Warns',
  note: 'Text',
};

export const DELIVERY_WORD: Readonly<Record<EngineRow['delivery'], string>> = {
  prompt: 'in every agent’s instructions',
  code: 'delivered when an agent reads or writes its code',
};

const ACT_WORD: Readonly<Record<string, string>> = {
  submit_work: 'landing',
  merge_worktree: 'merge',
  commit_checkout: 'commit',
};

const actOf = (op: string): string => ACT_WORD[op] ?? op.replaceAll('_', ' ');

export const triggersSaid = (on: readonly Trigger[]): string => {
  if (on.length === 0) return 'only when an agent checks the rules';
  const phase = (which: Trigger['phase']) => on.filter((one) => one.phase === which).map((one) => actOf(one.op));
  const before = phase('before');
  const after = phase('after');
  return [
    ...(before.length === 0 ? [] : [`before every ${before.join(' and ')}`]),
    ...(after.length === 0 ? [] : [`after every ${after.join(' and ')}`]),
  ].join(', ');
};

export const actSaid = (op: string): string => actOf(op);

export const CONCERN_HEADING: Readonly<Record<string, string>> = {
  imports: 'Who imports whom',
  loading: 'What loads where',
  code: 'How code is written',
  size: 'Size',
};

export const LINTERS_HEADING = 'External linters';

export const TEXT_HEADING = 'Followed as text';

export const UNREAD_HEADING = 'Cannot run';

export const headingOf = (checker: Checker | null): string => {
  if (checker === null) return TEXT_HEADING;
  if (checker.kind === 'unread') return UNREAD_HEADING;
  return checker.kind === 'linter' ? LINTERS_HEADING : (CONCERN_HEADING[checker.concern] ?? checker.concern);
};

export const checkerName = (checker: Checker): string => {
  switch (checker.kind) {
    case 'builtin':
      return checker.builtin;
    case 'program':
      return checker.name;
    case 'linter':
      return checker.rule === null ? checker.tool : `${checker.tool} ${checker.rule}`;
    case 'unread':
      return 'cannot run';
  }
};

export const checkerKind = (checker: Checker): string => {
  switch (checker.kind) {
    case 'builtin':
      return 'Built into Tagma';
    case 'program':
      return "The project's own inspection";
    case 'linter':
      return 'External linter';
    case 'unread':
      return 'Cannot run';
  }
};

export const placesSaid = (places: readonly string[]): string =>
  places.length === 0 ? 'nothing yet' : places.map((one) => (one === '' ? 'the whole repository' : one)).join(', ');

export const RECENT_MS = 24 * 60 * 60 * 1000;

export type Crossing = { readonly from: string; readonly to: string | null; readonly said: string | null; readonly file: string | null };

export const crossingOf = (fingerprint: string): Crossing => {
  const at = fingerprint.lastIndexOf(' @ ');
  const head = at === -1 ? fingerprint : fingerprint.slice(0, at);
  const file = at === -1 ? null : fingerprint.slice(at + 3);
  const arrow = head.indexOf(' -> ');
  if (arrow === -1) return { from: head, to: null, said: null, file };
  const [to = '', ...said] = head.slice(arrow + 4).split(' ');
  return { from: head.slice(0, arrow), to, said: said.length === 0 ? null : said.join(' '), file };
};

export type Unread = { readonly title: string; readonly detail: string };

export const unreadOf = (what: string, error: unknown): Unread =>
  error instanceof Refusal && error.code === 'unknown-operation'
    ? { title: 'This server is older than the app.', detail: ` It cannot read ${what} yet; restart Tagma to bring up the build that can.` }
    : { title: `The ${what} could not be read.`, detail: error instanceof Error ? ` ${error.message}` : '' };

export const ASK_RULES =
  'Load the rules skill. Read this project and propose rules for its real boundaries — which part may not depend on which, how large a file may grow, where the environment may be read. For each, say what it would catch in the code now, and enforce none before I agree.';

export const STARTERS = [
  'domain code does not import UI',
  'no source file over 500 lines',
  'no network call outside the API layer',
] as const;

export const askStarter = (norm: string): string =>
  `Load the rules skill. Make this a rule of the project: "${norm}". Find where it applies here, propose the check and show what it would catch now; enforce it only after I agree.`;

export const askCheck = (rule: string): string =>
  `Load the rules skill. Make rule [[${rule}]] a check: find the inspection that measures it, try it with check_rules over the whole reach and show what it finds before enforcing.`;

export const askFix = (rule: string, count: number): string =>
  `Load the rules skill. ${plural(count, 'violation')} of rule [[${rule}]] got past its check. Remove ${count === 1 ? 'it' : 'them'} in the code and commit.`;

export type Choice = 'keep' | 'fix' | 'leave';

export const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;
