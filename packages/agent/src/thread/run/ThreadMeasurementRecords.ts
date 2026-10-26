import type { AgentCallMeasurement } from '../../agent/AgentCallMeasurement';
import { threadMeasurementEvent, type ThreadEventBody } from '../events';

export class ThreadMeasurementRecords {
  private readonly taken: AgentCallMeasurement[] = [];

  measured(measurement: AgentCallMeasurement): void {
    this.taken.push(measurement);
  }

  pending(): readonly ThreadEventBody[] {
    return this.taken.map((measurement) => threadMeasurementEvent(measurement));
  }

  take(count: number): void {
    this.taken.splice(0, count);
  }

  get count(): number {
    return this.taken.length;
  }
}
