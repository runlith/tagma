import { Context, type Effect } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { PageId } from '../wire/ids.js';
import type { Glance } from '../wire/page.js';
import type { HotFunction, InsightDetail, InsightName, TraceId, TraceSummary } from '../wire/trace.js';
import type { Drive } from './automation.js';

export type TraceLoad = { readonly cold: boolean; readonly screenshots: boolean; readonly timeoutMs: number };

export type Traced = { readonly page: Glance; readonly summary: TraceSummary };

export type Hot = { readonly set: string; readonly functions: readonly HotFunction[]; readonly total: number };

export class Traces extends Context.Service<
  Traces,
  {
    start(
      page: PageId,
      screenshots: boolean,
      thread: string | null,
    ): Effect.Effect<{ readonly page: Glance; readonly trace: TraceId; readonly path: string }, Drive<'trace-running'>>;
    stop(page: PageId, thread: string | null): Effect.Effect<Traced, Drive<'no-trace' | 'trace-failed'>>;
    load(page: PageId, load: TraceLoad, thread: string | null): Effect.Effect<Traced, Drive<'trace-running' | 'trace-failed'>>;
    summary(trace: TraceId): Effect.Effect<TraceSummary, GateRefusal<'no-trace'>>;
    insight(
      trace: TraceId,
      set: string | undefined,
      insight: InsightName,
    ): Effect.Effect<{ readonly set: string; readonly detail: InsightDetail }, GateRefusal<'no-trace'>>;
    hot(trace: TraceId, set: string | undefined, limit: number): Effect.Effect<Hot, GateRefusal<'no-trace'>>;
  }
>()('tagma/browser/Traces') {}
