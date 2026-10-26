import { describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { existsSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { Context, Effect, FileSystem, Schema } from 'effect';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { Compaction } from '../../../native-harness/contract/service/context.js';
import { compactionChoicesSchema } from '../../../native-harness/contract/wire/compactionChoices.js';
import { threadRun, turnsOf } from '../../../threads/testing/doubles.js';
import { claudeLogin, hostedDefaults } from '../claudeLogin.js';
import { heard, LIBRARY, until } from './protocolRig.js';
import { ProtocolWorld, protocolWorld } from './protocolWorld.js';

const DEFERRED = 'apply_batch';

const offeredSchema = Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) });

describe.skipIf(!existsSync(LIBRARY))('the tools Tagma serves a Claude Code thread over its MCP door', () => {
  layer(protocolWorld({ name: 'hosted-reveals', prepare: (world) => Effect.andThen(claudeLogin(world), hostedDefaults(world)) }), {
    excludeTestServices: true,
  })('protocol world', (it) => {
    it.effect('a deferred tool revealed before Claude Code compacts its session is still served on the next turn', () =>
      Effect.gen(function* () {
        const { world, projectId, agent, birth } = yield* ProtocolWorld;
        const files = yield* FileSystem.FileSystem;
        const report = yield* agent('reveals');
        const threadId = yield* birth();
        const db = Context.get(world.runtime.graph, MachineStore).db;
        const units = Context.get(world.runtime.graph, MachineUnits);
        const runStatus = (runId: string) =>
          Effect.map(
            units.read((unit) => unit.run(db.select().from(threadRun()).where(eq(threadRun().id, runId)).get())),
            (row) => (row?.status === 'completed' ? true : null),
          );
        const prompted = (count: number) =>
          Effect.map(heard(report), (lines) => (lines.filter((line) => line.method === 'session/prompt').length >= count ? true : null));
        const asThread = (id: string, input: object) => world.op(id, input, `project=${projectId}`, { [GRANT_HEADER]: grantFor(threadId) });
        const turns = turnsOf(world.runtime.owners);

        const first = yield* turns.send(threadId, projectId, 'HOLD the turn');
        yield* until(prompted(1), 'the first turn reached the agent', report);
        yield* asThread('open_hosted_turn', {});
        yield* files.writeFileString(`${report}.search`, `select:${DEFERRED}`);
        yield* until(
          Effect.map(files.readFileString(`${report}.out`), (out) => (out.includes('said-search') ? true : null)),
          'the agent sealed its search',
          report,
        );
        yield* asThread('call_hosted_tool', { toolCallId: 'search-call', name: 'tool_search', input: { query: `select:${DEFERRED}` } });
        yield* files.writeFileString(`${report}.release`, 'release');
        yield* until(runStatus(first.runId), 'the first turn ended', report);
        yield* files.remove(`${report}.release`, { force: true });

        const choices = yield* Schema.decodeUnknownEffect(compactionChoicesSchema)(
          (yield* world.op('read_compaction_choices', { threadId }, `project=${projectId}`)).body,
        );
        if (choices.own === null) return yield* Effect.die('a Claude Code thread folds its own session');
        const folded = yield* Context.get(world.runtime.owners, Compaction).compact(threadId, projectId, {
          summarizer: { provider: choices.own.provider, model: choices.own.model, reasoning: choices.own.reasoning },
        });
        if (folded.status !== 'started') return yield* Effect.die(new Error(`the compaction answered ${folded.status}`));
        yield* until(runStatus(folded.runId), 'Claude Code compacted its session', report);

        yield* turns.send(threadId, projectId, 'HOLD the next turn');
        yield* until(prompted(2), 'the next turn reached the agent', report);
        yield* asThread('open_hosted_turn', {});
        const served = yield* Schema.decodeUnknownEffect(offeredSchema)((yield* asThread('read_hosted_tools', {})).body);
        expect(served.tools.map((tool) => tool.name)).toContain(DEFERRED);
      }),
    );
  });
});
