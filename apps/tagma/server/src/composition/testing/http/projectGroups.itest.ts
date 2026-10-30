import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';
import { suiteGit } from '../suiteGit.js';

type Answer = { readonly status: number; readonly body: unknown };
type Row = { readonly id: number; readonly name: string; readonly kind: string };
type Group = { readonly graph: Row; readonly members: readonly Row[] };

const groupOf = (answer: Answer) => (answer.body as { group: Group }).group;
const ids = (group: Group) => group.members.map((member) => member.id);
const codeOf = (answer: Answer) => (answer.body as { code?: string }).code;
const nameOf = (answer: Answer) => (answer.body as { block: { name: string } }).block.name;
const textOf = (answer: Answer) => (answer.body as { text: string }).text;

layer(doorFixture().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('project groups', (it) => {
  it.effect(
    'a group is made, joined and left through its doors, keeps its graph off every checkout, and comes back with that graph under its name once dissolved',
    () =>
      Effect.gen(function* () {
        const world = yield* DoorFixture;
        const alpha = yield* world.stealthProject();
        const beta = yield* world.stealthProject();
        const gamma = yield* world.stealthProject();
        yield* projectLeaving(world, alpha, beta, gamma);
        const name = world.uniqueName();

        const made = yield* world.op('make_group', { name, projects: [String(beta), String(alpha)] });
        expect(made).toMatchObject({ status: 200, body: { group: { graph: { name, kind: 'group' } }, returned: false } });
        const group = groupOf(made);
        expect(ids(group)).toEqual([beta, alpha]);
        expect(codeOf(yield* world.op('make_group', { name: world.uniqueName(), projects: [String(alpha), String(gamma)] }))).toBe(
          'grouped',
        );
        expect(codeOf(yield* world.op('make_group', { name: world.uniqueName(), projects: ['global', String(gamma)] }))).toBe(
          'ungroupable',
        );
        expect(codeOf(yield* world.op('set_project_root', { ref: name, rootPath: yield* world.directory('elsewhere') }))).toBe(
          'group-graph',
        );
        expect(codeOf(yield* world.op('remove_project', { ref: name }))).toBe('group-graph');

        expect(ids(groupOf(yield* world.op('join_group', { group: name, project: String(gamma) })))).toEqual([beta, alpha, gamma]);
        expect(groupOf(yield* world.op('read_group', { ref: String(gamma) })).graph.id).toBe(group.graph.id);

        const lens = `project=${group.graph.id}`;
        const root = ((yield* world.op('list_root_blocks', {}, lens)).body as { blocks: { name: string }[] }).blocks[0]!.name;
        expect(
          codeOf(
            yield* world.op('create_block', { title: 'Names code', parentId: root, sources: [{ kind: 'file', ref: 'src/main.ts' }] }, lens),
          ),
        ).toBe('group-source');
        const contract = yield* world.op('create_block', { title: 'Contract alpha serves and beta calls', parentId: root }, lens);
        const kept = (contract.body as { block: { name: string } }).block.name;
        const alphaRoot = ((yield* world.op('list_root_blocks', {}, `project=${alpha}`)).body as { blocks: { name: string }[] }).blocks[0]!
          .name;
        expect((yield* world.op('link_blocks', { fromId: kept, kind: 'relates', toId: `${alpha}/${alphaRoot}` }, lens)).status).toBe(200);

        expect((yield* world.op('read_graph_remote', { ref: name })).body).toMatchObject({ remote: { remote: null } });
        const bare = yield* world.directory('group-remote');
        yield* suiteGit(bare, 'init', '-q', '--bare');
        expect((yield* world.op('set_graph_remote', { ref: name, remote: bare })).body).toMatchObject({
          remote: { remote: bare, holds: 'this-graph' },
        });

        expect(ids(groupOf(yield* world.op('leave_group', { project: String(gamma) })))).toEqual([beta, alpha]);
        expect((yield* world.op('read_group', { ref: String(gamma) })).body).toMatchObject({ group: null });
        expect((yield* world.op('leave_group', { project: String(alpha) })).body).toMatchObject({ group: null });
        expect((yield* world.op('list_groups', {})).body).toMatchObject({ groups: [] });
        expect((yield* world.op('read_group', { ref: String(beta) })).body).toMatchObject({ group: null });
        expect(codeOf(yield* world.op('leave_group', { project: String(beta) }))).toBe('ungrouped');

        const back = yield* world.op('make_group', { name, projects: [String(gamma), String(beta)] });
        expect(back).toMatchObject({ status: 200, body: { group: { graph: { id: group.graph.id } }, returned: true } });
        expect(ids(groupOf(back))).toEqual([gamma, beta]);
        expect((yield* world.op('read_block', { blockIds: [kept] }, lens)).body).toMatchObject({
          reads: [{ title: 'Contract alpha serves and beta calls' }],
        });
      }),
  );

  it.effect(
    'a member starts with the group root, its own section marked where it stands, every other member and the law of global, group and each member under its name; a project in no group starts as before',
    () =>
      Effect.gen(function* () {
        const world = yield* DoorFixture;
        const alpha = yield* world.stealthProject();
        const beta = yield* world.stealthProject();
        const gamma = yield* world.stealthProject();
        yield* projectLeaving(world, alpha, beta, gamma);
        const start = (projectId: number) => Effect.map(world.op('session_start', {}, `project=${projectId}`), textOf);
        const rootOf = (projectId: number) =>
          Effect.map(
            world.op('list_root_blocks', {}, `project=${projectId}`),
            (answer) => (answer.body as { blocks: { name: string }[] }).blocks[0]!.name,
          );
        const rule = (projectId: number, title: string) =>
          Effect.flatMap(rootOf(projectId), (parentId) =>
            world.op('create_block', { tags: ['rule'], title, parentId }, `project=${projectId}`),
          );
        const before = yield* start(gamma);
        yield* rule(alpha, 'Alpha members keep this');
        yield* rule(beta, 'Beta members keep this');
        const name = world.uniqueName();
        const group = groupOf(yield* world.op('make_group', { name, projects: [String(beta), String(alpha)] }));
        yield* rule(group.graph.id, 'Every member keeps this');
        const [alphaRow, betaRow] = [group.members[1]!, group.members[0]!];

        const text = yield* start(alpha);
        const at = (fragment: string) => {
          const found = text.indexOf(fragment);
          expect(found).toBeGreaterThan(-1);
          return found;
        };
        const order = [
          at(`## ${name} (id ${group.graph.id}) — group root`),
          at(`## ${alphaRow.name} (id ${alpha},`),
          at('— you stand here'),
          at(`## ${betaRow.name} (id ${beta},`),
          at(`Every member keeps this [prompt · ${name}]`),
          at(`Beta members keep this [prompt · ${betaRow.name}]`),
          at(`Alpha members keep this [prompt · ${alphaRow.name}]`),
        ];
        expect(order).toEqual([...order].sort((a, b) => a - b));
        expect(yield* start(gamma)).toBe(before);
      }),
  );

  it.effect('a path inside a member checkout nested in another member answers that member’s owners and code rules', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const outer = yield* world.stealthProject();
      const outerRoot = ((yield* world.op('read_project', { ref: String(outer) })).body as { project: { rootPath: string } }).project
        .rootPath;
      const nestedRoot = `${outerRoot}/vendor/sub`;
      yield* Effect.promise(() => Bun.write(`${nestedRoot}/src/main.ts`, 'export const main = 1;\n'));
      yield* suiteGit(nestedRoot, 'init', '-q', '-b', 'main');
      const nested = (
        (yield* world.op('add_project', { name: world.uniqueName(), rootPath: nestedRoot, storage: 'stealth' })).body as {
          project: { id: number };
        }
      ).project.id;
      yield* projectLeaving(world, outer, nested);
      const sourced = Effect.fnUntraced(function* (projectId: number, tags: readonly string[], title: string, ref: string) {
        const parentId = ((yield* world.op('list_root_blocks', {}, `project=${projectId}`)).body as { blocks: { name: string }[] })
          .blocks[0]!.name;
        return nameOf(yield* world.op('create_block', { tags, title, parentId, sources: [{ kind: 'dir', ref }] }, `project=${projectId}`));
      });
      const outerNote = yield* sourced(outer, [], 'Outer notes on the vendored code', 'vendor/sub');
      yield* sourced(outer, ['rule'], 'Outer law over the vendored code', 'vendor/sub');
      const nestedNote = yield* sourced(nested, [], 'The vendored sources', 'src');
      yield* sourced(nested, ['rule'], 'Vendored law over its sources', 'src');
      expect((yield* world.op('make_group', { name: world.uniqueName(), projects: [String(outer), String(nested)] })).status).toBe(200);
      const here = `cwd=${encodeURIComponent(outerRoot)}`;

      const owners = ((yield* world.op('read_owners', { path: 'vendor/sub/src/main.ts' }, here)).body as { overview: string }).overview;
      expect(owners).toContain(nestedNote);
      expect(owners).not.toContain(outerNote);
      const touched = (yield* world.op('touch_path', { shown: [{ path: 'vendor/sub/src/main.ts', as: 'read' }] }, here)).body as {
        briefs: { rules: { title: string }[] }[];
      };
      expect(touched.briefs.flatMap((brief) => brief.rules.map((rule) => rule.title))).toEqual(['Vendored law over its sources']);
    }),
  );
});
