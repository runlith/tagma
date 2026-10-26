import { Effect } from 'effect';
import { resolve } from 'node:path';
import { ORIENTATION_OPERATIONS } from '../../graph/contract/wire/operations/orientation.js';
import { CHANGE_WRITES } from '../../change-record/contract/wire/writes.js';
import { performOver, type PerformRequest } from '../../platform/contract/service/perform.js';
import type { Invocation } from '../../platform/cli/verb.js';
import { HOOK_OPERATIONS } from '../contract/wire/hooks.js';
import type { HookConnect, HookDoor } from './delivery.js';

export type HookClient = {
  readonly operations: { readonly perform: (request: PerformRequest) => Effect.Effect<unknown, unknown> };
};

const said = <S extends string, A extends { readonly status: string }>(status: S, answer: A): Extract<A, { readonly status: S }> => {
  if (answer.status !== status) throw new Error(`the door answered ${answer.status}, not ${status}`);
  return answer as Extract<A, { readonly status: S }>;
};

const doorOver = (client: HookClient): HookDoor => {
  const run = performOver(client.operations.perform);
  return {
    orientation: {
      sessionStart: ({ query }) =>
        Effect.map(run(ORIENTATION_OPERATIONS.session_start, {}, { cwd: query.cwd }), (answer) => said('ok', answer).text),
      touch: ({ query, shown }) =>
        Effect.map(
          run(
            ORIENTATION_OPERATIONS.touch_path,
            { shown: shown.map((one) => ({ ...one, path: resolve(query.cwd, one.path) })) },
            { cwd: query.cwd },
          ),
          (answer) => {
            const touched = said('ok', answer);
            return { briefs: touched.briefs, places: touched.places };
          },
        ),
    },
    harness: {
      report: ({ payload }) => Effect.map(run(HOOK_OPERATIONS.report_harness_event, payload, {}), (answer) => said('reported', answer)),
      permission: ({ payload }) =>
        Effect.map(run(HOOK_OPERATIONS.judge_harness_call, payload, {}), (answer) => said('judged', answer).decision),
      permissionOutcome: ({ payload }) =>
        Effect.map(run(HOOK_OPERATIONS.record_harness_outcome, payload, {}), (answer) => said('outcome', answer).answer),
      guide: ({ payload }) =>
        Effect.map(run(HOOK_OPERATIONS.guide_harness, payload, {}), (answer) => ({ text: said('guided', answer).text })),
      adopt: ({ query, payload }) =>
        Effect.map(run(HOOK_OPERATIONS.adopt_harness_session, payload, { cwd: query.cwd }), (answer) => said('adopted', answer)),
    },
    operations: client.operations,
    changes: {
      record: ({ query, payload }) => run(CHANGE_WRITES.record_write, payload, { cwd: query.cwd }),
    },
  };
};

export const hookConnectOver =
  (connect: (at: Invocation) => Effect.Effect<HookClient>): HookConnect =>
  (at) =>
    Effect.map(connect(at), doorOver);
