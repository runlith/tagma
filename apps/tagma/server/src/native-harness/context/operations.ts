import { Effect } from 'effect';
import { type ModulePresentation, said, saidLines, UNVOICED } from '../../platform/contract/service/presentation.js';
import type { CompactionChoice } from '../contract/wire/compactionChoices.js';
import { threadCalledDisplay } from '../../threads/contract/wire/called.js';
import type { DeclaredAnswer } from '../../platform/contract/wire/operation.js';
import { body, type OperationPair, pair } from '../../platform/contract/service/body.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { CompactionChoices } from '../contract/service/compaction.js';
import { ThreadInstructions } from '../contract/service/context.js';
import { CONTEXT_OPERATION_IDS, CONTEXT_OPERATIONS as OPS, type ContextOperationId } from '../contract/wire/operations/context.js';
import { declaredRefusals } from '../../threads/refusalAnswers.js';

type Refreshed = DeclaredAnswer<(typeof OPS)['refresh_thread_instructions']['answer']>;

const refreshedText = (answer: Refreshed): string => {
  const { delivered, current, pending, withdrawn } = answer.instructions;
  return [
    `${answer.status === 'updated' ? 'refreshed' : 'current'}: ${answer.threadId}`,
    ...answer.sources.rejected.map((entry) => `unusable: ${entry.path} (${entry.reason})`),
    `delivered: ${delivered === null ? 'none — the next model step carries the whole current set' : `${delivered.entries} entries for ${delivered.audience}`}`,
    `current: ${current.entries} entries for ${current.audience}`,
    ...(delivered === null ? [] : pending.map((entry) => `pending: ${entry.kind} ${entry.source} (${entry.scope})`)),
    ...withdrawn.map((entry) => `withdrawn: ${entry.kind} ${entry.source} (${entry.scope})`),
  ].join('\n');
};

type Choices = DeclaredAnswer<(typeof OPS)['read_compaction_choices']['answer']>;

const spendWords = (choice: CompactionChoice): string =>
  choice.spendable
    ? 'spendable'
    : choice.skip === null
      ? 'not spendable'
      : `not spendable: ${choice.skip.reason}${choice.skip.until === null ? '' : ` until ${choice.skip.until}`}`;

const choiceLine = (choice: CompactionChoice): string =>
  `${choice.provider}/${choice.model}${choice.reasoning === null ? '' : ` ${choice.reasoning}`} (${choice.label}) — ${spendWords(choice)}, pays ${choice.pays.provider} ${choice.pays.account ?? 'default account'}, ${
    choice.folds === 'session'
      ? 'folded by its own session'
      : choice.estimate === null
        ? 'not estimated'
        : choice.estimate.passes === null
          ? `reads ${Math.round(choice.estimate.inputTokens / 1000)}k tokens, and one message does not fit beside its request`
          : `reads ${Math.round(choice.estimate.inputTokens / 1000)}k tokens in ${choice.estimate.passes} pass${choice.estimate.passes === 1 ? '' : 'es'}`
  }`;

function* choicesLines(answer: Extract<Choices, { readonly status: 'ok' }>): Generator<string> {
  const { resolved, warmth, others } = answer;
  yield `${answer.threadId}: rule ${answer.rule}, cache ${warmth.state}${warmth.invalidatedBy === null ? '' : ` (invalidated by ${warmth.invalidatedBy})`}; others ${others.shown} of ${others.total}${
    others.next === null ? '' : `, continue with cursor "${others.next}"`
  }`;
  yield `would summarize: ${resolved.kind} (${resolved.reason})${resolved.choice === null ? ' — nothing spendable' : ` — ${choiceLine(resolved.choice)}`}`;
  for (const skip of resolved.skipped)
    yield `skipped: ${skip.provider}/${skip.model} ${skip.reason}${skip.until === undefined ? '' : ` until ${skip.until}`}`;
  if (answer.own !== null) yield `own: ${choiceLine(answer.own)}`;
  if (answer.chain.length === 0) yield 'chain: none';
  for (const choice of answer.chain) yield `chain: ${choiceLine(choice)}`;
  for (const choice of others.rows) yield `other: ${choiceLine(choice)}`;
}

export const CONTEXT_PRESENTATION: ModulePresentation = { operations: CONTEXT_OPERATION_IDS, called: threadCalledDisplay };

export const CONTEXT_PAIRS: { readonly [K in ContextOperationId]: OperationPair<(typeof OPS)[K]> } = {
  refresh_thread_instructions: pair(
    OPS.refresh_thread_instructions,
    body(OPS.refresh_thread_instructions, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const refreshed = yield* declaredRefusals(OPS.refresh_thread_instructions)(
          (yield* ThreadInstructions).refresh(input.threadId, call.project.id),
        );
        return { status: refreshed.status, threadId: input.threadId, sources: refreshed.sources, instructions: refreshed.instructions };
      }),
      voice: said(refreshedText),
    }),
  ),
  read_compaction_choices: pair(
    OPS.read_compaction_choices,
    body(OPS.read_compaction_choices, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const read = yield* declaredRefusals(OPS.read_compaction_choices)(
          (yield* CompactionChoices).read(input.threadId, call.project.id, {
            limit: input.limit,
            cursor: input.cursor,
          }),
        );
        return { status: 'ok' as const, ...read };
      }),
      voice: saidLines((answer: Choices) => (answer.status === 'ok' ? choicesLines(answer) : UNVOICED)),
    }),
  ),
};
