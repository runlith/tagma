import { uuidv7 } from 'uuidv7';
import type { AgentHook, AgentRuntimeGuidance, PendingRuntimeGuide } from './contracts';
import { type AgentDirective, agentGuides } from './policy/AgentRuntimePolicy';

type AgentRuntimeGuidanceSource = AgentRuntimeGuidance['sources'][number];

export function coalesceGuides(guides: readonly PendingRuntimeGuide[], held: readonly PendingRuntimeGuide[] = []): PendingRuntimeGuide[] {
  const identity = (guide: PendingRuntimeGuide) =>
    guide.batchKey === undefined
      ? JSON.stringify(['content', guide.text, guide.state, guide.withholds])
      : JSON.stringify(['batch', guide.batchKey]);
  const seen = new Set(held.map(identity));
  const covered = new Set([...held, ...guides].flatMap((guide) => guide.covers ?? []));
  return guides.filter((guide) => {
    if (guide.batchKey !== undefined && covered.has(guide.batchKey)) return false;
    const key = identity(guide);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class AgentGuidanceJournal {
  private readonly runId: string;
  private closed = false;
  private sequence = 0;

  constructor(runId: string) {
    this.runId = runId;
  }

  emit(stepNumber: number, guides: readonly PendingRuntimeGuide[]): AgentRuntimeGuidance | null {
    if (this.closed || guides.length === 0) return null;
    this.sequence += 1;
    const texts = guides.map((guide) => guide.text);
    const sources = guides.map(runtimeGuidanceSource);
    const hookSet = new Set(guides.map((guide) => guide.hook));
    const ruleIds = [...new Set(guides.flatMap((guide) => (guide.ruleId ? [guide.ruleId] : [])))];
    const entry: AgentRuntimeGuidance = {
      type: 'runtime-guidance',
      id: `transcript:runtime-guidance:${uuidv7()}`,
      runId: this.runId,
      hook: hookSet.size === 1 ? (guides[0]?.hook ?? 'beforeStep') : 'mixed',
      sequence: this.sequence,
      texts,
      sources,
      ruleIds: ruleIds.length > 0 ? ruleIds : undefined,
      stepNumber,
      occurredAt: new Date().toISOString(),
    };
    return entry;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
  }
}

export function pendingRuntimeGuides(
  hook: AgentHook,
  directives: readonly AgentDirective[],
  context: Partial<Pick<PendingRuntimeGuide, 'toolName' | 'toolCallId' | 'taskId'>> = {},
): PendingRuntimeGuide[] {
  return agentGuides(directives).map((directive) => ({
    hook,
    text: directive.text,
    ruleId: directive.ruleId,
    state: directive.state,
    batchKey: directive.batchKey,
    covers: directive.covers,
    retell: directive.retell,
    withholds: directive.withholds,
    toolName: context.toolName,
    toolCallId: context.toolCallId,
    taskId: context.taskId,
  }));
}

function runtimeGuidanceSource(guide: PendingRuntimeGuide): AgentRuntimeGuidanceSource {
  return {
    hook: guide.hook,
    ruleId: guide.ruleId,
    state: guide.state,
    batchKey: guide.batchKey,
    covers: guide.covers,
    retell: guide.retell,
    withholds: guide.withholds,
    toolName: guide.toolName,
    toolCallId: guide.toolCallId,
    taskId: guide.taskId,
  };
}
