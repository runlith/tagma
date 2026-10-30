import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Context, Effect } from 'effect';
import { sql } from 'drizzle-orm';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { sessionFor, sessionOfThread } from '../../../external-harnesses/testing/sessions.js';
import { grantEnvironment } from '../../../platform/testing/grants.js';
import { unmeasuredObservation } from '../../../threads/contract/wire/harness/observation.js';
import { harnessPresentation } from '../../../external-harnesses/contract/service/table.js';
import { BUILTIN_HARNESSES } from '../../../external-harnesses/vendors/builtin.js';
import { builtinHarness } from '../../../external-harnesses/testing/builtin.js';
import { sessionIdentity } from '../../../external-harnesses/sessionPrefix.js';
import { makeTerminalWorld } from '../fixture.js';

it.live('a call trust does not ask about prints nothing at all', () =>
  Effect.gen(function* () {
    const world = yield* makeTerminalWorld();
    const project = yield* world.checkout();
    yield* world.warm(project.id);
    const threadId = '01a09500-0000-7000-8000-0000000000d2';
    const store = Context.get(world.runtime.graph, MachineStore);
    const now = new Date(yield* Clock.currentTimeMillis);
    yield* bornThread(
      store.db,
      {
        id: threadId,
        ownerId: 'operator',
        agentId: 'harness',
        authority: { mode: 'trust', bypassFrom: null },
        status: 'idle',
        createdAt: now,
        updatedAt: now,
        spawnRootId: threadId,
        cacheGroup: threadId,
        name: threadId,
      },
      { projectId: project.id, title: threadId },
    );
    yield* sessionFor(store.db, threadId, {
      name: 'devin',
      presentation: harnessPresentation(builtinHarness('devin')),
      sessionKey: null,
      execution: null,
      observation: unmeasuredObservation(),
    });
    const bare: Record<string, string | undefined> = {};
    for (const { variable } of BUILTIN_HARNESSES) if (variable !== undefined) bare[variable] = undefined;
    const answered = yield* world.tagma(['hook', 'permission-request'], {
      cwd: project.root,
      stdin: JSON.stringify({
        hook_event_name: 'PermissionRequest',
        tool_name: 'exec',
        tool_input: { command: 'git status' },
        tool_use_id: 'exec_0',
        session_id: 'glorious-bell',
      }),
      env: { ...bare, ...grantEnvironment(threadId, sessionIdentity) },
    });
    expect(answered.out).toBe('');
    const facet = yield* sessionOfThread(store.db, threadId);
    const slot = yield* store.db.get<{ asked: string | null }>(
      sql`select pending_interaction as asked from native_thread where id = ${threadId}`,
    );
    expect(slot?.asked ?? null).toBeNull();
    expect(facet?.observation.diagnostics.at(-1)).toMatchObject({ cause: 'execution-unproven' });
  }),
);
