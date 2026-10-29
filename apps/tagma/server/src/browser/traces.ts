import { pageRows } from '@runlith/paging';
import { Effect } from 'effect';
import { body, type OperationPair, pair } from '../platform/contract/service/body.js';
import { ceilingOf } from '../platform/contract/wire/pageFamily.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { Traces } from './contract/service/traces.js';
import { HOT_ROWS, LOAD_TIMEOUT_MS } from './contract/wire/trace.js';
import { TRACE_OPERATIONS as TRACE, type TraceOperationId } from './contract/wire/traceOperations.js';
import { pageOf } from './operations.js';

const HOT_CEILING = ceilingOf(HOT_ROWS);

export const TRACE_PAIRS: { readonly [K in TraceOperationId]: OperationPair<(typeof TRACE)[K]> } = {
  trace_page: pair(
    TRACE.trace_page,
    body(TRACE.trace_page, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const { page, thread } = yield* pageOf(caller, input.page);
        const traces = yield* Traces;
        if (input.action === 'start')
          return { status: 'started' as const, ...(yield* traces.start(page, input.screenshots === true, thread)) };
        const traced =
          input.action === 'stop'
            ? yield* traces.stop(page, thread)
            : yield* traces.load(
                page,
                { cold: input.cold === true, screenshots: input.screenshots === true, timeoutMs: input.timeoutMs ?? LOAD_TIMEOUT_MS },
                thread,
              );
        return { status: 'traced' as const, page: traced.page, ...traced.summary };
      }),
    }),
  ),
  read_page_trace: pair(
    TRACE.read_page_trace,
    body(TRACE.read_page_trace, {
      execute: Effect.fnUntraced(function* (input) {
        if (input.insight !== undefined && input.hot === true)
          return yield* new GateRefusal('action-shape', 'name `insight` or `hot`, not both', [
            'read the insight and the hot functions in two calls',
          ]);
        const traces = yield* Traces;
        if (input.insight !== undefined) {
          const read = yield* traces.insight(input.trace, input.set, input.insight);
          return { status: 'insight' as const, trace: input.trace, set: read.set, ...read.detail };
        }
        if (input.hot === true) {
          const read = yield* traces.hot(input.trace, input.set, pageRows(input.limit, HOT_ROWS, HOT_CEILING));
          return { status: 'hot' as const, trace: input.trace, ...read, shown: read.functions.length };
        }
        return { status: 'summary' as const, ...(yield* traces.summary(input.trace)) };
      }),
    }),
  ),
};
