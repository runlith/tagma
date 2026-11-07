import { randomUUID } from 'node:crypto';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { demoGraphLayer, tempRootEffect, withDemo, type EffectDemo } from '../../composition/testing/graphFixture.js';
import { contextFilesEnabled, rescanPolicy, skillGlobalDirectories, skillProjectDirectories } from '../contract/wire/sourceSettings.js';
import { WorkspaceGeneration } from '../../workspace/contract/wire/ids.js';
import type { TargetAt } from '../../workspace/contract/wire/place.js';
import { WorkspaceInputs } from '../contract/service/inputs.js';
import { workspaceInputsLayer } from './cache.js';
import { EnabledPlugins, type PluginLoaded } from '../../plugins/contract/service/plugins.js';
import { ProjectGroups } from '../../projects/contract/service/registry.js';
import { enabledPlugins } from '../../plugins/testing/enabled.js';

const at = (threadId: string, runId: string, generation = 0): TargetAt => ({
  threadId,
  runId,
  generation: WorkspaceGeneration.make(generation),
});
const setup = Effect.fnUntraced(function* (demo: EffectDemo, plugins?: EnabledPlugins['Service']) {
  for (const [key, value] of [
    [skillGlobalDirectories.id, []],
    [skillProjectDirectories.id, ['.agents/skills']],
    [contextFilesEnabled.id, false],
    [rescanPolicy.id, 'manual'],
  ] as const)
    yield* demo.graph.settings.write({ scope: 'project', projectId: demo.projectId, key, value });
  const enabled = plugins ?? (yield* enabledPlugins()).service;
  return Context.get(
    yield* Layer.build(workspaceInputsLayer(() => [], [])).pipe(Effect.provideService(EnabledPlugins, enabled)),
    WorkspaceInputs,
  );
});

layer(demoGraphLayer().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('workspace input lifetimes', (it) => {
  it.effect('a run keeps its sources through inspection and invalidation, while its successor resolves fresh ones', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const otherRoot = yield* tempRootEffect(demo.fixture, 'skill-snapshot-other-');
        const other = yield* demo.graph.projectLifecycle.create({ name: 'other', rootPath: otherRoot });
        const cache = yield* setup(demo);
        for (const [key, value] of [
          [skillGlobalDirectories.id, []],
          [skillProjectDirectories.id, ['.agents/skills']],
          [contextFilesEnabled.id, false],
          [rescanPolicy.id, 'manual'],
        ] as const)
          yield* demo.graph.settings.write({ scope: 'project', projectId: other.id, key, value });
        const directory = join(demo.demoRoot, '.agents/skills/writer');
        yield* files.makeDirectory(directory, { recursive: true });
        const path = join(directory, 'SKILL.md');
        yield* files.writeFileString(path, '---\nname: writer\ndescription: Revision A.\n---\nWriter instructions.\n');
        yield* demo.graph.settings.write({ scope: 'project', projectId: demo.projectId, key: 'skills.disabled', value: ['artifacts'] });
        const first = { threadId: 'first', projectId: demo.projectId, root: demo.demoRoot };
        const second = { threadId: 'second', projectId: other.id, root: other.rootPath };
        expect(yield* cache.snapshot('first', 'run-a')).toBeUndefined();
        const before = yield* cache.resolve(first, { kind: 'run', runId: 'run-a', context: null }, at('first', 'run-a'));
        const untouched = yield* cache.resolve(second, { kind: 'run', runId: 'other-a', context: null }, at('second', 'other-a'));
        expect(before.skills.map((skill) => skill.description)).toEqual(['Revision A.']);
        expect(before.disabledSkills).toEqual(new Set(['artifacts']));
        yield* demo.graph.settings.write({ scope: 'project', projectId: demo.projectId, key: 'skills.disabled', value: ['showcase'] });
        yield* files.writeFileString(path, '---\nname: writer\ndescription: Revision B.\n---\nWriter instructions.\n');
        yield* cache.invalidate({ projectId: demo.projectId });
        expect((yield* cache.preview(first)).skills.map((skill) => skill.description)).toEqual(['Revision B.']);
        expect(yield* cache.snapshot('first', 'run-a')).toBe(before);
        expect(yield* cache.resolve(first, { kind: 'run', runId: 'run-a', context: null }, at('first', 'run-a'))).toBe(before);
        expect(yield* cache.resolve(first, { kind: 'tools', runId: 'run-a', context: null }, at('first', 'run-a'))).toBe(before);
        expect(yield* cache.resolve(second, { kind: 'run', runId: 'other-b', context: null }, at('second', 'other-b'))).toBe(untouched);
        const after = yield* cache.resolve(first, { kind: 'run', runId: 'run-b', context: null }, at('first', 'run-b'));
        expect(after.skills.map((skill) => skill.description)).toEqual(['Revision B.']);
        expect(before.disabledSkills).toEqual(new Set(['showcase']));
        expect(after.disabledSkills).toEqual(new Set(['showcase']));
        yield* cache.releaseRun('first', 'run-a');
        expect(yield* cache.snapshot('first', 'run-b')).toBe(after);
        expect(yield* cache.snapshot('first', 'run-a')).toBeUndefined();
        yield* cache.releaseRun('first', 'run-b');
        expect(yield* cache.snapshot('first', 'run-b')).toBeUndefined();
        yield* cache.forget('second');
        expect(yield* cache.snapshot('second', 'other-b')).toBeUndefined();
        const bodyOf = (skill: (typeof after.skills)[number]) => {
          const read = skill.instructions({});
          return typeof read === 'string' ? Effect.succeed(read) : read;
        };
        const bodyBefore = yield* bodyOf(after.skills[0]!);
        yield* files.writeFileString(path, '---\nname: writer\ndescription: Revision B.\n---\nWriter instructions, second pass.\n');
        yield* cache.invalidate({ projectId: demo.projectId });
        const edited = yield* cache.resolve(first, { kind: 'run', runId: 'run-c', context: null }, at('first', 'run-c'));
        expect(edited.skills.map((skill) => skill.id)).toEqual(after.skills.map((skill) => skill.id));
        expect(edited.skills.map((skill) => skill.description)).toEqual(['Revision B.']);
        expect(bodyBefore).toContain('Writer instructions.');
        expect(yield* bodyOf(edited.skills[0]!)).toContain('second pass');
        const broken = join(demo.demoRoot, '.agents/skills/broken');
        yield* files.makeDirectory(broken, { recursive: true });
        yield* files.writeFileString(join(broken, 'SKILL.md'), 'no frontmatter at all\n');
        yield* cache.invalidate({ projectId: demo.projectId });
        const walked = yield* cache.preview(first);
        expect(walked.rejected.map((entry) => entry.path)).toEqual([join(broken, 'SKILL.md')]);
        expect(walked.rejected[0]?.reason.length).toBeGreaterThan(0);
        expect(walked.inventory.map((entry) => entry.name)).toEqual(['writer']);
      }),
    ),
  );

  it.effect(
    "an enabled plugin's skills and commands join the catalog by name, a project skill of the same name wins, and disabling withdraws them",
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const pluginRoot = yield* tempRootEffect(demo.fixture, 'plugin-skills-');
          const skillFolder = Effect.fnUntraced(function* (directory: string, description: string, body = 'Body.') {
            yield* files.makeDirectory(directory, { recursive: true });
            yield* files.writeFileString(join(directory, 'SKILL.md'), `---\ndescription: ${description}\n---\n${body}\n`);
            return directory;
          });
          const review = yield* skillFolder(join(pluginRoot, 'skills/review'), 'Reviews.', 'Run ${PLUGIN_ROOT}/check.');
          const clash = yield* skillFolder(join(pluginRoot, 'skills/clash'), 'Plugin clash.');
          const leaky = yield* skillFolder(join(pluginRoot, 'skills/leaky'), 'Leaks.');
          const secret = join(demo.demoRoot, 'secret.md');
          yield* files.writeFileString(secret, 'Secret.\n');
          yield* files.makeDirectory(join(leaky, 'references'));
          yield* files.symlink(secret, join(leaky, 'references/secret.md'));
          yield* skillFolder(join(demo.demoRoot, '.agents/skills/demo-clash'), 'Project clash.');
          const render = (text: string) => text.replaceAll('${PLUGIN_ROOT}', '/plugin');
          const loaded: PluginLoaded = {
            id: 'demo',
            revision: 'first',
            title: 'Demo',
            place: { root: pluginRoot, data: pluginRoot, options: {}, project: demo.demoRoot },
            process: null,
            providers: null,
            contributes: {},
            redact: [],
            skills: [
              { name: 'demo-review', directory: review, file: join(review, 'SKILL.md'), root: pluginRoot, render },
              { name: 'demo-clash', directory: clash, file: join(clash, 'SKILL.md'), root: pluginRoot, render },
              { name: 'demo-leaky', directory: leaky, file: join(leaky, 'SKILL.md'), root: pluginRoot, render },
            ],
            commands: [{ name: 'demo-fix', description: 'Fixes.', body: Effect.succeed('Fix $ARGUMENTS.') }],
            agents: [],
            servers: [],
            hooks: [],
          };
          const plugins = yield* enabledPlugins([loaded]);
          const cache = yield* setup(demo, plugins.service);
          const here = { threadId: 'one', projectId: demo.projectId, root: demo.demoRoot };
          const walked = yield* cache.preview(here);
          expect(walked.skills.map((skill) => [skill.id, skill.description])).toEqual([
            ['demo-review', 'Reviews.'],
            ['demo-fix', 'Fixes.'],
            ['demo-clash', 'Project clash.'],
          ]);
          expect(walked.inventory.map((entry) => [entry.name, entry.scope, entry.plugin, entry.enabled, entry.replacedBy])).toEqual([
            ['demo-review', 'plugin', 'demo', true, null],
            ['demo-clash', 'plugin', 'demo', false, 'project'],
            ['demo-fix', 'plugin', 'demo', true, null],
            ['demo-clash', 'project', null, true, null],
          ]);
          expect(walked.rejected.map((entry) => entry.path.endsWith('skills/leaky/references/secret.md'))).toEqual([true]);
          const skillBody = walked.skills.find((skill) => skill.id === 'demo-review')!.instructions({});
          expect(typeof skillBody === 'string' ? skillBody : yield* skillBody).toBe('Run /plugin/check.');
          const command = walked.skills.find((skill) => skill.id === 'demo-fix')!;
          expect(command.arguments).toBe(true);
          const body = command.instructions({});
          expect(typeof body === 'string' ? body : yield* body).toBe('Fix $ARGUMENTS.');
          const rebound: PluginLoaded = {
            ...loaded,
            revision: 'rebound',
            place: { ...loaded.place, options: { target: 'staging' } },
            commands: [{ name: 'demo-fix', description: 'Fixes.', body: Effect.succeed('Fix $ARGUMENTS on staging.') }],
          };
          yield* plugins.set(demo.projectId, [rebound]);
          const again = (yield* cache.preview(here)).skills.find((skill) => skill.id === 'demo-fix')!.instructions({});
          expect(typeof again === 'string' ? again : yield* again).toBe('Fix $ARGUMENTS on staging.');
          yield* plugins.set(demo.projectId, []);
          expect((yield* cache.preview(here)).skills.map((skill) => skill.id)).toEqual(['demo-clash']);
        }),
      ),
  );

  it.effect(
    'a group member reads the other members’ project skills, a member’s re-read reaches it, and withholding them or leaving withdraws them',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const cache = yield* setup(demo);
          const siblingRoot = yield* tempRootEffect(demo.fixture, 'skill-group-sibling-');
          const sibling = yield* demo.graph.projectLifecycle.create({ name: 'sibling', rootPath: siblingRoot });
          const skill = Effect.fnUntraced(function* (root: string, name: string, description: string) {
            const directory = join(root, '.agents/skills', name);
            yield* files.makeDirectory(directory, { recursive: true });
            yield* files.writeFileString(join(directory, 'SKILL.md'), `---\ndescription: ${description}\n---\nBody.\n`);
          });
          yield* skill(demo.demoRoot, 'tests', 'Our tests.');
          yield* skill(siblingRoot, 'tests', 'Their tests.');
          yield* skill(siblingRoot, 'release', 'Their release.');
          const groups = Context.get(demo.context, ProjectGroups);
          const members = [yield* demo.graph.projects.byId(demo.projectId), sibling];
          yield* demo.graph.units.write('testing.formGroup', (unit) => groups.form(unit, { name: `group-${randomUUID()}`, members }));
          const here = { threadId: 'member', projectId: demo.projectId, root: demo.demoRoot };
          const read = Effect.map(cache.preview(here), (sources) => ({
            home: sources.skills.map((one) => one.description),
            members: sources.members.map((one) => [one.project, one.skills.map((found) => [found.id, found.description, found.place])]),
          }));
          expect(yield* read).toEqual({
            home: ['Our tests.'],
            members: [
              [
                'sibling',
                [
                  ['release', 'Their release.', 'sibling'],
                  ['tests', 'Their tests.', 'sibling'],
                ],
              ],
            ],
          });
          yield* skill(siblingRoot, 'deploy', 'Their deploy.');
          expect((yield* read).members[0]?.[1]).toHaveLength(2);
          yield* cache.invalidate({ projectId: sibling.id });
          expect((yield* read).members[0]?.[1]).toHaveLength(3);
          yield* demo.graph.units.write('testing.shareGroup', (unit) => groups.share(unit, sibling, { gives: ['map', 'law'] }));
          expect((yield* read).members).toEqual([]);
          yield* demo.graph.units.write('testing.leaveGroup', (unit) => groups.leave(unit, sibling));
          expect(yield* read).toEqual({ home: ['Our tests.'], members: [] });
        }),
      ),
  );

  it.effect('threads standing in one tree share one walk, and an invalidation of any shape drops it', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const cache = yield* setup(demo);
        const files = yield* FileSystem.FileSystem;
        const directory = join(demo.demoRoot, '.agents/skills/shared');
        yield* files.makeDirectory(directory, { recursive: true });
        yield* files.writeFileString(join(directory, 'SKILL.md'), '---\nname: shared\ndescription: Shared.\n---\nShared instructions.\n');
        const here = (threadId: string) => ({ threadId, projectId: demo.projectId, root: demo.demoRoot });
        const walked = yield* cache.preview(here('one'));
        expect(walked.skills.map((skill) => skill.description)).toEqual(['Shared.']);
        expect(yield* cache.preview(here('two'))).toBe(walked);
        expect(yield* cache.preview(here('one'))).toBe(walked);
        yield* cache.invalidate({ threadId: 'two' });
        expect(yield* cache.preview(here('one'))).not.toBe(walked);
      }),
    ),
  );

  it.effect('sources follow the recorded generation, and a generation released late leaves a newer one bound', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const cache = yield* setup(demo);
        const files = yield* FileSystem.FileSystem;
        const worktree = yield* tempRootEffect(demo.fixture, 'skill-snapshot-worktree-');
        const here = join(demo.demoRoot, '.agents/skills/checkout');
        yield* files.makeDirectory(here, { recursive: true });
        yield* files.writeFileString(join(here, 'SKILL.md'), '---\nname: checkout\ndescription: The checkout.\n---\nHere.\n');
        const there = join(worktree, '.agents/skills/worktree');
        yield* files.makeDirectory(there, { recursive: true });
        yield* files.writeFileString(join(there, 'SKILL.md'), '---\nname: worktree\ndescription: The worktree.\n---\nThere.\n');
        const zero = yield* cache.resolve(
          { threadId: 'mover', projectId: demo.projectId, root: demo.demoRoot },
          { kind: 'run', runId: 'run-1', context: null },
          at('mover', 'run-1', 0),
        );
        const one = yield* cache.resolve(
          { threadId: 'mover', projectId: demo.projectId, root: worktree },
          { kind: 'run', runId: 'run-1', context: null },
          at('mover', 'run-1', 1),
        );
        expect(zero.skills.map((skill) => skill.description)).toEqual(['The checkout.']);
        expect(one.skills.map((skill) => skill.description)).toEqual(['The worktree.']);
        expect(yield* cache.snapshot('mover', 'run-1')).toBe(one);
        yield* demo.graph.settings.write({ scope: 'project', projectId: demo.projectId, key: rescanPolicy.id, value: 'per-turn' });
        const staying = { threadId: 'stayer', projectId: demo.projectId, root: demo.demoRoot };
        const first = at('stayer', 'run-1', 0);
        const second = at('stayer', 'run-1', 1);
        const bound = yield* cache.resolve(staying, { kind: 'run', runId: 'run-1', context: null }, first);
        const next = yield* cache.resolve(staying, { kind: 'run', runId: 'run-1', context: null }, second);
        expect(next).not.toBe(bound);
        yield* cache.release(first);
        expect(yield* cache.resolve(staying, { kind: 'run', runId: 'run-1', context: null }, second)).toBe(next);
        expect(yield* cache.resolve(staying, { kind: 'run', runId: 'run-1', context: null }, first)).not.toBe(bound);
      }),
    ),
  );
});
