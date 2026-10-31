import type { AgentRunState } from '../AgentRunState';
import type { ToolCaller } from '../contracts';
import type { CallSettlements } from '../ToolSettlements';

export type ToolRunMode = 'native' | 'hosted';

export class ToolRun<TCtx> {
  readonly threadId: string | undefined;

  constructor(
    readonly runId: string,
    readonly caller: ToolCaller,
    public ctx: TCtx,
    readonly runState: AgentRunState,
    readonly unattended: boolean,
    readonly settlements: CallSettlements | undefined,
    readonly mode: ToolRunMode = 'native',
  ) {
    this.threadId = caller.thread?.threadId;
  }

  attribution() {
    return {
      run: this.runId,
      thread: this.threadId,
      parent: { run: this.runId },
      actor: this.threadId === undefined ? undefined : { kind: 'thread' as const, id: this.threadId },
    };
  }
}
