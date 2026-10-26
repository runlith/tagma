import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Clock, Effect, type Scope } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import { assistantMessageEntryId } from '../../transcript/entryNames';
import { threadUserMessageEvent, type ThreadEventBody } from '../events';
import { lifecycleWorld } from './lifecycleWorld';
import type { ThreadStorageFactory } from './storagePort';
import { opened, report } from './transport';

export function describeReportCredit<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: crash recovery credit of transport reports`, () => {
    test(
      'a recovered run renews its crash recovery credit with the first agent entry it reports, not with words it was given',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const run = yield* opened(world);
        const reports = world.reports.of('native');
        const resumes = () => Effect.map(world.runs.runById(run.id), (row) => row?.resumes);
        yield* world.runs.adoptRun(run.id, {
          selector: { kind: 'dropped', failure: 'the pipe closed' },
          maxResumes: 2,
          progress: { stage: 'running', message: null },
          heartbeatAt: new Date(yield* Clock.currentTimeMillis),
        });
        expect(yield* resumes()).toBe(1);
        yield* report(world, reports.recorded(run, [threadUserMessageEvent({ id: run.id }, { text: 'more', reader: false })], 'stdout:1'));
        expect(yield* resumes()).toBe(1);
        const said: ThreadEventBody = {
          kind: 'message',
          payload: {
            entry: {
              type: 'message',
              id: assistantMessageEntryId(run.id, 0),
              role: 'assistant',
              runId: run.id,
              text: 'Done.',
              occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
            },
            messages: [Message.assistant('Done.')],
          },
        };
        yield* report(world, reports.recorded(run, [said], 'stdout:2'));
        expect(yield* resumes()).toBe(0);
      }),
    );
  });
}
