import type { AgentRunState } from '../AgentRunState';
import type { ToolCaller } from '../contracts';

export class ToolRun<TCtx> {
  readonly threadId: string | undefined;

  constructor(
    readonly runId: string,
    readonly caller: ToolCaller,
    public ctx: TCtx,
    readonly runState: AgentRunState,
    readonly unattended: boolean,
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
