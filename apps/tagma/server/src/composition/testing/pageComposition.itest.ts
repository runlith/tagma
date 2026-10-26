import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import type { TerminalBytesReading, TerminalOperationReading, TerminalWaited } from '../../executions/contract/wire/operationAnswers.js';
import { makePageWorld } from './pageWorld.js';

class Page extends Context.Service<Page, Effect.Success<ReturnType<typeof makePageWorld>>>()('testing/PageComposition') {}

const performed = Effect.fnUntraced(function* <A>(id: string, payload: unknown) {
  const page = yield* Page;
  return yield* page.perform<A>(id, payload);
});

layer(Layer.effect(Page, makePageWorld()).pipe(Layer.provide(BunFileSystem.layer)), {
  excludeTestServices: true,
  testTimeout: 30_000,
  timeout: 30_000,
})('page composition', (it) => {
  it.effect('the page starts a terminal through the real door, types into its lane, reads its output and observes its exit', () =>
    Effect.gen(function* () {
      const page = yield* Page;
      const answer = yield* performed<typeof TerminalOperationReading.Type>('start_terminal', {
        operationId: 'page-composition-start',
        cwd: page.checkout,
        label: 'page-composition',
        program: '/bin/sh',
        transport: 'pty',
        lifetime: 'held',
        geometry: { rows: 24, columns: 80 },
      });
      expect(answer.operation._tag).toBe('Whole');
      if (answer.operation._tag !== 'Whole') return;
      expect(answer.operation.state._tag).toBe('Settled');
      const settled = answer.operation.state;
      if (settled._tag !== 'Settled') return;
      expect(settled.execution?.execution).toBeTruthy();
      expect(settled.execution?.incarnation).toBe(0);
      expect(settled.execution?.installation).toBeTruthy();
      expect(settled.key).toMatchObject({ mutation: 'start', requester: 'operator', projectId: page.projectId });
      if (settled.execution === undefined) return;
      const address = { execution: settled.execution.execution, incarnation: settled.execution.incarnation };
      yield* Effect.addFinalizer(() =>
        performed('stop_terminal', {
          ...address,
          operationId: 'page-composition-stop',
          cause: 'explicit-stop',
        }).pipe(Effect.orDie),
      );
      const lane = yield* performed<{ readonly binding: string }>('open_terminal_lane', { ...address, view: 'page-composition' });
      expect(lane.binding).toBeTruthy();
      const typed = yield* performed<{ readonly answer: { readonly _tag: string } }>('input_terminal', {
        ...address,
        binding: lane.binding,
        sequence: 0,
        cause: 'typed',
        act: { _tag: 'Write', bytes: Buffer.from("printf 'com%s\\n' posed\nexit\n").toString('base64') },
      });
      expect(typed.answer._tag).toBe('InputAdmitted');
      const ended = yield* performed<typeof TerminalWaited.Type>('wait_terminal', { ...address, waitMs: 30_000 });
      expect(ended.waited._tag).toBe('Decided');
      const bytes = yield* performed<typeof TerminalBytesReading.Type>('read_terminal_bytes', {
        ...address,
        stream: 'pty',
        offset: '0',
        limit: 4096,
        positions: false,
      });
      expect(Buffer.from(bytes.bytes, 'base64').toString('utf8')).toContain('composed');
    }),
  );
});
