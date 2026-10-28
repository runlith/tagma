import { toolPageText } from '@runlith/agent/tool/page';
import { refusalLines } from '@runlith/agent/tool/refusal';
import type { GraphToolAnswer } from '../contract/wire/toolAnswers.js';
import type { CallRecorded } from '../contract/wire/callRange.js';
import type { SessionIdentity } from '../../platform/contract/wire/session.js';
import { startLines } from '../../platform/contract/wire/start.js';
import { blockLine, crowdedLine, pageFooter, refsInLine, syncLine, underParent } from './lines.js';
import { blockPageText, payloadLines } from './blockPage.js';
import type { TagReading } from '../contract/wire/tags/reading.js';
import type { GraphReport, IdleSpecAnswer, Moved } from '../contract/wire/answers.js';
import type { FarHold } from '../contract/wire/far.js';
import type { WriterSession } from '../contract/wire/operations/history.js';

const writerLine = (row: WriterSession): string =>
  `${row.id} ${row.thread === null ? `${row.harness}:${row.key}` : `thread ${row.thread}`} · born ${row.createdAt}`;

export const MODEL_OUTLINE_ROWS = 120;

function queryOrderWords(result: object): string | undefined {
  const sort: unknown = 'sort' in result ? result.sort : undefined;
  if (typeof sort !== 'object' || sort === null) return undefined;
  const { by, order } = sort as { readonly by?: unknown; readonly order?: unknown };
  if (by === 'created' && order === 'asc') return 'oldest first';
  if (by === 'created' && order === 'desc') return 'newest first';
  if (by === 'updated' && order === 'asc') return 'least recently touched first';
  if (by === 'updated' && order === 'desc') return 'most recently touched first';
  if (by === 'ended' && order === 'asc') return 'ended longest ago first';
  if (by === 'ended' && order === 'desc') return 'most recently ended first';
  return undefined;
}

const QUEUE_EMPTY = {
  ready_work: 'no ready work',
  read_amendments: 'no open amendments',
  read_amendments_decided: 'nothing decided here',
} as const;

const queueEmpty = (operation: string | undefined, fallback: keyof typeof QUEUE_EMPTY): string =>
  QUEUE_EMPTY[(operation ?? fallback) as keyof typeof QUEUE_EMPTY] ?? QUEUE_EMPTY[fallback];

export function graphText(
  table: TagReading,
  result: GraphToolAnswer & GraphReport,
  identity: SessionIdentity['Service'],
  operation?: string,
): string | null {
  const content = graphContent(table, result, identity, operation);
  if (content === null) return null;
  const lines = [content, ...startLines(result)];
  for (const copy of result.unreachable ?? []) lines.push(`unreachable project ${copy.projectId}: ${refusalLines(copy.error).join('\n')}`);
  for (const failure of result.copyFailures ?? [])
    lines.push(`graph copy ${failure.copy.tree} · checkout ${failure.copy.checkout}: ${refusalLines(failure.error).join('\n')}`);
  if (result.graphCopy !== undefined)
    lines.push(`graph: ${result.graphCopy.tree} · checkout: ${result.graphCopy.checkout} · project: ${result.graphCopy.projectId}`);
  return lines.join('\n');
}

const idleSpecLine = (spec: IdleSpecAnswer): string =>
  `spec ${spec.name} ${spec.title} has no open work left — close_block ${spec.name} if it is built, or name in it what remains`;

const movedLines = (moved: Moved): string[] => [
  `moved ${moved.blocks === 1 ? 'the block' : `${moved.blocks} blocks`} from ${moved.from}${moved.relinked === 0 ? '' : `; ${moved.relinked} edges of other projects now address this graph`}`,
  ...(moved.dropped ?? []).map((relation) => `module relation dropped at the edge of the move: ${relation}`),
  ...(moved.left ?? []).map(
    (one) => `${one.edges === undefined ? 'edges' : `${one.edges} edges`} of ${one.project} still address ${moved.from}: ${one.reason}`,
  ),
];

function graphContent(table: TagReading, result: GraphToolAnswer, identity: SessionIdentity['Service'], operation?: string): string | null {
  if (result.status === 'refused') return refusalLines(result).join('\n');
  if ('sync' in result) return syncLine(result.sync);
  if ('overview' in result)
    return [result.overview, ...(result.crowded ?? []).map(crowdedLine), ...(result.specs ?? []).map(idleSpecLine)].join('\n');
  if ('reads' in result) {
    return result.reads.map((read) => blockPageText(table, read, identity, { outlineRows: MODEL_OUTLINE_ROWS })).join('\n\n');
  }
  if ('page' in result) {
    return [result.page, pageFooter(result.shown, result.total, result.next === null ? undefined : `cursor ${result.next}`)].join('\n');
  }
  if ('events' in result) {
    const rows = result.events.map(
      (row) =>
        `${row.id} ${row.at} ${row.op}${row.blockName === null ? '' : ` ${row.blockName}`}${row.writer === null ? '' : ` ${row.writer}`}`,
    );
    return toolPageText({
      rows: rows.map((label) => ({ label })),
      total: result.total,
      order: 'newest first',
      next: result.next === null ? undefined : `read_events(cursor="${result.next}")`,
      empty: 'no events matched',
    });
  }
  if ('batches' in result) {
    const blocks = new Map(result.blocks.map((block) => [block.name, block]));
    const sessions = new Map(result.sessions.map((session) => [session.id, session]));
    const rows = result.batches.map((batch) => {
      const block = blocks.get(batch.blockName);
      const session = batch.sessionId === null ? undefined : sessions.get(batch.sessionId);
      const writer =
        session === undefined
          ? batch.sessionId === null
            ? 'writer unrecorded'
            : `session ${batch.sessionId}`
          : `session ${session.id} ${session.harness}:${session.key}${session.name === null ? '' : ` (${session.name})`}${session.title === null ? '' : ` · ${session.title}`}`;
      const events = batch.firstEventId === batch.lastEventId ? String(batch.firstEventId) : `${batch.firstEventId}–${batch.lastEventId}`;
      const time = batch.firstTs === batch.lastTs ? batch.firstTs : `${batch.firstTs} → ${batch.lastTs}`;
      const subject =
        batch.blockName === ''
          ? 'block unrecorded'
          : `${batch.blockName}${block === undefined ? '' : ` ${block.title}${underParent(block.parentName)}`}`;
      return `${events} · ${time} · ${subject} · ${writer}\n  ${batch.ops.join(', ')} · ${batch.entries} ${batch.entries === 1 ? 'act' : 'acts'}`;
    });
    const batched = new Set(result.batches.map((batch) => batch.blockName));
    const unbatched = result.blocks.filter((block) => !batched.has(block.name));
    return toolPageText({
      rows: rows.map((label) => ({ label })),
      total: null,
      order: 'newest first',
      next:
        result.nextBefore === null
          ? undefined
          : `read_journal with before=${result.nextBefore}, preserving this call's project, scope and filters`,
      empty: 'no journal acts matched',
      note:
        unbatched.length === 0
          ? undefined
          : unbatched.map((block) => `also named: ${block.name} ${block.title}${underParent(block.parentName)}`).join('\n'),
    });
  }
  if ('sessions' in result && 'total' in result) {
    return toolPageText({
      rows: result.sessions.map((row) => ({ label: writerLine(row) })),
      total: result.total,
      order: 'newest id first',
      next: result.next === null ? undefined : `list_sessions(cursor="${result.next}")`,
      empty: 'no writer sessions on record',
    });
  }
  if ('session' in result) return writerLine(result.session);
  if ('proposals' in result) {
    const fights = result.conflicts.map((fight) => `${fight.a} × ${fight.b} · ${fight.region}`);
    const unread = result.unread.map((one) => `${one.name} · operations unread: ${one.reason}`);
    return toolPageText({
      rows: result.proposals.map((row) => ({
        label: [`${blockLine(table, row)}${underParent(row.parentName)}`, ...payloadLines(table, row)].join('\n'),
      })),
      total: result.total,
      order: 'freshest first',
      next: result.next === null ? undefined : `read_amendments(cursor="${result.next}")`,
      empty: result.decided ? QUEUE_EMPTY.read_amendments_decided : queueEmpty(operation, 'read_amendments'),
      note:
        result.totalConflicts === 0 && unread.length === 0
          ? undefined
          : [
              ...(result.totalConflicts === 0 ? [] : [`fights: ${fights.length} of ${result.totalConflicts} touch this page`, ...fights]),
              ...unread,
            ].join('\n'),
    });
  }
  if ('block' in result) {
    const written = 'refsIn' in result.block && Array.isArray(result.block.refsIn) ? (result.block.refsIn as readonly string[]) : [];
    const refsIn = [...new Set([...(result.refsIn ?? []), ...written])];
    return [
      `${blockLine(table, result.block)}${underParent(result.block.parentName)}`,
      ...(refsIn.length === 0 ? [] : [refsInLine(refsIn)]),
      ...('moved' in result && result.moved !== undefined ? movedLines(result.moved) : []),
      ...('published' in result
        ? (result.published ?? []).map((name) => `already committed: ${name} — those versions stay in the repository's history`)
        : []),
      ...('publishedUnread' in result && result.publishedUnread !== undefined
        ? [`committed files unreadable: ${result.publishedUnread}; the move landed regardless`]
        : []),
      ...('crowded' in result && result.crowded !== undefined ? [crowdedLine(result.crowded)] : []),
      ...(result.debt ?? []).map(
        (debt) =>
          `remaining debt: ${debt.rule} ${debt.title} · ${debt.entries} entries; owner ${result.block.name} ended or was replaced\nreassign: ${debt.reassign}`,
      ),
      ...(result.debtUnreadable ?? []).map((reason) => `remaining debt unreadable: ${reason}`),
      ...(result.specs ?? []).map(idleSpecLine),
      ...(result.warning === undefined ? [] : [`warning: ${result.warning}`]),
    ].join('\n');
  }
  if ('diff' in result) return null;
  if ('blocks' in result) {
    const rows = result.blocks.map((row) => {
      const parentTitle = 'parentTitle' in row ? row.parentTitle : null;
      const line = `${blockLine(table, row)}${underParent('parentName' in row && typeof row.parentName === 'string' ? row.parentName : null)}`;
      return parentTitle == null ? line : `${line} · ${parentTitle}`;
    });
    const cursor = 'next' in result ? result.next : null;
    if (operation === 'search_blocks' || operation === 'query_blocks') {
      return toolPageText({
        rows: rows.map((label) => ({ label })),
        total: result.total,
        order: operation === 'search_blocks' ? 'ranked by tier, newest first within each tier' : (queryOrderWords(result) ?? 'sorted'),
        next: cursor == null ? undefined : `${operation}(cursor="${cursor}")`,
        empty: operation === 'search_blocks' ? 'no blocks match this search' : 'no blocks match this selection',
        note:
          'approximate' in result && result.approximate === true
            ? 'approximate: no block holds these words as written; these hold their nearest spellings'
            : undefined,
      });
    }
    const next = cursor == null ? undefined : `cursor ${cursor}`;
    return [...rows, pageFooter(result.blocks.length, result.total, next)].join('\n');
  }
  if ('tasks' in result) {
    const page = toolPageText({
      rows: result.tasks.map((row) => ({
        label: [
          `${blockLine(table, row)}${underParent(row.parentName)}`,
          `since ${row.updatedAt.slice(0, 10)}`,
          ...(row.author === null ? [] : [`by ${row.author}`]),
          ...(row.holder === undefined ? [] : [`left by ${row.holder}, ${row.standing ?? 'stopped'}: take or end it without asking`]),
          ...(row.workless === true ? ['no open work left: close it once built, or name what remains'] : []),
        ].join(' · '),
      })),
      total: result.total,
      order: 'oldest first',
      next: result.next === null ? undefined : `ready_work(cursor="${result.next}")`,
      empty: queueEmpty(operation, 'ready_work'),
      note:
        result.idle === undefined && result.workless === undefined
          ? undefined
          : [
              ...(result.idle === undefined ? [] : [`${result.idle} in work by a holder that stopped`]),
              ...(result.workless === undefined ? [] : [`${result.workless} open specs with no work left`]),
            ].join(' · '),
    });
    const held: readonly FarHold[] = 'held' in result && Array.isArray(result.held) ? result.held : [];
    return [
      page,
      ...held.map(
        (group) =>
          `held: ${group.code}: ${group.reason} (${group.tasks.join(', ')})\n${group.unblock.map((exit) => `  - ${exit}`).join('\n')}`,
      ),
    ].join('\n');
  }
  if ('gauges' in result) {
    return toolPageText({
      rows: result.gauges.map((label) => ({ label })),
      total: result.total,
      order: 'symbol then block',
      next: result.next === null ? undefined : `read_gauges(cursor="${result.next}")`,
      empty: 'no block sources on this path',
    });
  }
  if ('source' in result) {
    const { kind, ref, symbol } = result.source;
    return `source[${kind}]: ${ref}${symbol ? `#${symbol}` : ''}`;
  }
  if ('landed' in result) return landedLines(result.landed).join('\n');
  const {
    status: _status,
    start: _start,
    graphCopy: _copy,
    copyFailures: _failures,
    unreachable: _unreachable,
    ...answered
  } = result as Record<string, unknown>;
  return Object.keys(answered).length === 0 ? 'ok' : null;
}

export function landedLines(landed: CallRecorded['landed']): string[] {
  return [
    `landed: this call committed at ${landed.at}, before the process died — its answer was lost, its effect was not`,
    ...landed.acts.map((act) => `  ${act.op}${act.blockName === null ? '' : ` ${act.blockName}`}`),
    'read the block for the state it produced; repeating this call would act twice',
  ];
}
