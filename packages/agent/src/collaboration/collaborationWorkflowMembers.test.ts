import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { ThreadWorkflowMembers } from '../thread/ThreadPorts';
import { makeAggregateStorage } from '../thread/storage/InMemoryAggregateStorage';
import type { ThreadWaitArrival } from './arrivals';
import { collaborationWorkflowMembersLayer } from './collaborationWorkflowMembers';
import { ThreadEnvelopes } from './ThreadEnvelopes';
import { ThreadSpawnTree } from './ThreadSpawnTree';
import { Threads } from './threads';
it.effect(
  'a member result keeps the whole text its collection read',
  Effect.fnUntraced(function* () {
    const whole = `Findings of the build.\n\n${'Every step it took, in order. '.repeat(120)}`;
    const arrival: ThreadWaitArrival = {
      from: 'builder',
      intent: 'report',
      envelopeId: 'envelope:final:r1',
      text: whole,
      report: 'final',
    };
    const unused = () => Effect.die('Waiting for workflow reports does not use this operation');
    const envelopes = ThreadEnvelopes.of({
      deliver: unused,
      completeRun: unused,
      withdrawRequest: unused,
      access: () => ({
        send: unused,
        recipients: unused,
        sendAhead: unused,
        settle: unused,
        waitFor: unused,
        collect: () => Effect.succeed(new Map([['builder', arrival]])),
      }),
    });
    const layer = collaborationWorkflowMembersLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(ThreadEnvelopes, envelopes),
          Layer.succeed(
            ThreadSpawnTree,
            ThreadSpawnTree.of({ spawn: unused, answer: unused, limits: unused, listChildren: unused, settled: unused }),
          ),
          Layer.succeed(
            Threads,
            Threads.of({
              find: unused,
              named: unused,
              deleted: unused,
              lineage: unused,
              list: unused,
              watch: unused,
              birthReceipt: unused,
              readBirth: unused,
              create: unused,
            }),
          ),
        ),
      ),
    );
    const answered = yield* Effect.flatMap(ThreadWorkflowMembers, (members) =>
      members.waitForReports({
        thread: makeAggregateStorage().row('plan-thread'),
        members: ['builder'],
        deadlineMs: 60_000,
      }),
    ).pipe(Effect.provide(layer));
    expect([...answered]).toEqual([['builder', whole]]);
  }),
);
