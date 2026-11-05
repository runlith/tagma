import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Fiber, FileSystem } from 'effect';
import { claudeCodeDescription } from '@runlith/adapter-anthropic/models/anthropic';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { APPROVAL_WAIT_HEADER, CALL_HEADER } from '../../../invocation/contract/wire/headers.js';
import { ThreadRecords } from '../../../thread-record/contract/service/records.js';
import { claudeLogin, hostedDefaults } from '../claudeLogin.js';
import { heard, until } from './protocolRig.js';
import { ProtocolWorld, protocolWorld } from './protocolWorld.js';

layer(protocolWorld({ name: 'hosted-close', prepare: (world) => Effect.andThen(claudeLogin(world), hostedDefaults(world)) }), {
  excludeTestServices: true,
})('a hosted turn about to end', (it) => {
  it.effect('a reader on Claude Code that ends in text is not reminded, and its last message is its answer', () =>
    Effect.gen(function* () {
      const { world, projectId, agent, birth } = yield* ProtocolWorld;
      const files = yield* FileSystem.FileSystem;
      const report = yield* agent('reader');
      yield* files.writeFileString(`${report}.model`, claudeCodeDescription.lightTextModel?.model ?? '');
      const caller = yield* birth();
      const asking = yield* Effect.forkScoped(
        world.op('ask', { questions: ['WAIT: where does the floor live?'] }, `project=${projectId}`, {
          [GRANT_HEADER]: grantFor(caller),
          [APPROVAL_WAIT_HEADER]: '0',
          [CALL_HEADER]: 'hosted-ask',
        }),
      );
      yield* until(
        Effect.map(heard(report), (lines) => (lines.some((line) => line.method === 'session/prompt') ? true : null)),
        'the question reached the reader',
        report,
      );
      const reader = (yield* Context.get(world.runtime.owners, ThreadRecords).subtree(caller)).find((id) => id !== caller) ?? '';
      const asReader = (id: string, input: object) => world.op(id, input, `project=${projectId}`, { [GRANT_HEADER]: grantFor(reader) });
      yield* asReader('open_hosted_turn', {});
      expect((yield* asReader('close_hosted_turn', { id: 'end', text: 'waited' })).body).toEqual({ status: 'closed', guide: null });
      yield* files.writeFileString(`${report}.release`, 'release');
      expect((yield* Fiber.join(asking)).body).toMatchObject({ status: 'asked', entries: [{ status: 'answered', text: 'waited' }] });
    }),
  );
});
