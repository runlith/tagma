import type { ToolDisplay } from '@runlith/agent/tool/display';
import { Effect } from 'effect';
import { type ModulePresentation, UNVOICED } from '../platform/contract/service/presentation.js';
import type { HoldingLines, NobodyWhy, UnprovenReason } from './contract/wire/holdings.js';
import type { ThreadEntry } from './contract/wire/threadChanges.js';
import type { ChangesAnswer } from './contract/wire/changes.js';
import { type Holder, holderKey } from '../workspace/contract/wire/checkout.js';

type Changes = ChangesAnswer & { readonly status: 'ok' };

const changesOf = (answer: unknown): Changes | null =>
  typeof answer === 'object' && answer !== null && 'turns' in answer ? (answer as Changes) : null;

const counted = (lines: HoldingLines): string => (lines === 'unweighed' ? 'unweighed' : `+${lines.added}/−${lines.removed}`);

const whoOf = (holder: Holder, self: string | null): string => {
  const key = holderKey(holder);
  return key === self ? `this session · ${key}` : key;
};

const whyOf = (why: NobodyWhy): string =>
  why.kind === 'external'
    ? 'written outside the record'
    : why.kind === 'steps'
      ? `commit steps of ${why.commit.slice(0, 7)}`
      : why.kind === 'released'
        ? `released by ${why.thread}: ${why.reason}`
        : `changed while commands ran that could each have written it, so none is its author: ${why.windows.map((one) => `${one.thread} (${one.team === null ? one.reason : `${one.reason} of ${one.team}`})`).join(', ')}`;

const unprovenOf = (reason: UnprovenReason): string =>
  reason.kind === 'opaque'
    ? `opaque ${reason.side}${reason.row === null ? '' : ` at recorded write ${reason.row}`}: ${reason.cause}`
    : reason.kind === 'unread'
      ? `${reason.side} unread: ${reason.cause}`
      : reason.kind === 'worker'
        ? `worker: ${reason.cause}`
        : reason.kind;

const holdingLine = (one: Changes['holdings'][number], self: string | null): string => {
  const { holding } = one;
  const head = `${holding.path}${holding.from === null ? '' : ` (from ${holding.from})`} · ${holding.git ?? 'as HEAD'}`;
  const debts = one.debts.length === 0 ? '' : ` · owed to the steps of ${one.debts.map((commit) => commit.slice(0, 7)).join(', ')}`;
  if (holding.verdict.verdict === 'unknown')
    return `${head} · unproven (${unprovenOf(holding.verdict.reason)}) · recorded writers: ${holding.verdict.writers.map((writer) => whoOf(writer, self)).join(', ') || 'nobody recorded'}${debts}`;
  const hands = holding.verdict.hands.map(
    (hand) =>
      `${whoOf(hand.holder, self)} +${hand.added}/−${hand.removed}${hand.writing ? ' writing' : ''}${hand.retired ? ' retired' : ''}`,
  );
  const nobody = holding.verdict.nobody.map((one) => `nobody +${one.added}/−${one.removed} (${whyOf(one.why)})`);
  return `${head} · ${[...hands, ...nobody].join(' · ') || 'no line differs from HEAD'}${debts}`;
};

const entryLine = (entry: ThreadEntry, self: string | null): string => {
  if (entry.section === 'unproven')
    return `  unproven · ${entry.path} · ${unprovenOf(entry.reason)} · recorded writers: ${entry.writers.map((writer) => whoOf(writer, self)).join(', ')}`;
  if (entry.section === 'outside') return `  outside git · ${entry.path} · ${counted(entry.lines)}${entry.writing ? ' · writing' : ''}`;
  const others = entry.others.map((one) => `${holderKey(one.holder)}${one.retired ? ' (retired)' : ''}`);
  return `  ${entry.path}${entry.from === null ? '' : ` (from ${entry.from})`} · ${entry.git ?? 'as HEAD'} · ${counted(entry.lines)}${entry.writing ? ' · writing' : ''}${others.length === 0 ? '' : ` · beside ${others.join(', ')}`}${entry.nobody ? ' · beside nobody’s lines' : ''}`;
};

const stateWord = (state: Changes['checkouts'][number]['state']): string =>
  state.kind === 'stale'
    ? `stale: ${state.reason}`
    : state.kind === 'opening'
      ? `opening, ${state.paths} paths unjudged`
      : state.kind === 'judging'
        ? `judging ${state.paths} paths`
        : 'current';

function changesText(answer: Changes): string {
  const shown =
    answer.checkouts.reduce((sum, checkout) => sum + Math.max(1, checkout.entries.length), 0) +
    answer.turns.length +
    answer.holdings.length +
    answer.unattributed.length;
  const footer =
    answer.next === null && answer.total === shown
      ? []
      : [`showing ${shown} of ${answer.total}${answer.next === null ? '' : ` · next: read_changes(cursor="${answer.next}")`}`];
  const unattributed =
    answer.unattributed.length === 0
      ? []
      : [
          `unattributed command-window observations (${answer.totals.unattributed} total; the named thread is not a proven author):`,
          ...answer.unattributed.map(
            (one) => `${one.checkout} · ${one.path} · ${one.reason}${one.team === null ? '' : ` of team ${one.team}`} · ${one.thread}`,
          ),
        ];
  if (answer.path !== null) {
    return [
      answer.totals.holdings === 0 ? `No judged path stands under ${answer.path}.` : `judged paths of ${answer.path}:`,
      ...answer.holdings.map((one) => holdingLine(one, answer.self)),
      ...unattributed,
      ...footer,
    ].join('\n');
  }
  const who = answer.agent ?? 'this session';
  const held = answer.held ?? { paths: 0, unproven: 0 };
  const lines = [
    `${who} holds ${held.paths} path${held.paths === 1 ? '' : 's'}${held.unproven === 0 ? '' : ` and ${held.unproven} unproven`}:`,
  ];
  for (const checkout of answer.checkouts) {
    lines.push(`${checkout.root}${checkout.branch === null ? '' : ` (${checkout.branch})`} · ${stateWord(checkout.state)}`);
    lines.push(...checkout.entries.map((entry) => entryLine(entry, answer.self)));
  }
  if (answer.commits.length > 0)
    lines.push(
      `commits HEAD reaches${answer.moreCommits ? ', newest first, more stand' : ''}:`,
      ...answer.commits.map(
        (commit) => `  ${commit.sha.slice(0, 7)} ${commit.subject} · ${commit.files} file${commit.files === 1 ? '' : 's'}`,
      ),
    );
  if (answer.ends.length > 0) lines.push(`lines that left: ${answer.ends.map((end) => `${end.reason} ${end.paths}`).join(', ')}`);
  lines.push(
    ...(answer.totals.turns === 0
      ? ['no turn of it wrote a path in this project']
      : answer.turns.length === 0
        ? []
        : ['paths its turns wrote, newest first:']),
    ...answer.turns.map(
      (turn) =>
        `  ${turn.runId === null ? 'no run' : `run ${turn.runId}`} · ${turn.path} · ${turn.state}${turn.commit === null ? '' : ` ${turn.commit.slice(0, 7)}`}${turn.reason === null ? '' : ` (${turn.reason})`}`,
    ),
    ...unattributed,
    ...footer,
  );
  return lines.join('\n');
}

function changesDisplay(result: Changes): ToolDisplay {
  return {
    form: 'none',
    title: result.path ?? undefined,
    facts:
      result.path !== null
        ? [{ label: 'paths', value: String(result.holdings.length) }]
        : [{ label: 'held', value: String(result.held?.paths ?? 0) }],
  };
}

export const CHANGES_PRESENTATION: ModulePresentation = {
  operations: ['read_changes'],
  voice: (answer) => {
    const changes = changesOf(answer);
    return Effect.succeed(changes === null ? UNVOICED : changesText(changes));
  },
  called: (input) => ({ form: 'none', title: typeof input.path === 'string' ? input.path : undefined }),
  settled: (_input, answer) => {
    const changes = changesOf(answer);
    return changes === null ? undefined : changesDisplay(changes);
  },
};
