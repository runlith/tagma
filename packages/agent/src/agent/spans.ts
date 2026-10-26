import { Effect, Option } from 'effect';
import type { Tracer } from 'effect';

export type AgentSpan =
  | { readonly type: 'run'; readonly runId: string; readonly threadId?: string; readonly agentId?: string }
  | { readonly type: 'model-step'; readonly runId: string; readonly stepNumber: number }
  | {
      readonly type: 'tool-call';
      readonly runId: string;
      readonly toolName: string;
      readonly toolCallId: string;
      readonly executedBy: 'host' | 'provider';
    }
  | {
      readonly type: 'mcp-call';
      readonly runId: string;
      readonly server: string;
      readonly toolName: string;
      readonly toolCallId: string;
    }
  | { readonly type: 'compaction'; readonly threadId: string; readonly runId: string }
  | { readonly type: 'spawn'; readonly runId: string; readonly childThreadId: string }
  | {
      readonly type: 'delivery';
      readonly envelopeId: string;
      readonly intent: string;
      readonly senderThreadId: string | null;
      readonly targetThreadId: string;
    }
  | { readonly type: 'fork'; readonly sourceThreadId: string; readonly branchThreadId: string; readonly cut: string }
  | { readonly type: 'directory'; readonly threadId: string }
  | { readonly type: 'workflow-step'; readonly runId: string; readonly step: string };

export type AgentSpanType = AgentSpan['type'];

const AGENT_SPAN_PREFIX = 'agent.';

export function agentSpanName(type: AgentSpanType): string {
  return `${AGENT_SPAN_PREFIX}${type}`;
}

const SPAN_PARENTS: Record<AgentSpanType, ReadonlySet<AgentSpanType | 'root'>> = {
  run: new Set(['root']),
  'model-step': new Set(['run', 'root']),
  'tool-call': new Set(['run', 'model-step', 'root']),
  'mcp-call': new Set(['run', 'model-step', 'root']),
  compaction: new Set(['run', 'root']),
  spawn: new Set(['tool-call', 'root']),
  delivery: new Set(['tool-call', 'run', 'root']),
  fork: new Set(['tool-call', 'root']),
  directory: new Set(['tool-call', 'root']),
  'workflow-step': new Set(['run', 'workflow-step', 'root']),
};

export const AGENT_SPAN_NAMES: readonly string[] = Object.keys(SPAN_PARENTS).map((type) => agentSpanName(type as AgentSpanType));

function nearestAgentSpan(span: Tracer.AnySpan | undefined): AgentSpanType | 'root' {
  let current: Tracer.AnySpan | undefined = span;
  while (current !== undefined && current._tag === 'Span') {
    if (current.name.startsWith(AGENT_SPAN_PREFIX)) {
      return current.name.slice(AGENT_SPAN_PREFIX.length) as AgentSpanType;
    }
    current = Option.getOrUndefined(current.parent);
  }
  return 'root';
}

function startsTrace(type: AgentSpanType): boolean {
  const allowed = SPAN_PARENTS[type];
  return allowed.size === 1 && allowed.has('root');
}

export function agentSpan(span: AgentSpan) {
  const { type, ...attributes } = span;
  return <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
    if (startsTrace(type)) {
      return Effect.withSpan(effect, agentSpanName(type), { attributes, root: true });
    }
    return Effect.currentParentSpan.pipe(
      Effect.match({
        onSuccess: (parent) => nearestAgentSpan(parent),
        onFailure: () => 'root' as const,
      }),
      Effect.flatMap((parent) => {
        if (!SPAN_PARENTS[type].has(parent)) {
          return Effect.die(new Error(`Span ${agentSpanName(type)} opened under ${String(parent)}, which the schema forbids.`));
        }
        return Effect.withSpan(effect, agentSpanName(type), { attributes });
      }),
    ) as Effect.Effect<A, E, R>;
  };
}
