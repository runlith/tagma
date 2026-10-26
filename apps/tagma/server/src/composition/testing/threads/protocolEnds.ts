import { sql } from 'drizzle-orm';
import { Context, Effect } from 'effect';
import { MachineStore } from '../../../platform/contract/service/store.js';

export type RunEnd = { readonly status: string; readonly failure: string | null };

export const runEnd = Effect.fn('testing.protocolRunEnd')(function* (context: Context.Context<MachineStore>, threadId: string) {
  const row = yield* Effect.orDie(
    Context.get(context, MachineStore).db.get<{ readonly status: string; readonly failure: string | null }>(
      sql`select status, failure_reason as failure from thread_run where thread_id = ${threadId} and status != 'running' order by created_at desc, id desc limit 1`,
    ),
  );
  return row ?? null;
});
