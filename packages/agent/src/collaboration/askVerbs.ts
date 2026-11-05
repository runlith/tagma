import { Schema } from 'effect';
import type { ToolDisplay } from '../tool/display';
import type { ThreadAnswer } from '../thread/storage/inbox';
import { CollaborationText, Named } from './collaborationVerbs';

export const ANSWER_TOOL = 'answer';

export const ANSWER_SOURCE = 'answer';

export const ASK_TOOL = 'ask';

export const ASK_QUESTIONS_MAX = 8;

export const DEFAULT_READER = 'reader';

export const ANSWER =
  'Your final answer to the agent that gave you this question; it ends your work. `text` answers the one question, `evidence` names where each claim stands — `path:line` or a block name — ' +
  'and `complete: false` with `missing` says what you could not establish.';

export const answerInput = Schema.Struct({
  text: CollaborationText.annotate({ description: 'The answer, in the language of the question.' }),
  evidence: Schema.Array(CollaborationText).annotate({
    description: 'Where the claims stand, one `path:line` or block name each; empty only when the answer rests on none.',
  }),
  complete: Schema.Boolean.annotate({ description: 'False when the question is only partly answered.' }),
  missing: Schema.optional(CollaborationText).annotate({ description: 'What stays unanswered, when `complete` is false.' }),
});

export function answerOf(input: typeof answerInput.Type): ThreadAnswer {
  return { evidence: input.evidence, complete: input.complete, missing: input.missing };
}

export const ASK =
  'Put narrow questions about the project to readers and get every answer back in this call: one reader takes one question, they work in parallel, and you continue this step with all the answers, each with its evidence. ' +
  'Ask for facts — how a part is arranged, where something lives, what owns a place, what a contract or decision says — and put independent questions in one call. ' +
  'A reader starts with none of your conversation, so each question stands alone and names what it is about: a path, a symbol, a block. ' +
  'Design, judgement and every change stay with you: ask what you need to know, then decide, and verify only the claims your decision rests on. ' +
  'An entry is `answered`, `partial` with what is missing, or `failed` with its diagnosis.';

export const askInput = Schema.Struct({
  questions: Schema.Array(CollaborationText)
    .check(Schema.isMinLength(1), Schema.isMaxLength(ASK_QUESTIONS_MAX))
    .annotate({
      description: `One line each, at most ${ASK_QUESTIONS_MAX}: every question is an agent running on this server at once.`,
    }),
  agent: Schema.optional(Named).annotate({
    description: 'The reader definition, by id; absent, the setting `agent.ask`, else the built-in reader.',
  }),
  project: Schema.optional(Schema.Union([Named, Schema.Int])).annotate({
    description: 'The project the readers read, by name or id; absent, yours.',
  }),
  worktree: Schema.optional(Named).annotate({
    description: 'The checkout the readers read: `inherit` (the default, where you stand) or a worktree name in that project.',
  }),
});

type AskInput = typeof askInput.Type;

export type ThreadAskEntry = {
  readonly question: string;
  readonly status: 'answered' | 'partial' | 'failed';
  readonly text: string;
  readonly evidence: readonly string[];
  readonly missing?: string;
  readonly threadId: string | null;
  readonly projectId?: number;
};

export type ThreadAsked = {
  readonly status: 'asked';
  readonly entries: readonly ThreadAskEntry[];
  readonly unarchived?: string;
};

export type ThreadAskAsk = {
  readonly requestId: string;
  readonly step?: number;
  readonly questions: readonly string[];
  readonly agentId?: string;
  readonly project?: string | number;
  readonly worktree?: string;
};

export function askAsk(input: AskInput, requestId: string, step?: number): ThreadAskAsk {
  return {
    requestId,
    step,
    questions: input.questions,
    agentId: input.agent,
    project: input.project,
    worktree: input.worktree,
  };
}

const questionsTitle = (count: number): string => `${count} question${count === 1 ? '' : 's'}`;

export function askingDisplay(questions: readonly (string | undefined)[]): ToolDisplay {
  const asked = questions.flatMap((question) => (question === undefined ? [] : [{ label: question }]));
  return { form: 'list', verb: 'Asking', title: questionsTitle(asked.length), items: asked };
}

export function askedDisplay(asked: ThreadAsked): ToolDisplay {
  return {
    form: 'list',
    verb: 'Asked',
    title: questionsTitle(asked.entries.length),
    items: asked.entries.map((entry) => ({
      label: entry.question,
      detail: entry.text,
      state: entry.status,
      ...(entry.threadId === null ? {} : { thread: { id: entry.threadId, projectId: entry.projectId } }),
    })),
  };
}

export function askedText(asked: ThreadAsked): string {
  const counts = new Map<string, number>();
  for (const entry of asked.entries) counts.set(entry.status, (counts.get(entry.status) ?? 0) + 1);
  const head = `${asked.entries.length} question${asked.entries.length === 1 ? '' : 's'}: ${[...counts].map(([status, count]) => `${count} ${status}`).join(', ')}.`;
  return [
    head,
    ...asked.entries.map((entry, index) =>
      [
        `${index + 1}. ${entry.status}${entry.threadId === null ? '' : ` (thread ${entry.threadId})`} — ${entry.question}`,
        entry.text,
        ...(entry.evidence.length === 0 ? [] : [`evidence: ${entry.evidence.join('; ')}`]),
        ...(entry.missing === undefined ? [] : [`missing: ${entry.missing}`]),
      ].join('\n'),
    ),
    ...(asked.unarchived === undefined ? [] : [`The readers stay unarchived: ${asked.unarchived}`]),
  ].join('\n\n');
}
