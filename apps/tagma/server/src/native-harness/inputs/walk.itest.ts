import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import type { AgentSkill } from '@runlith/agent/AgentSkill';
import { Effect, FileSystem, Layer } from 'effect';
import { demoGraphLayer, withDemo, tempRootEffect, type EffectDemo } from '../../composition/testing/graphFixture.js';
import { LAW_END, LAW_START } from '../../graph/contract/wire/law.js';
import { contextFileNames, contextFilesEnabled, skillGlobalDirectories, skillProjectDirectories } from '../contract/wire/sourceSettings.js';
import { Settings } from '../../settings/contract/service/values.js';
import { type CapabilityDeclaration, capability, TAGMA_VIEW } from '../../views/contract/wire/capabilities.js';
import { readWorkspaceInputs } from './walk.js';

const setup = Effect.fnUntraced(function* (demo: EffectDemo) {
  const place = demo.project('p');
  yield* demo.graph.settings.write({ scope: 'project', projectId: place.id, key: skillGlobalDirectories.id, value: [] });
  return { root: place.root, projectId: place.id };
});

layer(demoGraphLayer({ projects: ['p'] }).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'workspace sources',
  (it) => {
    it.effect('an unconfigured project reads AGENTS.md and finds the skills beside it', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { root, projectId } = yield* setup(demo);
          const files = yield* FileSystem.FileSystem;
          yield* files.writeFileString(join(root, 'AGENTS.md'), 'the project law');
          yield* files.writeFileString(join(root, 'CLAUDE.md'), 'another harness');
          yield* files.makeDirectory(join(root, '.agents/skills/reviewer'), { recursive: true });
          yield* files.writeFileString(
            join(root, '.agents/skills/reviewer/SKILL.md'),
            '---\ndescription: Reviews a change.\n---\n\nRead the diff first.\n',
          );
          const sources = yield* readWorkspaceInputs({
            projectId,
            projectRoot: root,
            own: [join(root, '.agents/skills/tagma')],
            plugins: [],
            capabilities: [],
          });
          expect(sources.contextFiles.map((file) => file.name)).toEqual(['AGENTS.md']);
          expect(sources.contextFiles[0]?.body).toBe('the project law');
          expect(sources.skills.map((skill) => skill.id)).toEqual(['reviewer']);
        }),
      ),
    );

    it.effect("Tagma's own managed law section is cut out of what it reads back", () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { root, projectId } = yield* setup(demo);
          yield* (yield* FileSystem.FileSystem).writeFileString(
            join(root, 'AGENTS.md'),
            `keep this\n${LAW_START}\ngenerated law\n${LAW_END}\nand this`,
          );
          const sources = yield* readWorkspaceInputs({
            projectId,
            projectRoot: root,
            own: [join(root, '.agents/skills/tagma')],
            plugins: [],
            capabilities: [],
          });
          expect(sources.contextFiles[0]?.body).toContain('keep this');
          expect(sources.contextFiles[0]?.body).toContain('and this');
          expect(sources.contextFiles[0]?.body).not.toContain('generated law');
        }),
      ),
    );

    it.effect('a project orders the name list, and the file it names first wins', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { root, projectId } = yield* setup(demo);
          const files = yield* FileSystem.FileSystem;
          yield* files.writeFileString(join(root, 'AGENTS.md'), 'generic');
          yield* files.writeFileString(join(root, 'TAGMA.md'), 'addressed to tagma');
          yield* (yield* Settings).write({ scope: 'project', projectId, key: contextFileNames.id, value: ['AGENTS.md', 'TAGMA.md'] });
          const sources = yield* readWorkspaceInputs({
            projectId,
            projectRoot: root,
            own: [join(root, '.agents/skills/tagma')],
            plugins: [],
            capabilities: [],
          });
          expect(sources.contextFiles[0]?.body).toBe('generic');
        }),
      ),
    );

    it.effect('a project switches reading off, and nothing is read', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { root, projectId } = yield* setup(demo);
          yield* (yield* FileSystem.FileSystem).writeFileString(join(root, 'AGENTS.md'), 'the project law');
          yield* (yield* Settings).write({ scope: 'project', projectId, key: contextFilesEnabled.id, value: false });
          const sources = yield* readWorkspaceInputs({
            projectId,
            projectRoot: root,
            own: [join(root, '.agents/skills/tagma')],
            plugins: [],
            capabilities: [],
          });
          expect(sources.contextFiles).toEqual([]);
        }),
      ),
    );

    it.effect('a project adds a skill directory of its own beside the defaults', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { root, projectId } = yield* setup(demo);
          const files = yield* FileSystem.FileSystem;
          yield* files.makeDirectory(join(root, 'ops/skills/deployer'), { recursive: true });
          yield* files.writeFileString(join(root, 'ops/skills/deployer/SKILL.md'), '---\ndescription: Ships.\n---\n\nRun it.\n');
          yield* (yield* Settings).write({ scope: 'project', projectId, key: skillProjectDirectories.id, value: ['ops/skills'] });
          const sources = yield* readWorkspaceInputs({
            projectId,
            projectRoot: root,
            own: [join(root, '.agents/skills/tagma')],
            plugins: [],
            capabilities: [],
          });
          expect(sources.skills.map((skill) => skill.id)).toEqual(['deployer']);
        }),
      ),
    );

    it.effect("Tagma's own installed skill is off by default, by installation identity, not by name", () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { root, projectId } = yield* setup(demo);
          const files = yield* FileSystem.FileSystem;
          yield* files.makeDirectory(join(root, '.agents/skills/tagma'), { recursive: true });
          yield* files.writeFileString(
            join(root, '.agents/skills/tagma/SKILL.md'),
            '---\ndescription: The CLI contract.\n---\n\ntagma prime.\n',
          );
          yield* files.makeDirectory(join(root, 'ops/skills/tagma'), { recursive: true });
          yield* files.writeFileString(join(root, 'ops/skills/tagma/SKILL.md'), '---\ndescription: Unrelated.\n---\n\nNot ours.\n');
          const settings = yield* Settings;
          const sources = yield* readWorkspaceInputs({
            projectId,
            projectRoot: root,
            own: [join(root, '.agents/skills/tagma')],
            plugins: [],
            capabilities: [],
          });
          expect(sources.skills.map((skill) => skill.id)).toEqual([]);
          expect(sources.inventory.map((entry) => [entry.name, entry.own, entry.enabled])).toEqual([['tagma', true, false]]);
          yield* settings.write({ scope: 'project', projectId, key: skillProjectDirectories.id, value: ['ops/skills'] });
          const reordered = yield* readWorkspaceInputs({
            projectId,
            projectRoot: root,
            own: [join(root, '.agents/skills/tagma')],
            plugins: [],
            capabilities: [],
          });
          expect(reordered.inventory.find((entry) => entry.name === 'tagma' && entry.directory?.includes('ops') === true)).toMatchObject({
            own: false,
            enabled: true,
          });
          yield* settings.write({ scope: 'project', projectId, key: skillProjectDirectories.id, value: ['.agents/skills'] });
          yield* settings.write({ scope: 'project', projectId, key: 'skills.own.enabled', value: true });
          const offered = yield* readWorkspaceInputs({
            projectId,
            projectRoot: root,
            own: [join(root, '.agents/skills/tagma')],
            plugins: [],
            capabilities: [],
          });
          expect(offered.skills.map((skill) => skill.id)).toEqual(['tagma']);
        }),
      ),
    );

    it.effect('project and global skills switch off independently', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { root, projectId } = yield* setup(demo);
          const files = yield* FileSystem.FileSystem;
          yield* files.makeDirectory(join(root, '.agents/skills/reviewer'), { recursive: true });
          yield* files.writeFileString(join(root, '.agents/skills/reviewer/SKILL.md'), '---\ndescription: Reviews.\n---\n\nBody.\n');
          const globalRoot = yield* tempRootEffect(demo.fixture, 'tagma-sources-global-');
          yield* files.makeDirectory(join(globalRoot, 'greeter'), { recursive: true });
          yield* files.writeFileString(join(globalRoot, 'greeter/SKILL.md'), '---\ndescription: Greets.\n---\n\nBody.\n');
          const settings = yield* Settings;
          yield* settings.write({ scope: 'project', projectId, key: skillGlobalDirectories.id, value: [globalRoot] });
          yield* settings.write({ scope: 'project', projectId, key: 'skills.project.enabled', value: false });
          const sources = yield* readWorkspaceInputs({
            projectId,
            projectRoot: root,
            own: [join(root, '.agents/skills/tagma')],
            plugins: [],
            capabilities: [],
          });
          expect(sources.inventory.map((entry) => [entry.name, entry.scope])).toEqual([['greeter', 'global']]);
        }),
      ),
    );

    it.effect('the shipped plugins skill lists the view members it is given and offers their references', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { root, projectId } = yield* setup(demo);
          const echo = capability({
            id: 'echo',
            signature: '(said)',
            description: 'Says it back.',
            reference: { title: 'Echo in a view', text: 'Echo details.' },
          });
          const read = (capabilities: readonly CapabilityDeclaration[]) =>
            readWorkspaceInputs({ projectId, projectRoot: root, own: [], plugins: [], capabilities });
          const textOf = (skill: AgentSkill<unknown>) => {
            const read = skill.instructions(undefined);
            return typeof read === 'string' ? Effect.succeed(read) : read;
          };
          const plugins = (yield* read([...TAGMA_VIEW, echo])).shipped.find((skill) => skill.id === 'plugins')!;
          const text = yield* textOf(plugins);
          expect(text).toContain('- `storage.get(key) · .set(key, value?)`');
          expect(text).toContain('- `echo(said)` — Says it back.');
          expect(text).not.toContain('<!-- view-capabilities -->');
          expect(plugins.references?.map(({ name }) => name)).toEqual(expect.arrayContaining(['example', 'echo']));
          expect(yield* plugins.reference!('echo')).toContain('Echo details.');
          const bare = (yield* read(TAGMA_VIEW)).shipped.find((skill) => skill.id === 'plugins')!;
          expect(yield* textOf(bare)).not.toContain('echo(said)');
        }),
      ),
    );
  },
);
