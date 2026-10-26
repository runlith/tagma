import type { Answered } from './declaration.js';

export class Answers<A> {
  private readonly outcomes = new Map<string, A | null>();

  expect(request: string): void {
    this.outcomes.set(request, null);
  }

  outcome(request: string): A | null {
    return this.outcomes.get(request) ?? null;
  }

  forget(request: string): void {
    this.outcomes.delete(request);
  }

  settle(answered: Answered<A>): void {
    if (this.outcomes.has(answered.request)) this.outcomes.set(answered.request, answered.outcome);
  }
}
