import { and, eq, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { Terminals } from '../executions/contract/service/terminals.js';
import { principalOf } from '../executions/terminals/principals.js';
import type { MachineStore } from '../platform/contract/service/store.js';
import type { ThreadRecords } from '../thread-record/contract/service/records.js';
import { SessionResolution } from './contract/service/sessionResolution.js';
import { parseExternalSession } from '../threads/contract/wire/harness/externalSession.js';
import { externalSession } from '../threads/store/harnessFacet.js';

const OPERATOR = principalOf({ _tag: 'Operator' });
const ACTIVE = new Set(['starting', 'running', 'stopping', 'uncertain']);

export const sessionResolution = (
  store: MachineStore['Service'],
  terminals: Terminals['Service'],
  records: ThreadRecords['Service'],
): SessionResolution['Service'] =>
  SessionResolution.of({
    resolve: (unit, input) => {
      const shellKey = input.shellKey;
      if (shellKey === null) return Effect.succeed(null);
      return Effect.gen(function* () {
        const shell = yield* terminals.shell(shellKey, unit);
        if (shell === null || shell.transport !== 'pty' || shell.holder !== OPERATOR || shell.launchedFor !== undefined) return null;
        const candidates = yield* unit.run(
          store.db
            .select({ id: externalSession.id, facet: externalSession.facet })
            .from(externalSession)
            .where(
              and(
                eq(externalSession.cli, input.session.harness),
                eq(externalSession.sessionKey, input.session.key),
                sql`json_extract(${externalSession.facet}, '$.execution.execution') = ${shell.execution.execution}`,
                sql`json_extract(${externalSession.facet}, '$.execution.incarnation') = ${shell.execution.incarnation}`,
              ),
            ),
        );
        for (const row of candidates) {
          const facet = yield* Effect.try({
            try: () => parseExternalSession(row.facet),
            catch: () =>
              new GateRefusal('session-unreadable', `External session ${row.id} cannot be decoded.`, [
                'read the session record again after its storage is repaired',
              ]),
          });
          if (
            facet?.session?.origin !== 'adopted' ||
            !ACTIVE.has(facet.session.state) ||
            facet.name !== input.session.harness ||
            facet.sessionKey !== input.session.key ||
            facet.execution?.execution !== shell.execution.execution ||
            facet.execution.incarnation !== shell.execution.incarnation
          )
            continue;
          const facts = yield* records.facts(row.id, unit);
          if (facts === undefined || facts.projectId !== shell.projectId || facts.harness !== input.session.harness) continue;
          return { threadId: row.id, principalId: facts.principalId, projectId: shell.projectId };
        }
        return null;
      }).pipe(
        Effect.mapError((failure) =>
          failure instanceof GateRefusal
            ? failure
            : new GateRefusal(
                'session-unreadable',
                `The external session could not be resolved: ${failure instanceof Error ? failure.message : typeof failure === 'object' && failure !== null && '_tag' in failure ? String(failure._tag) : String(failure)}.`,
                ['read the session record again once storage answers'],
              ),
        ),
      );
    },
  });
