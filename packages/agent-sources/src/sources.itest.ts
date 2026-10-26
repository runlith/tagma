import { afterAll, describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect } from 'effect';
import { readContextFiles } from './ContextFiles';
import type { AgentSkill } from '@runlith/agent/AgentSkill';
import { asAgentSkills, discoverSkills } from './SkillDirectories';

const roots: string[] = [];
function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-sources-'));
  roots.push(root);
  return root;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function skill(root: string, name: string, frontmatter: string, body: string): void {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, 'SKILL.md'), `---\n${frontmatter}\n---\n\n${body}\n`);
}

const bodyOf = (found: AgentSkill<unknown>) => {
  const read = found.instructions({});
  return typeof read === 'string' ? Effect.succeed(read) : read;
};

layer(BunFileSystem.layer, { excludeTestServices: true })('agent workspace sources', (it) => {
  describe('reading workspace instruction files', () => {
    it.effect('reads the first name that exists in a directory and looks at no other', () =>
      Effect.gen(function* () {
        const root = workspace();
        writeFileSync(join(root, 'AGENTS.md'), 'the shared law');
        writeFileSync(join(root, 'CLAUDE.md'), 'another harness');
        const files = yield* readContextFiles({ cwd: root, root, names: ['TAGMA.md', 'AGENTS.md', 'CLAUDE.md'] });
        expect(files.map((file) => file.name)).toEqual(['AGENTS.md']);
      }),
    );

    it.effect('never reads a symlinked twin beside its original', () =>
      Effect.gen(function* () {
        const root = workspace();
        writeFileSync(join(root, 'AGENTS.md'), 'the shared law');
        symlinkSync(join(root, 'AGENTS.md'), join(root, 'CLAUDE.md'));
        const files = yield* readContextFiles({ cwd: root, root, names: ['AGENTS.md', 'CLAUDE.md'] });
        expect(files).toHaveLength(1);
      }),
    );

    it.effect('prefers the name the caller put first, so a file addressed to this agent wins its directory', () =>
      Effect.gen(function* () {
        const root = workspace();
        writeFileSync(join(root, 'AGENTS.md'), 'generic');
        writeFileSync(join(root, 'TAGMA.md'), 'addressed');
        const files = yield* readContextFiles({ cwd: root, root, names: ['TAGMA.md', 'AGENTS.md'] });
        expect(files.map((file) => file.body)).toEqual(['addressed']);
      }),
    );

    it.effect('walks the chain root-outward, the nearest directory last', () =>
      Effect.gen(function* () {
        const root = workspace();
        const nested = join(root, 'packages', 'inner');
        mkdirSync(nested, { recursive: true });
        writeFileSync(join(root, 'AGENTS.md'), 'root law');
        writeFileSync(join(nested, 'AGENTS.md'), 'inner law');
        const files = yield* readContextFiles({ cwd: nested, root, names: ['AGENTS.md'] });
        expect(files.map((file) => file.body)).toEqual(['root law', 'inner law']);
      }),
    );

    it.effect('applies the caller strip, so a section the caller wrote itself is not read back', () =>
      Effect.gen(function* () {
        const root = workspace();
        writeFileSync(join(root, 'AGENTS.md'), 'keep this\n<!-- mine:start -->generated<!-- mine:end -->\n');
        const files = yield* readContextFiles({
          cwd: root,
          root,
          names: ['AGENTS.md'],
          strip: (body) => body.replace(/<!-- mine:start -->[\s\S]*?<!-- mine:end -->/g, ''),
        });
        expect(files[0]?.body).toBe('keep this');
      }),
    );

    it.effect('answers nothing when no name exists', () =>
      Effect.gen(function* () {
        const root = workspace();
        expect(yield* readContextFiles({ cwd: root, root, names: ['AGENTS.md'] })).toEqual([]);
      }),
    );
  });

  describe('discovering skills in the directories it is handed', () => {
    it.effect('reads a SKILL.md directory into name, description and body', () =>
      Effect.gen(function* () {
        const root = workspace();
        skill(root, 'reviewer', 'name: reviewer\ndescription: Reviews a change.', 'Read the diff, then answer.');
        const found = yield* discoverSkills({ directories: [root] });
        expect(found.skills).toHaveLength(1);
        expect(found.skills[0]).toMatchObject({ name: 'reviewer', description: 'Reviews a change.', body: 'Read the diff, then answer.' });
      }),
    );

    it.effect('lets a later directory win a name collision, because order is precedence', () =>
      Effect.gen(function* () {
        const global = workspace();
        const project = workspace();
        skill(global, 'writer', 'description: global writer', 'global body');
        skill(project, 'writer', 'description: project writer', 'project body');
        const found = yield* discoverSkills({ directories: [global, project] });
        expect(found.skills).toHaveLength(1);
        expect(found.skills[0]?.body).toBe('project body');
      }),
    );

    it.effect('discovers skill directories among files and directories with other content', () =>
      Effect.gen(function* () {
        const root = workspace();
        skill(root, 'reviewer', 'description: Reviews a change.', 'Read the diff.');
        writeFileSync(join(root, '.DS_Store'), 'directory metadata');
        writeFileSync(join(root, 'notes.txt'), 'notes');
        writeFileSync(join(root, 'SKILL.md'), '---\ndescription: Root document.\n---\nRoot body.\n');
        mkdirSync(join(root, 'assets'));
        symlinkSync(join(root, 'notes.txt'), join(root, 'notes-link'));
        const found = yield* discoverSkills({ directories: [root] });
        expect(found.skills).toEqual([
          {
            name: 'reviewer',
            description: 'Reviews a change.',
            body: 'Read the diff.',
            path: join(root, 'reviewer', 'SKILL.md'),
            directory: root,
            location: realpathSync(join(root, 'reviewer')),
            references: [],
          },
        ]);
        expect(found.rejected).toEqual([]);
      }),
    );

    it.effect('lists the markdown files of a skill references folder by name, each described by its first line', () =>
      Effect.gen(function* () {
        const root = workspace();
        skill(root, 'rules', 'description: Rules.', 'Read the rules.');
        mkdirSync(join(root, 'rules', 'references'));
        writeFileSync(join(root, 'rules', 'references', 'format.md'), '# Formatter on commit\n\nRun it.\n');
        writeFileSync(join(root, 'rules', 'references', 'plain.md'), '\nNo heading.\n');
        writeFileSync(join(root, 'rules', 'references', 'data.json'), '{}');
        const found = yield* discoverSkills({ directories: [root] });
        const location = realpathSync(join(root, 'rules'));
        expect(found.skills[0]?.references).toEqual([
          { name: 'format', description: 'Formatter on commit', path: join(location, 'references', 'format.md') },
          { name: 'plain', description: undefined, path: join(location, 'references', 'plain.md') },
        ]);
      }),
    );

    it.effect(
      'follows skill directory links to the real folder their relative paths resolve in, and skips links whose target is missing',
      () =>
        Effect.gen(function* () {
          const root = workspace();
          const shared = workspace();
          skill(shared, 'writer', 'description: Writes a change.', 'Write the change.');
          symlinkSync(join(shared, 'writer'), join(root, 'linked-writer'));
          symlinkSync(join(shared, 'absent'), join(root, 'missing'));
          const found = yield* discoverSkills({ directories: [root] });
          expect(found.skills).toEqual([
            {
              name: 'linked-writer',
              description: 'Writes a change.',
              body: 'Write the change.',
              path: join(root, 'linked-writer', 'SKILL.md'),
              directory: root,
              location: realpathSync(join(shared, 'writer')),
              references: [],
            },
          ]);
          expect(found.rejected).toEqual([]);
        }),
    );

    it.effect('reports unreadable skill sources beside readable skills', () =>
      Effect.gen(function* () {
        const root = workspace();
        skill(root, 'reviewer', 'description: Reviews a change.', 'Read the diff.');
        mkdirSync(join(root, 'broken'));
        const file = join(root, 'broken', 'SKILL.md');
        symlinkSync(file, file);
        const found = yield* discoverSkills({ directories: [root] });
        expect(found.skills.map((entry) => entry.name)).toEqual(['reviewer']);
        expect(found.rejected).toEqual([{ path: file, reason: 'unreadable' }]);
      }),
    );

    it.effect('reads a description written as a block scalar, folded to the one line the catalog prints', () =>
      Effect.gen(function* () {
        const root = workspace();
        skill(
          root,
          'runes',
          'name: runes\ndescription: |\n  Svelte 5 runes guide. Use when:\n  - writing .svelte files\n  - using $state\nwhenToUse: >-\n  a component\n  is touched',
          'Write runes.',
        );
        const found = yield* discoverSkills({ directories: [root] });
        expect(found.skills[0]?.description).toBe('Svelte 5 runes guide. Use when: - writing .svelte files - using $state');
        expect(found.skills[0]?.whenToUse).toBe('a component is touched');
      }),
    );

    it.effect('names what it refused instead of dropping it in silence', () =>
      Effect.gen(function* () {
        const root = workspace();
        skill(root, 'headless', 'title: no description here', 'body');
        const found = yield* discoverSkills({ directories: [root] });
        expect(found.skills).toEqual([]);
        expect(found.rejected[0]?.reason).toBe('no description');
      }),
    );

    it.effect('ignores a directory that does not exist', () =>
      Effect.gen(function* () {
        const found = yield* discoverSkills({ directories: [join(workspace(), 'absent')] });
        expect(found.skills).toEqual([]);
      }),
    );

    it.effect('carries whenToUse into the description the model reads, and grants no tools', () =>
      Effect.gen(function* () {
        const root = workspace();
        skill(
          root,
          'deployer',
          'description: Ships a release.\nwhenToUse: after a green build\nallowedTools: bash,write',
          'Run the pipeline.',
        );
        const found = yield* discoverSkills({ directories: [root] });
        const skills = asAgentSkills(found.skills);
        expect(skills[0]?.description).toBe('Ships a release. Use when: after a green build');
        expect(skills[0]?.tools).toBeUndefined();
        expect(yield* bodyOf(skills[0]!)).toBe('Run the pipeline.');
      }),
    );

    it.effect('loads the body the file holds now, so an edit after the walk is what a load answers', () =>
      Effect.gen(function* () {
        const root = workspace();
        skill(root, 'writer', 'description: Writes a change.', 'First revision.');
        const [writer] = asAgentSkills((yield* discoverSkills({ directories: [root] })).skills);
        skill(root, 'writer', 'description: Writes a change.', 'Second revision.');
        expect(yield* bodyOf(writer!)).toBe('Second revision.');
        skill(root, 'writer', 'description: Writes a change.', '');
        expect(yield* Effect.flip(bodyOf(writer!))).toMatchObject({ _tag: 'AgentSkillUnreadable' });
      }),
    );
  });
});
