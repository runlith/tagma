import type { ToolDisplay } from '@runlith/agent/tool/display';
import { TITLE_FAILURES } from '../contract/wire/titles.js';
import type { ThreadToolAnswer } from '../contract/wire/evidenceInput.js';
import type { ThreadToolInput } from '../contract/wire/called.js';

export function expandedDisplay(threadId: string | undefined, total: number, missing: number): ToolDisplay {
  return {
    form: 'none',
    title: threadId,
    facts: [
      { label: 'expanded', value: String(total - missing) },
      ...(missing === 0 ? [] : [{ label: 'missing', value: String(missing) }]),
    ],
  };
}

export function threadSettledDisplay(input: ThreadToolInput, result: ThreadToolAnswer): ToolDisplay | undefined {
  if (result.status === 'refused') return undefined;
  if (result.status === 'switched') {
    return {
      form: 'none',
      mutates: true,
      title: result.threadId,
      facts: [
        { label: 'delegation', value: result.delegation },
        { label: 'decided by', value: result.decidedBy },
      ],
    };
  }
  if (result.status === 'started' || result.status === 'already-running') {
    return {
      form: 'none',
      mutates: result.status === 'started',
      title: input.threadId,
      facts: result.status === 'started' ? undefined : [{ label: 'run', value: 'already going' }],
      details: [{ label: 'run', value: result.runId }],
    };
  }
  if (result.status === 'archived' || result.status === 'unarchived') {
    return {
      form: 'none',
      mutates: true,
      verb: result.status === 'unarchived' ? 'Brought a thread back' : undefined,
      title: result.threadId,
      details: [{ label: result.status, value: result.threadId }],
    };
  }
  if (result.status === 'pinned' || result.status === 'unpinned') {
    return {
      form: 'none',
      mutates: true,
      verb: result.status === 'unpinned' ? 'Released a thread from the top' : undefined,
      title: result.threadId,
      details: [{ label: result.status, value: result.threadId }],
    };
  }
  if (result.status === 'swept' || result.status === 'restored') {
    return {
      form: 'none',
      mutates: result.moved.length > 0,
      verb: result.status === 'restored' ? 'Brought threads back' : undefined,
      facts: [
        { label: result.status === 'swept' ? 'archived' : 'brought back', value: String(result.moved.length) },
        ...(result.working.length > 0 ? [{ label: 'left working', value: String(result.working.length) }] : []),
      ],
    };
  }
  if (result.status === 'answered' || result.status === 'cancelled') {
    return {
      form: 'none',
      mutates: true,
      title: result.threadId,
      facts: result.status === 'answered' ? [{ label: 'answered', value: result.value }] : undefined,
      details: result.status === 'answered' ? undefined : [{ label: 'cancelled under run', value: result.runId }],
    };
  }
  if ('threads' in result) {
    return { form: 'none', facts: [{ label: 'threads', value: String(result.threads.length) }] };
  }
  if (result.status === 'rows') {
    return { form: 'none', facts: [{ label: 'threads', value: String(result.rows.length) }] };
  }
  if ('shape' in result) {
    return {
      form: 'none',
      title: `${result.shape.thread.id} — ${result.shape.thread.title}`,
      facts: [
        { label: 'records', value: String(result.shape.entries) },
        { label: 'runs', value: String(result.shape.runs.length) },
      ],
    };
  }
  if ('evidence' in result) {
    const { evidence } = result;
    return {
      form: 'none',
      title: input.threadId,
      facts: [
        { label: evidence.select, value: String(evidence.groups?.length ?? evidence.rows.length) },
        { label: 'over threads', value: String(evidence.over) },
        ...(evidence.coverage.complete ? [] : [{ label: 'more', value: 'a page remains' }]),
        ...(evidence.coverage.unavailable.length === 0
          ? []
          : [{ label: 'unavailable', value: String(evidence.coverage.unavailable.length) }]),
      ],
    };
  }
  if ('repaired' in result) {
    const { repair, projected } = result.repaired;
    return {
      form: 'none',
      mutates: true,
      title: repair.threadId,
      facts: [
        { label: 'renumbered', value: `${repair.renumbered} of ${repair.records}` },
        { label: 'projected', value: projected === null ? 'still refused' : String(projected) },
      ],
    };
  }
  if ('rollout' in result) {
    const { rollout } = result;
    return {
      form: 'none',
      title: rollout.threadId,
      facts:
        rollout.refusal === null
          ? [{ label: 'rollout', value: 'no recorded refusal' }]
          : [
              { label: 'refused', value: rollout.refusal?.reason ?? 'unknown' },
              { label: 'at position', value: String(rollout.refusal?.nextPosition ?? 0) },
              { label: 'records read', value: String(rollout.file.length) },
            ],
    };
  }
  if ('expanded' in result) {
    const missing = result.expanded.filter((held) => 'missing' in held).length;
    return expandedDisplay(input.threadId, result.expanded.length, missing);
  }
  if (result.status === 'deleted') {
    return { form: 'none', mutates: true, title: result.threadId, details: [{ label: 'deleted', value: result.threadId }] };
  }
  if (result.status === 'conversation') {
    const found = result.windows.filter((window) => 'messages' in window).length;
    return {
      form: 'none',
      title: input.threadId,
      facts: [
        { label: 'windows', value: String(found) },
        ...(found === result.windows.length ? [] : [{ label: 'missing', value: String(result.windows.length - found) }]),
      ],
    };
  }
  if ('outcome' in result) {
    return {
      form: 'none',
      mutates: result.status === 'named',
      title: result.threadId,
      facts: [
        { label: result.status, value: result.title ?? result.threadId },
        ...(result.reason ? [{ label: 'reason', value: TITLE_FAILURES[result.reason] }] : []),
      ],
      details: result.source ? [{ label: 'source', value: result.source }] : undefined,
    };
  }
  return undefined;
}
