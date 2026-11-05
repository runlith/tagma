import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq } from 'drizzle-orm';
import { Context, Effect, Fiber, FileSystem } from 'effect';
import { claudeCodeDescription } from '@runlith/adapter-anthropic/models/anthropic';
import { coreEntry } from '@runlith/agent/transcript/kinds';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { APPROVAL_WAIT_HEADER, CALL_HEADER } from '../../../invocation/contract/wire/headers.js';
import { ThreadRecords } from '../../../thread-record/contract/service/records.js';
import { threadEntry } from '../../../threads/testing/doubles.js';
import { claudeLogin, hostedDefaults } from '../claudeLogin.js';
import { heard, signal, until } from './protocolRig.js';
import { ProtocolWorld, protocolWorld } from './protocolWorld.js';

layer(protocolWorld({ name: 'hosted-close', prepare: (world) => Effect.andThen(claudeLogin(world), hostedDefaults(world)) }), {
  excludeTestServices: true,
})('a hosted turn about to end', (it) => {
  it.effect('a reader on Claude Code that ends in text is reminded once in its run to answer, and its answer closes its report', () =>
    Effect.gen(function* () {
      const { world, projectId, agent, birth, changes } = yield* ProtocolWorld;
      const files = yield* FileSystem.FileSystem;
      const report = yield* agent('reader');
      yield* files.writeFileString(`${report}.model`, claudeCodeDescription.lightTextModel?.model ?? '');
      const caller = yield* birth();
      const asking = yield* Effect.forkScoped(
        world.op('ask', { questions: ['HOLD: where does the floor live?'] }, `project=${projectId}`, {
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
      const closed = (id: string) =>
        Effect.map(asReader('close_hosted_turn', { id, text: 'The floor lives in floor/.' }), (answer) => answer.body);
      const reminded = yield* closed('first');
      expect(reminded).toMatchObject({ status: 'closed', guide: expect.any(String) });
      expect(yield* closed('first')).toEqual(reminded);
      expect(yield* closed('second')).toEqual({ status: 'closed', guide: null });
      const db = Context.get(world.runtime.graph, MachineStore).db;
      const entries = yield* Context.get(world.runtime.graph, MachineUnits).read((unit) =>
        unit.run(db.select().from(threadEntry()).where(eq(threadEntry().threadId, reader)).all()),
      );
      expect(
        entries.filter(
          ({ entry }) =>
            coreEntry(entry) && entry.type === 'runtime-guidance' && entry.sources.some((source) => source.state?.closing === true),
        ),
      ).toHaveLength(1);
      const answer = {
        toolCallId: 'reader-answer',
        name: 'answer',
        input: { text: 'The floor lives in floor/.', evidence: ['floor/index.ts:1'], complete: true },
      };
      yield* signal(`${report}.announce`, JSON.stringify(answer));
      yield* until(
        Effect.map(files.readFileString(`${report}.out`), (out) => (out.includes('said-reader-answer') ? true : null)),
        'the reader sealed its answer',
        report,
        changes(reader),
      );
      expect((yield* asReader('call_hosted_tool', answer)).body).toMatchObject({ failed: false });
      yield* files.writeFileString(`${report}.release`, 'release');
      expect((yield* Fiber.join(asking)).body).toMatchObject({ status: 'asked', entries: [{ status: 'answered' }] });
    }),
  );
});
