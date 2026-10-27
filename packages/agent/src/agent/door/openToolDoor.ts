import type { AgentCalls } from '../AgentCalls';
import type { CallSettlements } from '../ToolSettlements';
import { AgentRunState } from '../AgentRunState';
import { AgentRuntimePolicy } from '../policy/AgentRuntimePolicy';
import type { ToolCaller } from '../contracts';
import type { Tool } from '../tool';
import type { AgentToolOutputs } from '../ToolOutput';
import { type AgentToolDoor, makeAgentToolDoor } from './AgentToolDoor';
import { makeCallLedger } from './CallLedger';
import { makeCallOrder } from './CallOrder';
import { declaredConfirmations } from './DeclaredConfirmations';
import { makeOutputProjection } from './OutputProjection';
import type { ToolConfirmations, ToolVerdicts } from './ports';
import { judge, type ModeOf } from '../../modes/ApprovalMode';
import type { PermissionOutcome, Raised } from '../../permissions/vocabulary';
import { makeToolAdmission } from './ToolAdmission';
import { makeToolExecution } from './ToolExecution';
import { type ToolGuides, makeToolRules } from './ToolRules';
import { ToolRun } from './ToolRun';
import type { AgentCallHooks, AgentToolResolution } from './types';

export function openToolDoor<TCtx>(
  runId: string,
  caller: ToolCaller,
  ctx: TCtx,
  verdicts: ToolVerdicts,
  runState: AgentRunState = new AgentRunState(),
  policy: AgentRuntimePolicy<TCtx> = new AgentRuntimePolicy<TCtx>([]),
  confirmations: ToolConfirmations = declaredConfirmations,
  toolOutputs: AgentToolOutputs | undefined = undefined,
  calls: AgentCalls | undefined = undefined,
  callHooks: AgentCallHooks<TCtx> | undefined = undefined,
  catalog: (() => ReadonlyMap<string, Tool>) | undefined = undefined,
  onGuides: ToolGuides | undefined = undefined,
  generation: number = 0,
  unattended: boolean = false,
  resolutions: readonly AgentToolResolution[] = [],
  settlements: CallSettlements | undefined = undefined,
): AgentToolDoor<TCtx> {
  const run = new ToolRun<TCtx>(runId, caller, ctx, runState, unattended, settlements);
  const ledger = makeCallLedger({ runId, generation, resolutions });
  const order = makeCallOrder(
    calls === undefined || run.threadId === undefined ? undefined : { runId, threadId: run.threadId, claims: calls.claims },
  );
  const rules = makeToolRules({ run, policy, guides: onGuides });
  const outputs = makeOutputProjection({ outputs: toolOutputs, caller });
  const admission = makeToolAdmission({ run, ledger, rules, verdicts, confirmations, catalog });
  const execution = makeToolExecution({
    run,
    ledger,
    order,
    rules,
    outputs,
    calls,
    callHooks: callHooks === undefined ? undefined : () => callHooks(run.ctx),
  });
  return makeAgentToolDoor({ run, ledger, order, admission, execution, outputs, rules });
}

export class ToolJudge implements ToolVerdicts {
  constructor(private readonly modeOf: ModeOf) {}

  verdict(tool: Tool, name: string, raised: readonly Raised[]): PermissionOutcome {
    return judge(tool.approval, raised, this.modeOf(), this.modeOf.modes, { toolName: name, mutating: tool.mutates === true });
  }
}
