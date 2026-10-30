import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Effect, FileSystem, Layer } from 'effect';
import { join } from 'node:path';
import type { HarnessProvider } from '@runlith/tagma/adapter/provider';
import { makeHarnessAdapters } from '../../../external-harnesses/adapters.js';
import { HarnessAdapters } from '../../../external-harnesses/contract/service/adapters.js';
import { SHIPPED_PROVIDERS } from '../../../external-harnesses/testing/builtin.js';
import { installInto, installForUser, installForAccount } from '../../../external-harnesses/installs/skillInstall.js';
import { skillStatus } from '../../../external-harnesses/testing/doubles.js';
import { skillDirectories, userSkillTarget } from '../../../external-harnesses/installs/targets.js';
import { standing } from '../../../external-harnesses/installs/upgrade.js';
import { doctrine } from '../../doctrine.js';

const base = SHIPPED_PROVIDERS[0]!;
const provider: HarnessProvider = {
  ...base,
  id: 'quill-instructions',
  terminal: {
    ...base.terminal!,
    hooks: null,
    mcp: null,
    instructions: {
      file: 'QUILL.txt',
      imports: (text) => text.includes('include AGENTS.md'),
    },
    skill: {
      project: '.quill/commands/tagma',
      user: { folder: ['.quill', 'commands'], file: 'tagma' },
    },
  },
};

it.live('installation follows a package instruction file, import rule and skill aliases, and withdrawal leaves only canonical files', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const root = yield* files.makeTempDirectoryScoped({ prefix: 'instructions-' });
    const adapters = yield* HarnessAdapters;
    yield* adapters.declared([provider]);
    const { contributed } = yield* doctrine;
    const instruction = join(root, 'QUILL.txt');
    const imported = 'include AGENTS.md\nkept by the operator\n';
    yield* files.writeFileString(instruction, imported);
    const first = yield* installInto(root, 'first-law', async () => [], contributed);
    expect(first.instructions).toEqual([{ path: instruction, write: 'skipped-import' }]);
    expect(yield* files.readFileString(instruction)).toBe(imported);
    expect(yield* files.realPath(first.links[0]!)).toBe(yield* files.realPath(first.skill.target));

    yield* files.writeFileString(instruction, 'operator instructions\n');
    const second = yield* installInto(root, 'second-law', async () => [], contributed);
    expect(second.instructions).toEqual([{ path: instruction, write: 'appended' }]);
    expect(yield* files.readFileString(instruction)).toContain('second-law');
    yield* files.remove(instruction);
    expect((yield* installInto(root, 'third-law', async () => [], contributed)).instructions).toEqual([
      { path: instruction, write: 'absent' },
    ]);
    expect(yield* files.exists(instruction)).toBe(false);

    const legacy = join(process.env.HOME!, '.quill', 'commands', 'tagma');
    yield* files.makeDirectory(legacy, { recursive: true });
    expect(yield* standing(true, root)).toEqual({ _tag: 'User' });
    const user = yield* installForUser(contributed);
    expect(user.skill.target).toBe(userSkillTarget());
    expect(yield* files.realPath(legacy)).toBe(yield* files.realPath(user.skill.target));
    const directories = yield* skillDirectories;
    expect(directories(root)).toContain(legacy);

    yield* adapters.declared([]);
    const withdrawn = yield* installInto(root, 'canonical-law', async () => [], contributed);
    expect(withdrawn.links).toEqual([]);
    expect(withdrawn.instructions).toEqual([]);
    expect(yield* files.readFileString(withdrawn.agents.path)).toContain('canonical-law');
  }).pipe(Effect.provide(Layer.mergeAll(BunFileSystem.layer, Layer.effect(HarnessAdapters, makeHarnessAdapters)))),
);

it.live('home and account refreshes retain canonical skill aliases and use the declared user path', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const root = yield* files.makeTempDirectoryScoped({ prefix: 'account-skills-' });
    const adapters = yield* HarnessAdapters;
    const { contributed } = yield* doctrine;
    for (const file of ['skills/tagma', 'commands/tagma']) {
      const configured: HarnessProvider = {
        ...provider,
        terminal: {
          ...provider.terminal!,
          hooks: { ...base.terminal!.hooks!, file: '.quill-home/hooks.json', user: { folder: ['.quill-home'], file: 'hooks.json' } },
          skill: { project: '.quill/tagma', user: { folder: ['.quill-home'], file } },
        },
      };
      yield* adapters.declared([configured]);
      const user = yield* installForUser(contributed);
      const alias = join(process.env.HOME!, '.quill-home', file);
      yield* files.writeFileString(join(user.skill.target, 'SKILL.md'), 'an earlier release');
      yield* installForAccount(provider.id, null, contributed, ['tagma']);
      expect((yield* skillStatus(user.skill.target, contributed)).state).toBe('current');
      expect(yield* files.realPath(alias)).toBe(yield* files.realPath(user.skill.target));
      const account = join(root, file.split('/')[0]!);
      yield* installForAccount(provider.id, account, contributed, ['tagma']);
      expect((yield* skillStatus(join(account, file), contributed)).state).toBe('current');
    }
  }).pipe(Effect.provide(Layer.mergeAll(BunFileSystem.layer, Layer.effect(HarnessAdapters, makeHarnessAdapters)))),
);
