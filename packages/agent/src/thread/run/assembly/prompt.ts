import { Effect } from 'effect';
import { AgentHostFailed } from '../../../agent/AgentFailure';
import type { ThreadTranscriptEntry } from '../../../transcript/rows';
import { ThreadAgents } from '../../agents/ThreadAgents';
import { threadSystemPromptEvent } from '../../events';
import { actDigest } from '../../keyed';
import type { ThreadPromptState, ThreadRow } from '../../rows';
import type { ThreadPatch } from '../../storage/aggregate';
import type { ThreadBorderFailed } from '../../ThreadBorder';
import { sealThreadEvents } from '../../ThreadEventDoor';
import type { ThreadSources } from '../../agents/supply';
import type { ThreadTx, ThreadWriteTx } from '../../ThreadPorts';
import { answerOf, controlIfPresent, transitionNow, type TransitionDeps } from '../../transition/kernel';
import type { Decision } from '../../transition/port';
import { catalogProfileOf, type ThreadDefinition } from '../../agents/AgentProfile';

export type ThreadInstructionsChecked = { readonly status: 'updated' | 'current' };

type Frozen = { readonly instructions: string; readonly entry: ThreadTranscriptEntry | null };

const selection = (ids: readonly string[] | undefined) => (ids === undefined ? undefined : [...new Set(ids)].sort());

const definitionContent = ({ agentId, profile }: ThreadDefinition) => {
  const { sources, tools } = catalogProfileOf(profile);
  return JSON.stringify([agentId, selection(profile?.overlay.capabilities), selection(sources), selection(tools)]);
};

const definitionSource = (definition: ThreadDefinition) => {
  const overlay = definition.profile?.overlay;
  return JSON.stringify([definitionContent(definition), overlay?.instructions, overlay?.prompt, overlay?.sections]);
};

export function pendingInstructions(prompts: ThreadPromptState): ThreadPatch | undefined {
  if (prompts.pendingSystemPrompt === null && prompts.pendingDefinition == null) return undefined;
  return {
    systemPrompt: prompts.pendingSystemPrompt ?? undefined,
    pendingSystemPrompt: null,
    agentId: prompts.pendingDefinition?.agentId,
    profile: prompts.pendingDefinition?.profile,
    pendingDefinition: null,
  };
}

export type PromptFreeze = Effect.Success<ReturnType<typeof makePromptFreeze>>;

export const makePromptFreeze = Effect.fnUntraced(function* ({ kernel }: { readonly kernel: TransitionDeps<ThreadTx, ThreadWriteTx> }) {
  const agents = yield* ThreadAgents;
  const store = kernel.store;

  const freeze = Effect.fnUntraced(function* (
    threadId: string,
    runId: string,
    instructions: string,
  ): Effect.fn.Return<Frozen, ThreadBorderFailed> {
    const text = instructions.trim();
    if (!text) return { instructions: text, entry: null };
    const event = threadSystemPromptEvent(runId, text);
    const outcome = yield* transitionNow<Frozen, ThreadWriteTx>(
      kernel,
      threadId,
      {
        declared: sealThreadEvents([event]),
        decide: ({ row }) =>
          Effect.succeed<Decision<Frozen, ThreadWriteTx>>(
            row.systemPrompt !== null
              ? { replayed: { instructions: row.systemPrompt, entry: null } }
              : { apply: true, result: { instructions: text, entry: event.payload.entry ?? null }, patch: { systemPrompt: text } },
          ),
      },
      { evidence: { decidedBy: `freeze:${runId}` }, digest: actDigest(['system-prompt', runId, text]) },
    );
    return yield* answerOf(threadId, outcome);
  });

  return {
    frozen: (threadId: string, runId: string, instructions: string, recorded: (entry: ThreadTranscriptEntry | null) => void) =>
      freeze(threadId, runId, instructions).pipe(
        Effect.map((held) => {
          recorded(held.entry);
          return held.instructions;
        }),
        Effect.mapError((cause) => new AgentHostFailed({ port: 'commitInstructions', cause })),
      ),

    pendingApplied: Effect.fnUntraced(function* (thread: ThreadRow, runId: string): Effect.fn.Return<ThreadRow, ThreadBorderFailed> {
      const applied = yield* controlIfPresent<ThreadPatch | undefined, ThreadWriteTx>(
        kernel,
        thread.id,
        {
          decide: (_row, tx) =>
            Effect.map(store.systemPromptOf(thread.id, tx), (prompts): Decision<ThreadPatch | undefined, ThreadWriteTx> => {
              const patch = prompts === undefined ? undefined : pendingInstructions(prompts);
              return patch === undefined ? { refuse: undefined } : { apply: true, result: patch, patch };
            }),
        },
        { evidence: { decidedBy: `prompt:${runId}` }, digest: actDigest(['prompt', runId]) },
      );
      const patch = applied === undefined ? undefined : yield* answerOf(thread.id, applied);
      return patch === undefined
        ? thread
        : {
            ...thread,
            agentId: patch.agentId ?? thread.agentId,
            profile: patch.profile === undefined ? thread.profile : patch.profile,
            systemPrompt: patch.systemPrompt ?? thread.systemPrompt,
            pendingSystemPrompt: null,
            pendingDefinition: null,
          };
    }),

    check: Effect.fnUntraced(function* (
      thread: ThreadRow,
      sources: ThreadSources,
      refreshDefinition = false,
    ): Effect.fn.Return<ThreadInstructionsChecked, ThreadBorderFailed> {
      if (thread.systemPrompt === null && !refreshDefinition) return { status: 'current' } as const;
      const candidate = (yield* (yield* agents.get(thread.agentId)).instructions({
        thread: { ...thread, transcript: [] },
        sources,
      })).trim();
      if (!candidate) return { status: 'current' } as const;
      const checked = yield* controlIfPresent<ThreadInstructionsChecked['status'], ThreadWriteTx>(
        kernel,
        thread.id,
        {
          decide: (row, tx) =>
            Effect.map(store.systemPromptOf(thread.id, tx), (current): Decision<ThreadInstructionsChecked['status'], ThreadWriteTx> => {
              if (!current) return { refuse: 'current' };
              const definition: ThreadDefinition = { agentId: thread.agentId, profile: thread.profile };
              const accepted: ThreadDefinition = { agentId: row.agentId, profile: row.profile };
              const pending = current.pendingDefinition ?? accepted;
              const definitionChanged =
                refreshDefinition &&
                (current.systemPrompt === null
                  ? definitionSource(definition) !== definitionSource(pending)
                  : definitionContent(definition) !== definitionContent(pending));
              const promptChanged = current.systemPrompt !== null && candidate !== (current.pendingSystemPrompt ?? current.systemPrompt);
              if (!definitionChanged && !promptChanged) return { refuse: 'current' };
              return {
                apply: true,
                result: 'updated',
                patch: {
                  pendingDefinition: refreshDefinition
                    ? JSON.stringify(definition) === JSON.stringify(accepted)
                      ? null
                      : definition
                    : undefined,
                  pendingSystemPrompt: candidate === current.systemPrompt ? null : candidate,
                },
              };
            }),
        },
        { evidence: { decidedBy: `instructions:${thread.id}` }, digest: actDigest(['instructions', thread.id, candidate]) },
      );
      const status: ThreadInstructionsChecked['status'] = checked === undefined ? 'current' : yield* answerOf(thread.id, checked);
      return { status };
    }),
  };
});
