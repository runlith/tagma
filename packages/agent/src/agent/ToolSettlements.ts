import { Context, Effect } from 'effect';
import type { ToolPreparationCall } from './tool';

export type ToolSettlement = {
  ended(): void;
  delivered(): void;
  defer(): () => void;
};

type SettlementResource = 'call' | 'read-back';

type Pending = {
  readonly detached: () => boolean;
  readonly claim: ToolSettlement;
  readonly releases: Map<SettlementResource, () => void>;
  ended: boolean;
  recorded: boolean;
  released: boolean;
  deferred: boolean;
};

export type CallSettlements = Effect.Success<typeof makeCallSettlements>;

export const makeCallSettlements = Effect.gen(function* () {
  const runs = new Map<string, Map<string, Pending>>();

  const retain = (
    call: ToolPreparationCall,
    release: () => void,
    detached: () => boolean,
    resource: SettlementResource = 'read-back',
  ): ToolSettlement | undefined => {
    const runId = call.caller.thread?.runId;
    if (runId === undefined) return undefined;
    const calls = runs.get(runId) ?? new Map<string, Pending>();
    const held = calls.get(call.toolCallId);
    if (held !== undefined) {
      if (!held.releases.has(resource)) held.releases.set(resource, release);
      return held.claim;
    }
    const remove = () => {
      if (calls.get(call.toolCallId) === pending) calls.delete(call.toolCallId);
      if (calls.size === 0 && runs.get(runId) === calls) runs.delete(runId);
    };
    const finish = () => {
      if (!pending.ended || !pending.recorded || pending.released) return;
      remove();
      pending.released = true;
      for (const release of pending.releases.values()) release();
      pending.releases.clear();
    };
    const pending: Pending = {
      detached,
      releases: new Map([[resource, release]]),
      ended: false,
      recorded: false,
      released: false,
      deferred: false,
      claim: {
        defer: () => {
          const before = pending.deferred;
          pending.deferred = true;
          return () => {
            pending.deferred = before;
          };
        },
        ended: () => {
          pending.ended = true;
          finish();
        },
        delivered: () => {
          pending.recorded = true;
          finish();
        },
      },
    };
    calls.set(call.toolCallId, pending);
    runs.set(runId, calls);
    return pending.claim;
  };

  const recorded = (runId: string, toolCallId: string): void => {
    const held = runs.get(runId)?.get(toolCallId);
    if (held === undefined || held.deferred || held.detached()) return;
    held.claim.delivered();
  };

  const ended = (runId: string): void => {
    const calls = runs.get(runId);
    if (calls === undefined) return;
    for (const [toolCallId, held] of calls) {
      if (held.deferred || held.detached()) continue;
      calls.delete(toolCallId);
      held.claim.delivered();
    }
    if (calls.size === 0) runs.delete(runId);
  };
  return {
    get size(): number {
      let size = 0;
      for (const calls of runs.values()) size += calls.size;
      return size;
    },
    retain,
    recorded,
    ended,
  };
});

export const ToolSettlements = Context.Reference<CallSettlements | undefined>('@runlith/agent/ToolSettlements', {
  defaultValue: () => undefined,
});
