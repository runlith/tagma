import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { mcpCallTool } from '@runlith/mcp/testing/sdk';
import { world } from '@runlith/testbed/worlds';
import { terminalWorld } from '../fixture.js';
import { Context, Effect, Layer, Schema } from 'effect';
import { grantEnvironment } from '../../../platform/testing/grants.js';
import { sessionIdentity } from '../../../external-harnesses/testing/builtin.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { sqliteThreadJournal } from '../../../threads/testing/doubles.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { OPERATOR_PRINCIPAL } from '../../../platform/contract/wire/actor.js';
import { evidenceAnswerSchema } from '../../../threads/contract/wire/evidence.js';
import { makeMcpWorld } from './mcpRig.js';

const setup = Effect.gen(function* () {
  const rig = yield* makeMcpWorld();
  const reader = crypto.randomUUID();
  const member = crypto.randomUUID();
  const { db } = Context.get(rig.world.runtime.graph, MachineStore);
  yield* Effect.provide(
    Effect.forEach([reader, member], (id) =>
      bornThread(
        db,
        {
          id,
          ownerId: OPERATOR_PRINCIPAL,
          agentId: 'tagma',
          authority: { mode: 'bypass', bypassFrom: null },
          status: 'idle',
          spawnRootId: reader,
          parentThreadId: id === reader ? null : reader,
        },
        { projectId: rig.project.id, title: id },
      ),
    ),
    yield* rig.world.runtime.runtime.contextEffect,
  );
  const env = grantEnvironment(reader, sessionIdentity);
  const bridge = yield* rig.bridge('codex', { ...env, CODEX_THREAD_ID: 'evidence-reader' });
  const journal = yield* Effect.provide(sqliteThreadJournal(), rig.world.runtime.graph);
  const append = (threadId: string, text: string) => {
    const id = crypto.randomUUID();
    return Context.get(rig.world.runtime.graph, MachineUnits).write('threadEvidence.append', (unit) =>
      journal.append({ threadId, id, kind: 'message', payload: { entry: { type: 'message', id, role: 'user', text } } }, unit),
    );
  };
  return { ...rig, reader, member, bridge, env, append };
});
class Reading extends Context.Service<Reading, Effect.Success<typeof setup>>()('testing/ThreadEvidenceCli') {}

const answerSchema = Schema.Struct({ status: Schema.Literal('ok'), evidence: evidenceAnswerSchema });
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(answerSchema));

const readingLayer = Layer.effect(Reading, setup).pipe(Layer.provide(world(terminalWorld, {})));

layer(readingLayer, { excludeTestServices: true })('thread evidence CLI and MCP', (it) => {
  it.effect('a cursor alone continues a selected tree through both doors at its pinned heads', () =>
    Effect.gen(function* () {
      const { world, project, reader, member, bridge, call, env, append } = yield* Reading;
      yield* append(reader, 'a');
      yield* append(member, 'b');
      yield* append(reader, 'c');
      const cli = (input: Record<string, unknown>) =>
        world.spawned(['op', 'read_thread', '--json', '--project', project.name, JSON.stringify(input)], { cwd: project.root, env });
      const question = {
        selection: { of: reader, reach: 'tree', set: 'all' },
        select: 'entries',
        fields: ['entry.text'],
        limit: 2,
      };
      const opened = yield* cli(question);
      expect(opened).toMatchObject({ code: 0 });
      const first = (yield* decode(opened.out)).evidence;
      expect(first.rows).toHaveLength(2);
      expect(first.over).toBe(2);
      expect(first.cursor).toEqual(expect.any(String));
      yield* append(reader, 'd');
      const continued = yield* cli({ cursor: first.cursor });
      expect(continued).toMatchObject({ code: 0 });
      const rest = (yield* decode(continued.out)).evidence;
      expect(rest.rows).toHaveLength(1);
      expect([...first.rows, ...rest.rows].map((row) => row['entry.text']).sort()).toEqual(['a', 'b', 'c']);
      expect(rest.threads).toEqual(first.threads);
      expect(rest.cursor).toBeNull();
      const result = yield* mcpCallTool(bridge, 'read_thread', { cursor: first.cursor, json: true }, call);
      const content = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ content: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) })) }),
      )(result);
      const text = content.content.flatMap((part) => (part.type === 'text' && part.text !== undefined ? [part.text] : [])).join('\n');
      expect((yield* decode(text)).evidence).toEqual(rest);
      const changed = yield* cli({ ...question, select: 'records', cursor: first.cursor });
      expect(changed.code).toBe(2);
      expect(JSON.parse(changed.out)).toMatchObject({ code: 'cursor-stale' });
    }),
  );
});
