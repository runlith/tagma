import { and, eq, inArray, sql } from 'drizzle-orm';
import { RUN_ENDINGS } from '@runlith/agent/transcript/live';
import { Effect } from 'effect';
import type { StoreDb } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { recordFacts } from '../../thread-record/facts.js';
import type { HarnessSpent } from '../contract/service/harness.js';
import type { HarnessName } from '../contract/wire/harness/names.js';
import { thread, threadRun } from './kernel.js';
import { stored } from '../../platform/store/crossing.js';
import { readableField } from '../../platform/store/readableJson.js';

export const harnessSpend = (
  db: StoreDb<'machine'>,
  units: MachineUnits['Service'],
  name: HarnessName,
  spawnRootId: string,
  principal: string,
) =>
  stored('harnessSpend')(
    units.read((unit) =>
      Effect.map(
        unit.run(
          db
            .select({ runId: threadRun.id, tokens: sql<number | null>`${readableField(threadRun.usage, '$.totalTokens')}` })
            .from(threadRun)
            .innerJoin(recordFacts, eq(recordFacts.id, threadRun.threadId))
            .innerJoin(thread, eq(thread.id, threadRun.threadId))
            .where(
              and(
                inArray(threadRun.status, RUN_ENDINGS),
                eq(recordFacts.spawnRootId, spawnRootId),
                eq(recordFacts.principalId, principal),
                sql`${readableField(thread.transport, '$.profile')} = ${name}`,
              ),
            ),
        ),
        (rows): HarnessSpent => ({
          tokens: rows.reduce((sum, row) => sum + (row.tokens ?? 0), 0),
          unmeasured: rows.flatMap((row) => (row.tokens === null ? [row.runId] : [])),
        }),
      ),
    ),
  );
