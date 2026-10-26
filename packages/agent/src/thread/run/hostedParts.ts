import type { Fiber, Scope } from 'effect';
import type { JsonSchema } from '@runlith/llm/schema/ids';
import { ToolResultValue, type Message } from '@runlith/llm/schema/messages';
import type { AgentGuidanceJournal, PendingRuntimeGuide } from '../../agent/AgentGuidanceJournal';
import type { ModeOf } from '../../modes/ApprovalMode';
import type { RunStop } from '../../agent/RunStop';
import type { AgentToolOutcome } from '../../agent/door/types';
import { doorToolModelOutput, type AgentToolModelOutput } from '../../agent/ToolOutput';
import type { ToolDisplay } from '../../tool/display';
import type { ToolArgumentsInvalid } from '../../agent/ToolArguments';
import type { ThreadBorderFailed } from '../ThreadBorder';
import type { HostedReplay } from './hostedReplay';
import type { ThreadHostedHandle } from './assembly/RunAssembly';
import type { ThreadPreparedRun } from '../agents/ThreadAgent';
import type { ThreadWriteTx } from '../ThreadPorts';
import { describedTool, toolExecute, type ToolOutcome } from '../../agent/tool';
import type { ThreadToolExecution } from '../../transcript/entries';
import { USER_QUESTION_TOOL_NAME } from '../../transcript/parts';
import type { TransportCapabilities, TransportWeb } from '../record';
import type { HostedWords } from './hostedWords';

export type HostedTool = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly mutates: boolean;
};

export type HostedTools = {
  readonly tools: readonly HostedTool[];
  readonly names: readonly string[];
};

export type HostedCall = {
  readonly threadId: string;
  readonly agentId: string;
  readonly toolCallId: string;
  readonly name: string;
  readonly input: unknown;
  readonly arguments: string;
};

export type HostedAnswer = {
  readonly output: AgentToolModelOutput;
  readonly failed: boolean;
  readonly guides: readonly string[];
  readonly offered: boolean;
};

export type HostedReply = HostedAnswer & { readonly words: readonly string[] };

export type HostedAgent = {
  readonly prompt: string;
  readonly web: TransportWeb;
};

export type HostedTurn = {
  readonly context: string | null;
  readonly prompt: string | null;
  readonly web: TransportWeb;
};

export type Hosted = {
  readonly runId: string;
  readonly keepWarm: boolean;
  readonly toolCatalog: TransportCapabilities['toolCatalog'];
  readonly agentId: string;
  readonly halt: RunStop;
  readonly modeOf: ModeOf;
  readonly handle: ThreadHostedHandle;
  readonly prepared: ThreadPreparedRun<ThreadWriteTx>;
  readonly journal: AgentGuidanceJournal;
  readonly callGuides: Map<string, PendingRuntimeGuide[]>;
  readonly calls: Map<string, Fiber.Fiber<HostedAnswer, ThreadBorderFailed>>;
  readonly open: Set<string>;
  readonly replays: Map<string, HostedReplay>;
  readonly started: Map<string, ThreadToolExecution>;
  readonly words: HostedWords;
  readonly scope: Scope.Closeable;
  step: number;
  active: ReadonlySet<string> | null;
  history: readonly Message[];
};

export type Settled = {
  readonly output: AgentToolModelOutput;
  readonly failed: boolean;
  readonly retained?: AgentToolOutcome['retained'];
  readonly settlement: ToolOutcome;
  readonly display?: ToolDisplay;
  readonly execution?: ThreadToolExecution;
};

export const offeredBy = (hosted: Hosted | null): HostedTools => {
  if (hosted === null) return { tools: [], names: [] };
  const catalog = Object.entries(hosted.handle.catalog());
  return {
    names: catalog.map(([name]) => name),
    tools: catalog.flatMap(([name, tool]) =>
      (hosted.toolCatalog !== 'turn' && hosted.active !== null && !hosted.active.has(name)) ||
      (toolExecute(tool) === null && name !== USER_QUESTION_TOOL_NAME)
        ? []
        : [{ name, description: describedTool(tool), inputSchema: tool.inputSchema, mutates: tool.mutates === true }],
    ),
  };
};

export const refused = (text: string, error: string = text): Settled => ({
  output: ToolResultValue.from(text, 'error'),
  failed: true,
  settlement: { kind: 'failed', error },
});

export const refusedInput = (failure: ToolArgumentsInvalid, document: boolean): Settled => {
  const output = failure.output;
  return {
    output: document ? doorToolModelOutput(output) : { type: 'text', value: failure.text },
    failed: true,
    settlement: { kind: 'refused', refusal: failure.refusal, output },
  };
};

export const DECLINED = 'The user declined confirmation.';
