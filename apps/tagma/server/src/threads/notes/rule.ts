import { agentRule, type AgentRule } from '@runlith/agent/AgentRuntimePolicy';
import type { Message } from '@runlith/llm/schema/messages';
import { Effect } from 'effect';
import type { OperatorNotes } from '../contract/service/notes.js';
import type { RuledThread } from '../contract/service/rules.js';
import { NOTES_RULE } from '../contract/wire/notes.js';

const LAST = 1_000_000;

const notedIn = (messages: readonly Message[]): ReadonlySet<string> => {
  const noted = new Set<string>();
  for (let index = messages.length - 1; index >= 0 && messages[index]!.role === 'user'; index -= 1) {
    const state = messages[index]!.metadata?.runtimeState as Readonly<Record<string, unknown>> | undefined;
    const told = state?.[NOTES_RULE] as { readonly inputs?: readonly string[] } | undefined;
    for (const input of told?.inputs ?? []) noted.add(input);
  }
  return noted;
};

export const notesRule = (notes: OperatorNotes['Service']): AgentRule<RuledThread> =>
  agentRule<RuledThread>(
    NOTES_RULE,
    (ctx) =>
      Effect.gen(function* () {
        if (ctx.hook !== 'beforeStep' || ctx.readerInputs === undefined || ctx.readerInputs.length === 0) return null;
        const noted = notedIn(ctx.modelMessages);
        const inputs = ctx.readerInputs.filter((input) => !noted.has(input));
        if (inputs.length === 0) return null;
        const { text } = yield* notes.standing({ projectId: ctx.projectId, threadId: ctx.thread.id });
        if (text === null) return null;
        return { type: 'guide' as const, text, retell: false as const, state: { [NOTES_RULE]: { inputs } } };
      }),
    { owner: 'threads', hook: 'beforeStep', priority: LAST },
  );
