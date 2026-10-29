import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import type { McpServerDeclaration } from '@runlith/mcp/declaration';
import { Context, Effect, Layer, Result, Schema } from 'effect';
import { type EffectDemo, demoGraphLayer, withDemo } from './graphFixture.js';
import type { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { McpServers } from '../../mcp/contract/service/servers.js';
import { mcpServersLayer } from '../../mcp/testing/doubles.js';
import { ProjectChanges } from '../../projects/contract/service/changes.js';
import { Settings } from '../../settings/contract/service/values.js';
import { type CatalogOperationId, OPERATIONS } from '../catalog.js';
import { mcpServers } from '../../mcp/contract/wire/settings.js';

function names(operation: CatalogOperationId, refusal: GateRefusal, code: string): void {
  expect({ operation, code: refusal.code }).toEqual({ operation, code });
  const declared: readonly string[] = OPERATIONS[operation].refusals;
  expect(declared).toContain(refusal.code);
}

const create = (demo: EffectDemo, tag: 'spec' | 'idea' | 'task', title: string) =>
  Effect.map(
    Effect.provide(demo.graph.blocks.create({ projectId: demo.projectId, parentId: demo.root, tags: [tag], title }), demo.context),
    (row) => row.id,
  );

const stdio = (name: string, extra: Partial<McpServerDeclaration> = {}): McpServerDeclaration =>
  ({
    name,
    transport: 'stdio',
    command: 'echo',
    capabilities: { kinds: [], mutates: false },
    enabled: true,
    ...extra,
  }) as McpServerDeclaration;

const serversOver = (demo: EffectDemo, env: Record<string, string>) =>
  Effect.map(
    Layer.build(mcpServersLayer(env)).pipe(
      Effect.provideService(Settings, Context.get(demo.context, Settings)),
      Effect.provideService(ProjectChanges, Context.get(demo.context, ProjectChanges)),
    ),
    (context) => Context.get(context, McpServers),
  );

layer(demoGraphLayer(), { excludeTestServices: true })('operation refusals', (it) => {
  it.effect('claim_block names the refusal a replaced task answers with', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const taskId = yield* create(demo, 'task', 'replaced');
        const heirId = yield* create(demo, 'task', 'heir');
        yield* Effect.provide(demo.graph.standing.supersede({ oldId: taskId, withId: heirId }), demo.context);
        names('claim_block', yield* demo.refusal(demo.graph.tasks.claim({ id: taskId })), 'superseded');
      }),
    ),
  );

  it.effect('finish_block names the refusal a finished task answers with', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const doneId = yield* create(demo, 'task', 'already done');
        yield* Effect.provide(demo.graph.tasks.finish({ id: doneId }), demo.context);
        names('finish_block', yield* demo.refusal(demo.graph.tasks.finish({ id: doneId })), 'illegal-transition');
      }),
    ),
  );

  it.effect('the MCP operations name every code their own gates raise', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const servers = yield* serversOver(demo, { GH_TOKEN: 'held' });
        const project = { projectId: demo.projectId, scope: 'project' } as const;
        const run = <A, E>(work: Effect.Effect<A, E, never>) => Effect.provide(work, demo.context);

        yield* run(servers.add({ ...project, declaration: stdio('files') }));
        names('add_mcp_server', yield* demo.refusal(servers.add({ ...project, declaration: stdio('files') })), 'mcp-server-exists');
        names('remove_mcp_server', yield* demo.refusal(servers.remove({ ...project, name: 'absent' })), 'mcp-server-unknown');

        const unclassified = Schema.decodeUnknownResult(OPERATIONS.add_mcp_server.params)({
          name: 'files',
          transport: 'stdio',
          command: 'echo',
        });
        expect(Result.isFailure(unclassified)).toBe(true);
      }),
    ),
  );

  it.effect('write_setting names the refusal a managed key raises, for a value and for a clear', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { projectId } = demo;
        const settings = Context.get(demo.context, Settings);
        const run = <A, E>(work: Effect.Effect<A, E, never>) => Effect.provide(work, demo.context);
        const written = yield* demo.refusal(settings.write({ scope: 'project', projectId, key: 'mcp.servers', value: [] }));
        names('write_setting', written, 'setting-managed');
        expect(written.reason).toContain('add_mcp_server');

        names('write_setting', yield* demo.refusal(settings.write({ scope: 'project', projectId, key: 'mcp.servers' })), 'setting-managed');

        const servers = yield* serversOver(demo, {});
        yield* run(servers.add({ projectId, scope: 'project', declaration: stdio('files') }));
        const standing = yield* run(settings.value(mcpServers, projectId));
        expect(standing.map((entry) => entry.name)).toEqual(['files']);

        yield* demo.refusal(settings.write({ scope: 'project', projectId, key: 'mcp.servers' }));
        expect((yield* run(settings.value(mcpServers, projectId))).map((entry) => entry.name)).toEqual(['files']);
      }),
    ),
  );
});
