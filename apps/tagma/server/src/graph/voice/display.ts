import type { ToolDisplay } from '@runlith/agent/tool/display';
import type { GraphToolAnswer } from '../contract/wire/toolAnswers.js';
import { landedLines } from './answers.js';

export type GraphToolInput = {
  readonly blockId?: string;
  readonly blockIds?: readonly string[];
  readonly specId?: string;
  readonly scopeId?: string;
  readonly oldId?: string;
  readonly withId?: string;
  readonly fromId?: string;
  readonly toId?: string;
  readonly parentId?: string;
  readonly kind?: string;
  readonly path?: string;
  readonly symbol?: string;
  readonly query?: string;
  readonly title?: string;
  readonly type?: string;
  readonly name?: string;
};

function blockSubject(block: { readonly name: string; readonly title: string }): string {
  return block.title ? `${block.name} — ${block.title}` : block.name;
}

function calledOn(input: GraphToolInput): string | undefined {
  const set =
    input.blockIds === undefined || input.blockIds.length === 0
      ? undefined
      : input.blockIds.length === 1
        ? input.blockIds[0]
        : `${input.blockIds[0]} +${input.blockIds.length - 1}`;
  return input.blockId ?? set ?? input.specId ?? input.scopeId ?? input.oldId ?? input.fromId;
}

function sourceSubject(input: GraphToolInput): string | undefined {
  return input.path === undefined ? undefined : `${input.path}${input.symbol === undefined ? '' : `#${input.symbol}`}`;
}

export function graphCalledDisplay(input: GraphToolInput): ToolDisplay {
  const subject =
    calledOn(input) ?? sourceSubject(input) ?? input.name ?? input.type ?? (input.query === undefined ? undefined : `“${input.query}”`);
  return { form: 'none', title: subject };
}

export function graphSettledDisplay(input: GraphToolInput, result: GraphToolAnswer): ToolDisplay {
  if (result.status === 'refused') return graphCalledDisplay(input);
  if ('sync' in result) {
    return {
      form: 'none',
      ...(result.sync.commit === null
        ? { verb: 'The block tree already stood committed' }
        : { title: `as ${result.sync.commit.slice(0, 10)}` }),
      details: result.sync.commit === null ? [] : [{ label: 'files', value: String(result.sync.files) }],
    };
  }
  if ('overview' in result) return { form: 'none', title: 'the project' };
  if ('reads' in result) {
    const one = result.reads.length === 1 ? result.reads[0] : undefined;
    return {
      form: 'none',
      title: one === undefined ? undefined : blockSubject({ name: one.name, title: one.title }),
      facts:
        one === undefined
          ? [{ label: 'blocks', value: String(result.reads.length) }]
          : [...(one.shape.blocks > 1 ? [{ label: 'subtree', value: String(one.shape.blocks) }] : [])],
    };
  }
  if ('page' in result) {
    return {
      form: 'none',
      title: calledOn(input),
      facts: [{ label: 'blocks', value: `${result.shown} of ${result.total}` }],
    };
  }
  if ('events' in result) {
    return { form: 'none', facts: [{ label: 'events', value: String(result.events.length) }] };
  }
  if ('batches' in result) return { form: 'none', facts: [{ label: 'batches', value: String(result.batches.length) }] };
  if ('proposals' in result) {
    return {
      form: 'none',
      facts: [
        { label: result.decided ? 'decided' : 'open', value: String(result.proposals.length) },
        ...(result.conflicts.length === 0 ? [] : [{ label: 'conflicts', value: String(result.conflicts.length) }]),
      ],
    };
  }
  if ('block' in result) {
    return {
      form: 'none',
      title: blockSubject(result.block),
      facts: result.journalUnreadable === undefined ? undefined : [{ label: 'journal', value: `unreadable: ${result.journalUnreadable}` }],
      details: [
        ...(result.journal?.chars === undefined
          ? []
          : [{ label: 'body', value: `${result.journal.chars.from} → ${result.journal.chars.to}` }]),
        ...(result.refsIn === undefined || result.refsIn.length === 0 ? [] : [{ label: 'refs', value: String(result.refsIn.length) }]),
      ],
    };
  }
  if ('blocks' in result) {
    return {
      form: 'none',
      title: input.query === undefined ? undefined : `“${input.query}”`,
      facts: [{ label: 'found', value: `${result.blocks.length} of ${result.total}` }],
    };
  }
  if ('tasks' in result) return { form: 'none', facts: [{ label: 'ready', value: String(result.tasks.length) }] };
  if ('gauges' in result) return { form: 'none', facts: [{ label: 'gauges', value: `${result.shown} of ${result.total}` }] };
  if ('source' in result) {
    const { ref, symbol } = result.source;
    return { form: 'none', title: `${ref}${symbol === null ? '' : `#${symbol}`}` };
  }
  if ('landed' in result) {
    const subject = sourceSubject(input) ?? calledOn(input);
    return {
      form: 'text',
      title: subject,
      text: landedLines(result.landed).join('\n'),
      details: [{ label: 'landed', value: result.landed.acts.map((act) => act.op).join(', ') }],
    };
  }
  const subject = sourceSubject(input) ?? calledOn(input);
  return { form: 'none', title: subject };
}
