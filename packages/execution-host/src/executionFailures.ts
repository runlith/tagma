import { Data } from 'effect';

export class ExecutionUnreadable extends Data.TaggedError('ExecutionUnreadable')<{ readonly execution: string; readonly reason: string }> {
  override get message(): string {
    return `execution ${this.execution} could not be read: ${this.reason}`;
  }
}

export class ExecutionUnrecorded extends Data.TaggedError('ExecutionUnrecorded')<{ readonly execution: string; readonly reason: string }> {
  override get message(): string {
    return `execution ${this.execution} could not be recorded: ${this.reason}`;
  }
}

export class StopUnadmitted extends Data.TaggedError('StopUnadmitted')<{ readonly execution: string; readonly reason: string }> {
  override get message(): string {
    return `stop for execution ${this.execution} was not admitted: ${this.reason}`;
  }
}

export class ExecutionUnknown extends Data.TaggedError('ExecutionUnknown')<{ readonly execution: string }> {
  override get message(): string {
    return `no execution ${this.execution} is held`;
  }
}
