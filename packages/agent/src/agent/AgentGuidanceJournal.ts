import { uuidv7 } from 'uuidv7';
import type { AgentHook, AgentRuntimeGuidance, PendingRuntimeGuide } from './contracts';
import { type AgentDirective, agentGuides } from './policy/AgentRuntimePolicy';

type AgentRuntimeGuidanceSource = AgentRuntimeGuidance['sources'][number];

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
    retell: directive.retell,
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
    retell: guide.retell,
    toolName: guide.toolName,
    toolCallId: guide.toolCallId,
    taskId: guide.taskId,
  };
}
