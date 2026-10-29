import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { keyedServer } from '@runlith/mcp/testing/keyed';
import { Context, Effect } from 'effect';
import { McpServers } from '../../../mcp/contract/service/servers.js';
import { doorFixture, DoorFixture, projectLeaving } from '../doorFixture.js';

const FIRST = 'keyed-first-6f1c9e';
const SECOND = 'keyed-second-27d4b0';
const WRONG = 'keyed-wrong-81aa3d';

type Row = {
  readonly name: string;
  readonly status: string;
  readonly tools: number;
  readonly needs?: readonly string[];
  readonly failure?: string;
};

layer(doorFixture(), { excludeTestServices: true })('mcp secrets', (it) => {
  it.effect(
    'a ${NAME} set through set_secret connects its server in its own project only, removing the server drops it, and no answer carries it',
    () =>
      Effect.gen(function* () {
        const world = yield* DoorFixture;
        const { url } = yield* keyedServer(FIRST, SECOND);
        const first = yield* world.plainProject();
        const second = yield* world.plainProject();
        yield* projectLeaving(world, first, second);
        const answered = Effect.fnUntraced(function* (id: string, input: unknown, project: number) {
          const answer = yield* world.op(id, input, `project=${project}`);
          if (answer.status !== 200) return yield* Effect.die(new Error(`${id} answered ${answer.status}: ${JSON.stringify(answer.body)}`));
          return { text: JSON.stringify(answer.body), body: answer.body as { readonly mcp?: readonly Row[] } };
        });
        const keyedIn = Effect.fnUntraced(function* (project: number) {
          const { text, body } = yield* answered('read_mcp_servers', {}, project);
          return { text, row: body.mcp?.find((row) => row.name === 'keyed') };
        });
        const declaration = {
          name: 'keyed',
          transport: 'http',
          url,
          headers: { Authorization: 'Bearer ${KEYED_TOKEN}' },
          capabilities: { kinds: ['network'], mutates: false },
        };
        const target = { owner: 'mcp', id: 'project/keyed', name: 'KEYED_TOKEN' };

        const added = yield* answered('add_mcp_server', declaration, first);
        expect(added.body.mcp?.find((row) => row.name === 'keyed')).toMatchObject({ status: 'needs-value', needs: ['KEYED_TOKEN'] });
        yield* answered('add_mcp_server', declaration, second);
        expect((yield* answered('read_secrets', { owner: 'mcp' }, first)).body).toMatchObject({
          sets: [{ owner: 'mcp', id: 'project/keyed', title: 'keyed', secrets: [{ name: 'KEYED_TOKEN', set: false }], missing: 1 }],
          total: 1,
        });

        yield* answered('set_secret', { ...target, value: WRONG }, first);
        const refused = yield* keyedIn(first);
        expect(refused.row).toMatchObject({ status: 'failed', failure: expect.stringContaining('refused Bearer [redacted]') });
        expect(refused.text).not.toContain(WRONG);

        const set = yield* answered('set_secret', { ...target, value: FIRST }, first);
        const connected = yield* keyedIn(first);
        expect(connected.row).toMatchObject({ status: 'connected', tools: 1 });
        expect((yield* keyedIn(second)).row).toMatchObject({ status: 'needs-value', needs: ['KEYED_TOKEN'] });
        const secrets = yield* answered('read_secrets', { owner: 'mcp', id: 'project/keyed' }, first);
        expect(secrets.body).toMatchObject({ sets: [{ secrets: [{ name: 'KEYED_TOKEN', set: true }], missing: 0 }] });
        for (const text of [set.text, connected.text, secrets.text]) expect(text).not.toContain(FIRST);
        const echoed = yield* Context.get(world.runtime.owners, McpServers).caller(first).call('keyed', 'whoami', {}, {});
        expect(JSON.stringify(echoed)).toContain('Bearer [redacted]');
        expect(JSON.stringify(echoed)).not.toContain(FIRST);

        yield* answered('set_secret', { ...target, value: SECOND }, second);
        expect((yield* keyedIn(second)).row).toMatchObject({ status: 'connected', tools: 1 });

        yield* answered('remove_mcp_server', { name: 'keyed' }, first);
        const again = yield* answered('add_mcp_server', declaration, first);
        expect(again.body.mcp?.find((row) => row.name === 'keyed')).toMatchObject({ status: 'needs-value', needs: ['KEYED_TOKEN'] });
        yield* answered('remove_mcp_server', { name: 'keyed' }, first);
        yield* answered('remove_mcp_server', { name: 'keyed' }, second);
      }),
  );
});
