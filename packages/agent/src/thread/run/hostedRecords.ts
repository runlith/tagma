import { ToolResultValue } from '@runlith/llm/schema/messages';
import { agentFailureCause, type AgentToolCallRegenerated, type AgentToolCallReused, type AgentToolFailed } from '../../agent/AgentFailure';
import type { CallAdmission } from '../../agent/callProgress';
import { doorToolOutcome, type AgentToolOutcome } from '../../agent/door/types';
import { readableToolFailure } from '../../agent/turn/tools';
import type { ToolDisplay } from '../../tool/display';
import { doorToolModelOutput } from '../../agent/ToolOutput';
import { settleTool, toolFailed, toolInputJson, type ThreadToolEntry, type ThreadToolExecution } from '../../transcript/entries';
import { hostedToolEntryId } from '../../transcript/entryNames';
import { refused, refusedInput, type HostedAnswer, type HostedCall, type Settled } from './hostedParts';
import { ToolArgumentsInvalid } from '../../agent/ToolArguments';
import type { UnrevealedDefinition } from '../../agent/AgentDeferredTools';
import { ToolFailed } from '../../agent/tool';
import { settledToolEntry, toolExecutionOf } from './ThreadToolRecords';
import { toolExecutionFailure } from './ToolQuestion';
import { READ_UNANSWERED, startedReading } from './ThreadEffectSettlement';
import type { AgentStep } from '../../agent/AgentStep';
import { coreEntry } from '../../transcript/kinds';
import type { ThreadTranscript } from '../../transcript/rows';

export const ENDED = 'The run ended before this call answered.';

export const RESTARTED = 'Tagma restarted while this call ran; whether its effect happened is unknown — verify before repeating it.';

export const failure = (text: string): HostedAnswer => ({
  output: ToolResultValue.from(text, 'error'),
  failed: true,
  guides: [],
  offered: false,
});

export const outcomeSettled = (outcome: AgentToolOutcome): Settled => {
  const settlement = doorToolOutcome(outcome);
  return {
    output: outcome.modelOutput,
    failed: !outcome.executed || toolFailed(settleTool(settlement).toolState),
    retained: outcome.retained,
    settlement,
    display: outcome.display,
  };
};

export const callFailed = (
  failed: AgentToolFailed | AgentToolCallReused | AgentToolCallRegenerated,
  confirmed: boolean,
  initial: ToolDisplay | undefined,
  document: boolean,
  unrevealed: () => UnrevealedDefinition | null = () => null,
): Settled => {
  const shown = initial === undefined ? {} : { display: initial };
  if (failed._tag === 'AgentToolFailed' && failed.cause instanceof ToolArgumentsInvalid) {
    const definition = unrevealed();
    return { ...refusedInput(definition === null ? failed.cause : failed.cause.revealing(definition), document), ...shown };
  }
  const cause = agentFailureCause(failed);
  const declared = cause instanceof ToolFailed ? cause : null;
  const refusal = declared?.refusal ?? null;
  if (refusal !== null) {
    const output = declared?.output ?? null;
    return {
      output: document && output !== null ? doorToolModelOutput(output) : ToolResultValue.from(failed.message, 'error'),
      failed: true,
      settlement: { kind: 'refused', refusal },
      ...shown,
    };
  }
  if (!confirmed) return { ...refused(failed.message, readableToolFailure(failed)), ...shown };
  const ended = toolExecutionFailure(cause, failed._tag === 'AgentToolFailed' ? failed.durationMs : undefined);
  return { output: ToolResultValue.from(ended.reason, 'error'), failed: true, settlement: ended.outcome, ...shown };
};

export const restartedSettled = (standing: ThreadToolEntry): Settled => {
  const said = startedReading(standing) ? READ_UNANSWERED : RESTARTED;
  return {
    output: ToolResultValue.from(said, 'error'),
    failed: true,
    settlement: { kind: said === RESTARTED ? 'unknown' : 'cancelled', output: said },
    display: standing.toolDisplay,
    execution: standing.execution,
  };
};

export const entryOf = (runId: string, call: HostedCall, settled: Settled, started: ThreadToolExecution | undefined): ThreadToolEntry =>
  settledToolEntry(
    {
      id: hostedToolEntryId(runId, call.toolCallId),
      runId,
      toolName: call.name,
      toolCallId: call.toolCallId,
      input: toolInputJson(call.input),
      occurredAt: new Date().toISOString(),
    },
    settled.settlement,
    settled.display,
    settled.execution ?? started,
  );

export const admissionEntry = (
  runId: string,
  call: HostedCall,
  execution: ThreadToolExecution,
  display: ToolDisplay | undefined,
): ThreadToolEntry => ({
  type: 'tool',
  id: hostedToolEntryId(runId, call.toolCallId),
  runId,
  toolName: call.name,
  toolCallId: call.toolCallId,
  toolState: 'input-available',
  toolInput: toolInputJson(call.input),
  toolDisplay: display,
  execution,
  occurredAt: new Date().toISOString(),
});

export const hostedExecutionOf = (admission: CallAdmission): ThreadToolExecution => {
  const execution = toolExecutionOf(admission);
  return execution.state === 'queued' ? { ...execution, gated: true } : execution;
};

export const closingStep = (entries: ThreadTranscript, text: string | null): AgentStep => ({
  content: [],
  text: text ?? '',
  reasoningText: undefined,
  toolCalls: [],
  toolResults: entries.flatMap((entry) =>
    coreEntry(entry) && entry.type === 'tool' && entry.toolState === 'output-available'
      ? [{ toolCallId: entry.toolCallId, toolName: entry.toolName, output: entry.toolOutput }]
      : [],
  ),
  usage: undefined,
});
