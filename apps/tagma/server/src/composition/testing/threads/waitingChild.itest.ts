import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunServices from '@effect/platform-bun/BunServices';
import { eq } from 'drizzle-orm';
import { Context, Effect, FileSystem, Queue, Stream } from 'effect';
import { THREAD_EVENT_SIGNAL_TYPE } from '@runlith/agent/contracts';
import { parseThreadInboxItem } from '@runlith/agent/thread/persisted';
import type { LLMEvent } from '@runlith/llm/schema/events';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { APPROVAL_WAIT_HEADER } from '../../../invocation/contract/wire/headers.js';
import { birthsOf, threadInbox } from '../../../threads/testing/doubles.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { makeDoorWorld } from '../doorFixture.js';
import { gitEffect } from '../graphFixture.js';
import { nativeLeads, subscriptionLogin } from '../claudeLogin.js';

const CALL = 'gated-run';
const TASK = 'Run the gated check.';

const answering = (text: string): readonly LLMEvent[] => [
  { type: 'text-start', id: 'reply' },
  { type: 'text-delta', id: 'reply', text },
  { type: 'text-end', id: 'reply' },
  { type: 'finish', reason: 'stop' },
];

it.live('a child waiting on its own background command does not come to rest until the ending it is owed has run', () =>
  Effect.gen(function* () {
    let gate = '';
    const world = yield* makeDoorWorld({
      models: (standing) => ({
        ...standing,
        request: (input) => ({
          ...standing.request(input),
          stream: (call) => {
            const said = JSON.stringify(call.messages);
            if (said.includes('<command-result>')) return Stream.fromIterable(answering('Checked.'));
            if (call.messages.some((message) => message.content.some((part) => part.type === 'tool-result' && part.id === CALL)))
              return Stream.fromIterable(answering('Started.'));
            if (!said.includes(TASK) || said.includes('<report') || said.includes('came to rest'))
              return Stream.fromIterable(answering('Noted.'));
            return Stream.fromIterable<LLMEvent>([
              { type: 'step-start', index: 0 },
              { type: 'tool-input-start', id: CALL, name: 'bash' },
              {
                type: 'tool-call',
                id: CALL,
                name: 'bash',
                input: { command: `read ready < '${gate}'; echo checked`, waitMs: 0, description: 'Run the gated check' },
              },
              { type: 'step-finish', index: 0, reason: 'tool-calls' },
              { type: 'finish', reason: 'tool-calls' },
            ]);
          },
        }),
      }),
    });
    const account = yield* subscriptionLogin(world);
    yield* nativeLeads(world, account);
    const root = yield* world.directory('waiting-child');
    yield* gitEffect(root, ['init', '-q', '-b', 'main']);
    gate = `${yield* world.directory('waiting-child-gate')}/input`;
    expect((yield* spawnedEffect(['mkfifo', gate])).success).toBe(true);
    const projectId = yield* world.stealthProject(root);
    yield* Context.get(world.runtime.workspace, Coverage).cover(projectId);
    const lead = (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null, account, approvalMode: 'bypass' }))
      .thread.id;

    const settled = yield* Queue.unbounded<string>();
    yield* Context.get(world.runtime.owners, ThreadHarness)
      .runs.settlements()
      .subscribe({
        name: 'waiting-child-boundary',
        at: 'after-stages',
        handle: (run) => Effect.asVoid(Queue.offer(settled, run.threadId)),
      });
    const response = yield* Effect.promise((signal) =>
      world.app(
        new Request(`http://tagma/api/op/spawn_agent?project=${projectId}`, {
          signal,
          method: 'POST',
          headers: { 'content-type': 'application/json', [GRANT_HEADER]: grantFor(lead), [APPROVAL_WAIT_HEADER]: '0' },
          body: JSON.stringify({ agentId: 'tagma', task: TASK, subscribe: {} }),
        }),
        world.routed,
      ),
    );
    const child = ((yield* Effect.promise(() => response.json())) as { readonly threadId: string }).threadId;
    const ended = Effect.fnUntraced(function* () {
      while ((yield* Queue.take(settled)) !== child);
    });
    yield* ended();

    yield* (yield* FileSystem.FileSystem).writeFileString(gate, 'go\n');
    yield* ended();

    const { db } = Context.get(world.runtime.graph, MachineStore);
    const units = Context.get(world.runtime.graph, MachineUnits);
    const rests = Effect.map(
      units.read((unit) => unit.run(db.select().from(threadInbox()).where(eq(threadInbox().threadId, lead)).all())),
      (rows) =>
        rows
          .map(parseThreadInboxItem)
          .flatMap((item) =>
            item.kind === 'signal' && item.body.type === THREAD_EVENT_SIGNAL_TYPE && item.body.text.includes(`(${child}) came to rest`)
              ? [item.body.text]
              : [],
          ),
    );
    let told = yield* rests;
    while (told.length === 0) {
      yield* Effect.sleep(20);
      told = yield* rests;
    }
    expect(told).toHaveLength(1);
    expect(told[0]).not.toContain('Started.');
  }).pipe(Effect.provide(BunServices.layer)),
);
