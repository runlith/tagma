import { Schema } from 'effect';
import type { ToolDisplay } from '../tool/display';
import { CollaborationText, Named } from './collaborationVerbs';

export const ASK_TOOL = 'ask';

export const ASK_QUESTIONS_MAX = 8;

export const DEFAULT_READER = 'reader';

export const ASK =
  'Answers factual questions about a project: each question goes to an agent that reads the project and answers with evidence. ' +
  'Asking is cheap — usually cheaper than reading yourself, since that agent works in its own short context while your reads stay in yours — so ask for any fact that takes more than one read. ' +
  'Never ask for a design, a judgement or a change; put independent questions in one call, and check the evidence behind the claims you act on.';

export const askInput = Schema.Struct({
  questions: Schema.Array(CollaborationText)
    .check(Schema.isMinLength(1), Schema.isMaxLength(ASK_QUESTIONS_MAX))
    .annotate({
      description: `One question each, at most ${ASK_QUESTIONS_MAX}. Its agent sees none of your conversation: name the path, symbol or block the question is about.`,
    }),
  agent: Schema.optional(Named).annotate({
    description: 'The definition of the agents that answer, by id; absent, the setting `agent.ask`, else the built-in `reader`.',
  }),
  project: Schema.optional(Schema.Union([Named, Schema.Int])).annotate({
    description: 'The project the agents read, by name or id; absent, yours.',
  }),
  worktree: Schema.optional(Named).annotate({
    description: 'The checkout the agents read: `inherit` (the default, where you stand) or a worktree name in that project.',
  }),
});

type AskInput = typeof askInput.Type;

export type ThreadAskEntry = {
  readonly question: string;
  readonly status: 'answered' | 'failed';
  readonly text: string;
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
  const asked = questions.flatMap((question) => (question === undefined ? [] : [{ label: question, state: 'working' as const }]));
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
      [`${index + 1}. ${entry.status}${entry.threadId === null ? '' : ` (thread ${entry.threadId})`} — ${entry.question}`, entry.text].join(
        '\n',
      ),
    ),
    ...(asked.unarchived === undefined ? [] : [`The readers stay unarchived: ${asked.unarchived}`]),
  ].join('\n\n');
}
