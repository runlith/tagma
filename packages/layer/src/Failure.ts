import { Service } from './key.js';
import { Layer } from './Layer.js';

export class Failure extends Service<Failure>()('Failure', { tier: 'app' }) {
  static make(): Failure {
    return new Failure(undefined);
  }

  static of(report: (reason: unknown) => void) {
    return Layer.of(Failure, new Failure(report));
  }

  constructor(private readonly reader: ((reason: unknown) => void) | undefined) {
    super();
  }

  report(reason: unknown): void {
    if (this.reader) {
      this.reader(reason);
      return;
    }
    queueMicrotask(() => {
      throw reason;
    });
  }
}
