import { toolPageText } from '@runlith/agent/tool/page';
import { refusalLines } from '@runlith/agent/tool/refusal';
import { TITLE_FAILURES } from '../contract/wire/titles.js';
import type { ThreadToolAnswer } from '../contract/wire/evidenceInput.js';
import type { RolloutRepair, ThreadRolloutDisagreement } from '../contract/wire/evidence.js';
import type { ThreadListRow } from '../contract/wire/list.js';
import { conversationWindowsText, evidenceText, expandedText, threadFactsLine, threadShapeText } from './threadText.js';

const rowLine = (row: ThreadListRow): string =>
  `${row.id} [${row.life}] ${row.title}${row.name === null ? '' : ` (${row.name})`} · ${row.agentId}${row.parentThreadId === null ? '' : ` · under ${row.parentThreadId}`} · set ${row.provider}/${row.model ?? '—'} · ${row.updatedAt}${row.archivedAt === null ? '' : ' · archived'}`;

export function threadToolText(result: ThreadToolAnswer): string | null {
  if (result.status === 'refused') return refusalLines(result).join('\n');
  if (result.status === 'switched') {
    return `delegation ${result.delegation} for ${result.threadId}${result.own ? '' : ' (inherited)'}, decided by ${result.decidedBy}`;
  }
  if (result.status === 'started') return `continued: run ${result.runId} started`;
  if (result.status === 'already-running') return `already running: ${result.runId}`;
  if (result.status === 'archived') return `archived: ${result.threadId} and everything spawned under it left the list`;
  if (result.status === 'unarchived') return `brought back: ${result.threadId} and what was put away with it`;
  if (result.status === 'pinned') return `pinned: ${result.threadId} stands at the top of the list until it is released`;
  if (result.status === 'unpinned') return `unpinned: ${result.threadId} took the place its reader clock earned`;
  if (result.status === 'swept' || result.status === 'restored') {
    const verb = result.status === 'swept' ? 'archived' : 'brought back';
    return [
      `${verb} ${result.moved.length} thread${result.moved.length === 1 ? '' : 's'}`,
      ...result.moved.map((id) => `  ${id}`),
      ...result.working.map((row) => `left working: ${row.threadId} (run ${row.runId})`),
    ].join('\n');
  }
  if ('threads' in result) {
    const set = result.set === 'archived' ? 'archived threads' : result.set === 'all' ? 'threads of either set' : 'threads';
    return toolPageText({
      rows: result.threads.map((row) => ({ label: threadFactsLine(row) })),
      total: result.total,
      order: result.set === 'archived' ? 'newest put away first' : 'newest movement first',
      next:
        result.cursor === null ? undefined : `list_threads(cursor="${result.cursor}"${result.set === 'live' ? '' : `, set=${result.set}`})`,
      empty: `no ${set} in this project`,
    });
  }
  if (result.status === 'rows') {
    return toolPageText({
      rows: result.rows.map((row) => ({ label: rowLine(row) })),
      total: result.total,
      order: 'newest movement first',
      next:
        result.before === null
          ? undefined
          : `list_threads with cursor="${result.before}", preserving this call's selection, set and shape="rows"`,
      empty: 'no threads in this project',
    });
  }
  if ('rollout' in result) return threadRolloutText(result.rollout);
  if ('repaired' in result) return threadRolloutRepairText(result.repaired);
  if ('shape' in result) return threadShapeText(result.shape);
  if ('evidence' in result) return evidenceText(result.evidence);
  if ('expanded' in result) return expandedText(result.expanded);
  if (result.status === 'conversation') return conversationWindowsText(result.windows);
  if (result.status === 'answered') return `answered: ${result.threadId} took "${result.value}" (run ${result.runId})`;
  if (result.status === 'cancelled') return `cancelled: the standing ask on ${result.threadId} ended unanswered (run ${result.runId})`;
  if (result.status === 'deleted') return `deleted: ${result.threadId} is gone, with everything spawned under it`;
  if ('outcome' in result) {
    return [
      result.title === null ? `${result.status}: ${result.threadId} was not named` : `named: ${result.threadId} — ${result.title}`,
      result.reason ? TITLE_FAILURES[result.reason] : undefined,
      result.source ? `source: ${result.source}${result.freshReason ? ` (${result.freshReason})` : ''}` : undefined,
      result.attemptId ? `attempt: ${result.attemptId}` : undefined,
    ]
      .filter(Boolean)
      .join('\n');
  }
  return null;
}

function threadRolloutText(rollout: ThreadRolloutDisagreement): string {
  if (rollout.refusal === null) {
    return rollout.fileForm === 'missing'
      ? `${rollout.threadId}: no projection refusal is recorded; no rollout file stands beside the database.`
      : `${rollout.threadId}: no projection refusal is recorded; the ${rollout.fileForm} rollout was not compared with the rows.`;
  }
  const refusal = rollout.refusal;
  const held = new Map(rollout.rows.map((row) => [row.position, row]));
  const lines = [
    `${rollout.threadId} · ${refusal?.reason} · ${refusal?.message}`,
    `the pass stopped at byte ${refusal?.nextByteOffset} expecting position ${refusal?.nextPosition} · last met ${refusal?.seenAt}`,
    ...(rollout.fileForm === 'missing'
      ? ['the file is gone: only the refusal it left stands']
      : rollout.fileForm === 'compressed'
        ? [`compressed file: ${rollout.path} · this read did not expand its records`]
        : [`file: ${rollout.path}`]),
  ];
  for (const record of rollout.file) {
    const where = `@${record.byteOffset}`;
    const position = record.position === null ? '—' : `#${record.position}`;
    const standing = record.position === null ? undefined : held.get(record.position);
    const rows =
      standing === undefined
        ? record.position === null
          ? ''
          : ' · no row at this position'
        : standing.id === record.id
          ? ` · the rows hold the same record`
          : ` · the rows hold ${standing.id} (${standing.kind})`;
    lines.push(`${where} ${position} ${record.kind}${record.id === null ? '' : ` ${record.id}`}${rows}`);
  }
  if (rollout.bounded) lines.push(`${rollout.file.length} records shown; the file carries more after them`);
  return lines.join('\n');
}

function threadRolloutRepairText(repaired: RolloutRepair): string {
  const { repair, projected } = repaired;
  return [
    `${repair.threadId}: ${repair.records} records rewritten, ${repair.renumbered} renumbered`,
    `the original is kept at ${repair.kept}`,
    projected === null
      ? 'the pass still refuses — read what it disagrees about; nothing was carried into the rows'
      : `the pass carried ${projected} record${projected === 1 ? '' : 's'} into the rows`,
  ].join('\n');
}
