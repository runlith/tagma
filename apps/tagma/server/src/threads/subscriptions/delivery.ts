import { Effect, Semaphore } from 'effect';
import { AGENT_CHILD_UPDATE_SIGNAL_TYPE, THREAD_EVENT_SIGNAL_TYPE, type AgentSignalNotice } from '@runlith/agent/contracts';
import type { AgentHarness } from '@runlith/agent/thread/AgentHarness';
import { agentToolOutputText } from '@runlith/agent/ToolOutput';
import type { HarnessToolOutputs } from '../contract/service/engine.js';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import type { NativeThreadState } from '../contract/service/state.js';
import type { ThreadInbox } from '../store/inbox.js';

type Harness = AgentHarness<NativeThreadState, Unit<'machine'>, WriteUnit<'machine'>>;

export type EventLine = {
  readonly subscriberId: string;
  readonly about: string;
  readonly type: typeof AGENT_CHILD_UPDATE_SIGNAL_TYPE | typeof THREAD_EVENT_SIGNAL_TYPE;
  readonly key: string;
  readonly text: string;
  readonly notice: AgentSignalNotice;
  readonly wakes: boolean;
  readonly replaces: readonly string[];
};

export type EventLines = (line: EventLine) => Effect.Effect<void, unknown>;

export const stateLines = (about: string): readonly string[] => [
  `${THREAD_EVENT_SIGNAL_TYPE}:${about}:`,
  ...(['ran', 'compacted', 'cooled'] as const).map((event) => `${AGENT_CHILD_UPDATE_SIGNAL_TYPE}:${about}:${event}:`),
];

export const makeEventLines = ({
  inbox,
  outputs,
  harness,
}: {
  readonly inbox: ThreadInbox['Service'];
  readonly outputs: HarnessToolOutputs['Service'];
  readonly harness: () => Harness;
}): EventLines => {
  const turns = new Map<string, Semaphore.Semaphore>();
  const turnOf = (subscriberId: string) => {
    const held = turns.get(subscriberId) ?? Semaphore.makeUnsafe(1);
    turns.set(subscriberId, held);
    return held;
  };
  return (line) =>
    turnOf(line.subscriberId).withPermit(
      Effect.gen(function* () {
        const id = `${line.type}:${line.about}:${line.key}`;
        if ((yield* inbox.receipt(id)) !== undefined) return;
        const handle = harness().threads.handle(line.subscriberId, OPERATOR_PRINCIPAL);
        const unread = (yield* inbox.pending(line.subscriberId)).filter(
          (item) => item.kind === 'signal' && item.state === 'queued' && line.replaces.some((start) => item.id.startsWith(start)),
        );
        for (const item of unread) yield* handle.retractSignal(item.id, () => Effect.void);
        const bounded = yield* outputs.scope({ threadId: line.subscriberId, ownerId: OPERATOR_PRINCIPAL, runId: null }).project({
          toolCallId: id,
          toolName: line.type,
          output: undefined,
          modelOutput: { type: 'text', value: line.text },
          keep: 'head',
        });
        yield* handle.sendSignal(
          { id, type: line.type, addressee: 'transport', text: agentToolOutputText(bounded.modelOutput), notice: line.notice },
          { ifActive: 'deliver', ifIdle: line.wakes ? 'wake' : 'wait' },
        );
      }),
    );
};
