import { Schema } from 'effect';
import { placedCursor } from '../../../../platform/contract/wire/place.js';
import { threadAgentSubject } from '@runlith/agent/permissions/threadSubject';
import { signerPrincipal, type Actor } from '../../../../platform/contract/wire/actor.js';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { compactionChoicesSchema } from '../compactionChoices.js';
import { threadInstructionsResultSchema } from '../instructions.js';
import { limitOf } from '../../../../platform/contract/wire/pageFamily.js';
import { ThreadId } from '../../../../platform/contract/wire/thread.js';
import { COMPACTION_CHOICES } from '../pages.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';

const threadSubject = (kind: 'read' | 'write', threadId: string, actor: Actor) =>
  actor.kind !== 'operator' ? [{ kind, value: threadAgentSubject(signerPrincipal(actor), threadId) }] : [];

const { status: _status, ...instructionFields } = threadInstructionsResultSchema.fields;

const refreshed = { threadId: ThreadId, ...instructionFields };

export const CONTEXT_OPERATIONS = {
  refresh_thread_instructions: operation('refresh_thread_instructions', {
    approval: ASKS_IN_REVIEW,
    doors: { http: 'perform' },
    tool: { capability: 'threads' },
    callers: 'any',
    subject: 'none',
    waits: [],
    lifetimes: [],
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({ updated: refreshed, current: refreshed }),
    meaning:
      "Rebuild one thread from its current agent definition — overlay, section edits, capabilities and tools — for its next run; reread the checkout's skills and instruction files, and report where it stands against the project's instructions.",
    grammar:
      'The next run takes the refreshed composition; a run already going keeps its instructions and sources without interruption. A missing definition refuses `agent-not-found`; one that cannot compose refuses `agent-invalid`; either preserves the saved prompt and profile. Unchanged prompt, capabilities and tools answer `current` without writing. Project instructions resolve on every model step: the answer names the delivered snapshot, the entries the next step carries (`pending`) and those withdrawn; `current` describes the saved agent composition. Conversation, agent type, model and authority stay unchanged. Loading a skill remains the run’s explicit act.',
    place: 'project',
    input: Schema.Struct({ threadId: ThreadId }),
    refusals: [
      'not-found',
      'foreign-project',
      'target-no-destination',
      'target-root-unavailable',
      'target-placement-unreadable',
      'agent-invalid',
      'agent-not-found',
    ],
    subjects: (input, _prepared, actor) => threadSubject('write', input.threadId, actor),
    confirmation: (input) => ({ summary: `Refresh the instructions of ${input.threadId}?` }),
    confirmLabel: 'Refresh',
    presentation: {
      running: 'Refreshing a thread’s instructions',
      done: 'Refreshed a thread’s instructions',
    },
  }),

  read_compaction_choices: operation('read_compaction_choices', {
    approval: ASKS_NEVER,
    doors: { http: 'perform' },
    tool: { capability: 'threads' },
    callers: 'any',
    subject: 'head',
    waits: [],
    lifetimes: [],
    effect: 'read',
    identity: 'none',
    answer: arms({ ok: compactionChoicesSchema.fields }),
    meaning:
      "Who would summarize one thread's compaction if it were taken now, and every model that could instead: the verdict the operator's rule and chain reach, the chain with each member's spendability, the thread's own model, and the other text models of the catalog — each with the input it would read, the passes it would fold in, and whose quota pays.",
    grammar: `\`resolved\` is the verdict a compaction naming no summarizer reaches in this state: \`own\` (the thread's own model — rule never, an empty chain, or a warm cache under when-cold), \`chain\` (the first spendable member, with what was skipped) or \`none\` (nothing spendable, which a compaction refuses \`no-summarizer\` rather than spend the thread's own model). The compaction runs the same resolution when it is taken, so a verdict read here can move with the cache and the quota before then.
\`warmth\` is \`running\` while a run holds the thread — a compaction it takes meets a warm cache — else the thread's cache verdict. A row's \`skip\` says why it is not spendable now and until when, where the allowance table knows; \`estimate\` is null for a row that was not estimated — one that folds in its own session or stands past the estimated set; \`estimate.passes\` is how many summary requests fold the covered history under that row's window, null where one message cannot fit beside its request.
\`folds\` says where that row's summary is made when it is named: \`session\` — the thread's own vendor session folds its context, so no account of ours is spent, no quota judges the row and it carries no estimate — else \`core\`, which the server calls and the allowance table judges. A row answers what naming it yourself costs; \`resolved\` answers what the rule and the chain reach on their own, and a chain whose member the server cannot call is skipped there however that row is named.
\`chain\` and \`own\` are answered whole; \`others\` — every callable text model outside them — pages by \`limit\` and \`cursor\` with its total.`,
    place: 'project',
    input: Schema.Struct({
      threadId: ThreadId,
      limit: limitOf(COMPACTION_CHOICES),
      cursor: placedCursor,
    }),
    refusals: ['not-found', 'foreign-project', 'bad-cursor', 'cursor-stale', 'harness-contract', 'provider-not-installed'],
    confirmation: (input) => ({ summary: `Read who would summarize ${input.threadId}?` }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading who would summarize a compaction',
      done: 'Read who would summarize a compaction',
      many: (count) => `Read ${count} compaction choices`,
    },
    subjects: (input, _prepared, actor) => threadSubject('read', input.threadId, actor),
  }),
};

export type ContextOperationId = keyof typeof CONTEXT_OPERATIONS;
export const CONTEXT_OPERATION_IDS = Object.keys(CONTEXT_OPERATIONS) as readonly ContextOperationId[];
