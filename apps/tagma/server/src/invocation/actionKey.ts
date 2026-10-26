import { Effect } from 'effect';
import { Worker } from 'node:worker_threads';
import { GateRefusal } from '../platform/contract/wire/refusal.js';

import type { PermissionSubject, Raised } from '@runlith/agent/permissions';
import type { ApprovalRoute } from '../platform/contract/wire/approval.js';

export type ActionKeyInput = {
  readonly id: string;
  readonly thread: string | null;
  readonly input: unknown;
  readonly route: ApprovalRoute;
  readonly raised: readonly Raised[];
  readonly subjects: readonly PermissionSubject[];
};

function canonical(value: ActionKeyInput): string {
  function ordered(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(ordered);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, value]) => [key, ordered(value)]),
      );
    }
    return value;
  }
  const raised = value.raised
    .map(({ condition, fact }) => ({ condition, fact }))
    .sort((a, b) => (a.condition < b.condition ? -1 : a.condition > b.condition ? 1 : a.fact < b.fact ? -1 : a.fact > b.fact ? 1 : 0));
  return JSON.stringify(
    ordered({
      id: value.id,
      thread: value.thread,
      input: value.input,
      route: value.route,
      raised,
      subjects: value.subjects,
    }),
  );
}

const source = `
const { parentPort } = require('node:worker_threads');
const { createHash } = require('node:crypto');
const canonical = ${canonical.toString()};
parentPort.once('message', (value) => {
  parentPort.postMessage(createHash('sha256').update(canonical(value)).digest('hex'));
});
`;

const failed = (cause: unknown) =>
  new GateRefusal('approval-pending', `The exact act could not be named for approval: ${String(cause)}`, [
    'repeat the act once its input can be read',
  ]);

export const actionKey = (value: ActionKeyInput): Effect.Effect<string, GateRefusal<'approval-pending'>> =>
  Effect.acquireUseRelease(
    Effect.try({ try: () => new Worker(source, { eval: true }), catch: failed }),
    (worker) =>
      Effect.callback<string, GateRefusal<'approval-pending'>>((resume) => {
        let answered = false;
        worker.once('message', (key: unknown) => {
          answered = true;
          resume(typeof key === 'string' ? Effect.succeed(key) : Effect.fail(failed('the key worker answered an unreadable key')));
        });
        worker.once('error', (cause) => resume(Effect.fail(failed(cause))));
        worker.once('exit', (code) => {
          if (!answered) resume(Effect.fail(failed(`the key worker ended with ${code} before answering`)));
        });
        try {
          worker.postMessage(value);
        } catch (cause) {
          resume(Effect.fail(failed(cause)));
        }
      }),
    (worker) => Effect.asVoid(Effect.promise(() => worker.terminate())),
  );
