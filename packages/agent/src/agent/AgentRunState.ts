type AgentToolCall = {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: unknown;
  readonly stepNumber?: number;
};

type AgentToolResult = {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output: unknown;
  readonly stepNumber?: number;
};

export type AgentStepCommit = {
  readonly toolCalls: readonly AgentToolCall[];
  readonly toolResults: readonly AgentToolResult[];
};

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
  private records: AgentToolRecord[] = [];
  private byCallId = new Map<string, AgentToolRecord>();
  private readonly ruleStates = new Map<string, unknown>();

  constructor(input: { priorTools?: readonly AgentToolRecord[]; stepsTaken?: number } = {}) {
    this.step = input.stepsTaken ?? 0;
    for (const record of input.priorTools ?? []) this.upsert(record);
  }

  get stepNumber(): number {
    return this.step;
  }

  noteToolInput(toolName: string, input: unknown, toolCallId: string, stepNumber?: number): void {
    this.upsert({ toolCallId, toolName, input, stepNumber });
  }

  noteToolOutput(toolName: string, output: unknown, toolCallId: string, stepNumber?: number): void {
    this.upsert({ toolCallId, toolName, output, stepNumber });
  }

  noteToolRefusal(toolName: string, output: unknown, toolCallId: string, stepNumber?: number): void {
    this.upsert({ toolCallId, toolName, output, refused: true, stepNumber });
  }

  commitStep(step: AgentStepCommit): void {
    const stepNumber = this.stepNumber;
    for (const call of step.toolCalls) {
      this.noteToolInput(call.toolName, call.input, call.toolCallId, call.stepNumber ?? stepNumber);
    }
    for (const result of step.toolResults) {
      if (this.byCallId.get(result.toolCallId)?.output !== undefined) continue;
      this.noteToolOutput(result.toolName, result.output, result.toolCallId, result.stepNumber ?? stepNumber);
    }
    this.step += 1;
  }

  ruleState<A>(id: string, initial: () => A): A {
    if (!this.ruleStates.has(id)) this.ruleStates.set(id, initial());
    return this.ruleStates.get(id) as A;
  }

  called(toolName: string): boolean {
    return this.records.some((record) => record.toolName === toolName);
  }

  calledAny(toolNames: readonly string[]): boolean {
    return toolNames.some((toolName) => this.called(toolName));
  }

  count(toolName: string): number {
    return this.records.filter((record) => record.toolName === toolName).length;
  }

  streak(toolName: string): number {
    let count = 0;
    for (const record of [...this.records].reverse()) {
      if (record.toolName !== toolName) break;
      count += 1;
    }
    return count;
  }

  sequence(toolNames: readonly string[]): boolean {
    if (toolNames.length > this.records.length) return false;
    const tail = this.records.slice(this.records.length - toolNames.length);
    return toolNames.every((toolName, index) => tail[index]?.toolName === toolName);
  }

  latestOutput(toolName: string): unknown {
    for (const record of [...this.records].reverse()) {
      if (record.toolName === toolName && record.output !== undefined && !record.refused) return record.output;
    }
    return undefined;
  }

  toolsSoFar(): readonly AgentToolRecord[] {
    return this.records.slice();
  }

  private upsert(next: AgentToolRecord): void {
    const existing = this.byCallId.get(next.toolCallId);
    if (existing) {
      const merged = { ...existing, ...next };
      this.byCallId.set(next.toolCallId, merged);
      const index = this.records.findIndex((record) => record.toolCallId === next.toolCallId);
      if (index >= 0) this.records[index] = merged;
      return;
    }
    this.byCallId.set(next.toolCallId, next);
    this.records.push(next);
  }
}
