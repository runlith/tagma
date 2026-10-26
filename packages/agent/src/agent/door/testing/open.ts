import { Effect, Schema } from 'effect';
import { AgentRunState } from '../../AgentRunState';
import { type AgentRule, AgentRuntimePolicy } from '../../policy/AgentRuntimePolicy';
import type { AgentApprovalMode } from '../../contracts';
import type { ModeOf } from '../../../modes/ApprovalMode';
import { Tool } from '../../tool';
import type { AgentToolOutputs } from '../../ToolOutput';
import { unthreadedCaller } from '../../testing/caller';
import { builtinMode } from '../../testing/modes';
import type { AgentToolDoor } from '../AgentToolDoor';
import { openToolDoor } from '../openToolDoor';
import { ToolJudge } from '../openToolDoor';
import type { AgentToolInvocation, AgentToolResolution } from '../types';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../permissions/vocabulary';

export type Ctx = Record<string, never>;

export const WRITES_ONE_FILE = {
  approval: ASKS_IN_REVIEW,
  mutates: true,
  confirmation: { prompt: () => ({ summary: 'Write it?' }), confirmLabel: 'Write' },
  subjects: () => [{ kind: 'write' as const, value: 'notes/today.md' }],
} as const;

export function open(
  options: {
    rules?: readonly AgentRule<Ctx>[];
    mode?: AgentApprovalMode;
    modeOf?: ModeOf;
    unattended?: true;
    toolOutputs?: AgentToolOutputs;
    catalog?: ReadonlyMap<string, Tool.Tool>;
    resolutions?: readonly AgentToolResolution[];
    stepsTaken?: number;
  } = {},
): {
  door: AgentToolDoor<Ctx>;
  guides: { directives: unknown; context: unknown }[];
} {
  const guides: { directives: unknown; context: unknown }[] = [];
  const catalog = options.catalog;
  const built = openToolDoor<Ctx>(
    'run-1',
    unthreadedCaller,
    {},
    new ToolJudge(options.modeOf ?? builtinMode(options.mode ?? 'trust')),
    new AgentRunState({ stepsTaken: options.stepsTaken }),
    new AgentRuntimePolicy<Ctx>(options.rules ?? []),
    undefined,
    options.toolOutputs,
    undefined,
    undefined,
    catalog === undefined ? undefined : () => catalog,
    (directives, context) => guides.push({ directives, context }),
    undefined,
    options.unattended === true,
    options.resolutions,
  );
  return { guides, door: built };
}

export function countingTool(run: () => void) {
  return Tool.make({
    display: () => ({ form: 'none' }),
    approval: ASKS_NEVER,
    description: 'Run one side effect.',
    parameters: Schema.Struct({}),
    execute: () =>
      Effect.sync(() => {
        run();
        return { ok: true };
      }),
  });
}

export function call(
  tool: Tool,
  options: { toolCallId?: string; name?: string; declares?: typeof WRITES_ONE_FILE; confirmed?: true } = {},
) {
  return {
    name: options.name ?? 'side_effect',
    tool: options.declares ? { ...tool, ...options.declares } : tool,
    input: {},
    confirmed: options.confirmed,
    options: { toolCallId: options.toolCallId ?? 'call-1', messages: [] },
  };
}

export function verdict(door: AgentToolDoor<Ctx>, invocation: AgentToolInvocation) {
  return door.verdict({
    name: invocation.name,
    tool: invocation.tool,
    input: invocation.input,
    toolCallId: invocation.options.toolCallId,
  });
}
