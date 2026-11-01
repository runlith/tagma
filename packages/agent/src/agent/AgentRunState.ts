export type AgentToolRecord = {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly refused?: boolean;
  readonly stepNumber?: number;
};

export class AgentRunState {
  private step: number;
  private readonly pending = new Set<string>();
  private readonly counts = new Map<string, number>();
  private lastTool: string | undefined;
  private repeats = 0;
  private readonly ruleStates = new Map<string, unknown>();

  constructor(input: { priorTools?: readonly AgentToolRecord[]; stepsTaken?: number } = {}) {
    this.step = input.stepsTaken ?? 0;
    for (const record of input.priorTools ?? []) this.noteToolCall(record.toolName, record.toolCallId);
    this.pending.clear();
  }

  get stepNumber(): number {
    return this.step;
  }

  noteToolCall(toolName: string, toolCallId: string): void {
    if (this.pending.has(toolCallId)) return;
    this.pending.add(toolCallId);
    this.counts.set(toolName, this.count(toolName) + 1);
    this.repeats = this.lastTool === toolName ? this.repeats + 1 : 1;
    this.lastTool = toolName;
  }

  confirmed(toolCallId: string): void {
    this.pending.delete(toolCallId);
  }

  commitStep(): void {
    this.pending.clear();
    this.step += 1;
  }

  ruleState<A>(id: string, initial: () => A): A {
    if (!this.ruleStates.has(id)) this.ruleStates.set(id, initial());
    return this.ruleStates.get(id) as A;
  }

  called(toolName: string): boolean {
    return this.counts.has(toolName);
  }

  calledAny(toolNames: readonly string[]): boolean {
    return toolNames.some((toolName) => this.called(toolName));
  }

  count(toolName: string): number {
    return this.counts.get(toolName) ?? 0;
  }

  streak(toolName: string): number {
    return this.lastTool === toolName ? this.repeats : 0;
  }
}
