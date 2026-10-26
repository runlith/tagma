import { Context, type Effect } from 'effect';
import type { CommitRecord } from '../wire/enforcement.js';
import type { AfterDelivery, AfterSubject, CheckSubject, Checked, CommitSubject } from '../wire/checks.js';

export class RuleChecks extends Context.Service<
  RuleChecks,
  {
    before(op: string, subject: CheckSubject): Effect.Effect<Checked>;
    after(op: string, subject: AfterSubject): Effect.Effect<AfterDelivery | void>;
    landed(op: string, subject: CommitSubject): Effect.Effect<CommitRecord>;
  }
>()('tagma/enforcement/RuleChecks') {}

export type ActChecks = {
  readonly before: (subject: CheckSubject) => Effect.Effect<Checked>;
  readonly after: (subject: AfterSubject) => Effect.Effect<AfterDelivery | void>;
};

export const actChecks = (checks: RuleChecks['Service'], op: string): ActChecks => ({
  before: (subject) => checks.before(op, subject),
  after: (subject) => checks.after(op, subject),
});
