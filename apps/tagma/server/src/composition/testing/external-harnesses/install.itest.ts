import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Effect, FileSystem, Layer } from 'effect';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { LAW_START } from '../../../graph/contract/wire/law.js';
import { Doctrine, doctrineOf } from '../../../platform/contract/service/sections.js';
import { doctrine } from '../../doctrine.js';
import { shippedAdaptersLayer } from './shipped.js';
import type { UserInstall } from '../../../external-harnesses/installs/skillInstall.js';
import {
  installHooks,
  hooksStatus,
  skillStatus,
  installInto,
  installSkill,
  skillTarget,
} from '../../../external-harnesses/testing/doubles.js';

const fixture = Layer.mergeAll(BunFileSystem.layer, Layer.effect(Doctrine, doctrine), shippedAdaptersLayer);
const temporary = Effect.flatMap(FileSystem.FileSystem, (disk) => disk.makeTempDirectoryScoped({ prefix: 'tagma-install-' }));
const claudeOf = <A extends { readonly path: string }>(rows: readonly A[]): A | undefined =>
  rows.find((row) => row.path.endsWith(join('.claude', 'settings.json')));

layer(fixture, { excludeTestServices: true })('installation', (it) => {
  it.effect('installHooks writes each distinct project file in its own format, and a second run changes nothing', () =>
    Effect.gen(function* () {
      const repo = yield* temporary;
      const first = yield* installHooks(repo);
      expect(first.map((row) => row.path).sort()).toEqual(
        [
          '.claude/settings.json',
          '.codex/hooks.json',
          '.devin/hooks.v1.json',
          '.cursor/hooks.json',
          '.gemini/settings.json',
          '.grok/hooks/tagma.json',
          '.opencode/tagma-hooks.json',
          '.opencode/plugins/tagma/index.ts',
          '.opencode/plugins/tagma/package.json',
        ]
          .map((file) => join(repo, file))
          .sort(),
      );
      expect(first.map((row) => row.write)).toEqual([
        'created',
        'created',
        'created',
        'created',
        'created',
        'created',
        'created',
        'created',
        'created',
      ]);

      const claude = JSON.parse(readFileSync(join(repo, '.claude', 'settings.json'), 'utf8'));
      expect(Object.keys(claude.hooks)).toEqual([
        'SessionStart',
        'PreToolUse',
        'PostToolUse',
        'Stop',
        'PermissionRequest',
        'UserPromptSubmit',
        'SessionEnd',
        'PostToolUseFailure',
        'StopFailure',
        'Notification',
      ]);
      expect(JSON.stringify(claude.hooks.SessionStart)).toContain('$t\\" hook session-start');
      expect(claude.hooks.SessionStart).toHaveLength(1);
      expect(JSON.stringify(claude.hooks.PreToolUse)).toContain('$t\\" hook pre-tool-use');
      expect(JSON.stringify(claude.hooks.Stop)).toContain('$t\\" hook stop');
      expect(JSON.stringify(claude.hooks.PermissionRequest)).toContain('$t\\" hook permission-request');
      expect(claude.hooks.PermissionRequest[0].hooks[0].timeout).toBe(300);

      const codex = JSON.parse(readFileSync(join(repo, '.codex', 'hooks.json'), 'utf8'));
      expect(Object.keys(codex.hooks)).toEqual([
        'SessionStart',
        'PreToolUse',
        'PostToolUse',
        'Stop',
        'PermissionRequest',
        'UserPromptSubmit',
        'SessionEnd',
      ]);

      const devin = JSON.parse(readFileSync(join(repo, '.devin', 'hooks.v1.json'), 'utf8'));
      expect(devin.hooks).toBeUndefined();
      expect(Object.keys(devin)).toEqual([
        'SessionStart',
        'PreToolUse',
        'PostToolUse',
        'Stop',
        'PermissionRequest',
        'UserPromptSubmit',
        'SessionEnd',
      ]);
      expect(JSON.stringify(devin.SessionStart)).toContain('$t\\" hook session-start');
      expect(devin.PermissionRequest[0].hooks[0].timeout).toBe(300);

      const cursor = JSON.parse(readFileSync(join(repo, '.cursor', 'hooks.json'), 'utf8'));
      expect(cursor.version).toBe(1);
      expect(Object.keys(cursor.hooks)).toEqual([
        'sessionStart',
        'preToolUse',
        'postToolUse',
        'stop',
        'afterAgentResponse',
        'beforeShellExecution',
        'beforeSubmitPrompt',
        'sessionEnd',
      ]);
      expect(JSON.stringify(cursor.hooks.stop)).toContain('$t\\" hook stop');
      expect(JSON.stringify(cursor.hooks.beforeShellExecution)).toContain('$t\\" hook permission-request');
      expect(cursor.hooks.beforeShellExecution[0].timeout).toBe(300);

      const gemini = JSON.parse(readFileSync(join(repo, '.gemini', 'settings.json'), 'utf8'));
      expect(Object.keys(gemini.hooks)).toEqual([
        'SessionStart',
        'BeforeTool',
        'AfterTool',
        'AfterAgent',
        'BeforeAgent',
        'SessionEnd',
        'Notification',
      ]);
      expect(JSON.stringify(gemini.hooks.BeforeAgent)).toContain('$t\\" hook observe');
      expect(JSON.stringify(gemini.hooks.AfterAgent)).toContain('$t\\" hook stop');

      expect((yield* installHooks(repo)).map((row) => row.write)).toEqual([
        'current',
        'current',
        'current',
        'current',
        'current',
        'current',
        'current',
        'current',
        'current',
      ]);
    }),
  );

  it.effect('each CLI hook file names its CLI, and a registration without the name is refreshed', () =>
    Effect.gen(function* () {
      const repo = yield* temporary;
      mkdirSync(join(repo, '.codex'), { recursive: true });
      writeFileSync(
        join(repo, '.codex', 'hooks.json'),
        JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'tagma hook stop' }] }] } }),
      );
      expect((yield* hooksStatus(repo)).find((row) => row.target.endsWith('hooks.json') && row.target.includes('.codex'))?.state).toBe(
        'stale',
      );
      yield* installHooks(repo);
      const commands = (file: string): string[] => {
        const doc = JSON.parse(readFileSync(join(repo, ...file.split('/')), 'utf8')) as { hooks?: Record<string, unknown> } & Record<
          string,
          unknown
        >;
        const events = (doc.hooks ?? doc) as Record<string, unknown>;
        return Object.values(events)
          .flatMap((groups) => (Array.isArray(groups) ? groups : []))
          .flatMap((group: { command?: string; hooks?: { command: string }[] }) =>
            group.command !== undefined ? [group.command] : (group.hooks ?? []).map((one) => one.command),
          );
      };
      expect(commands('.codex/hooks.json').every((command) => command.endsWith('--harness codex'))).toBe(true);
      expect(commands('.cursor/hooks.json').every((command) => command.endsWith('--harness cursor'))).toBe(true);
      expect(commands('.gemini/settings.json').every((command) => command.endsWith('--harness gemini'))).toBe(true);
      expect(commands('.devin/hooks.v1.json').every((command) => command.endsWith('--harness devin'))).toBe(true);
      expect(commands('.claude/settings.json').every((command) => command.endsWith('--harness claude-code'))).toBe(true);
      expect(commands('.grok/hooks/tagma.json').every((command) => command.endsWith('--harness grok'))).toBe(true);
      expect(commands('.opencode/tagma-hooks.json').every((command) => command.endsWith('--harness opencode'))).toBe(true);
      expect((yield* hooksStatus(repo)).map((row) => row.state)).toEqual([
        'current',
        'current',
        'current',
        'current',
        'current',
        'current',
        'current',
      ]);
    }),
  );

  it.effect('installHooks merges into existing settings and keeps foreign entries', () =>
    Effect.gen(function* () {
      const repo = yield* temporary;
      mkdirSync(join(repo, '.claude'), { recursive: true });
      writeFileSync(
        join(repo, '.claude', 'settings.json'),
        JSON.stringify({
          permissions: { allow: ['Bash'] },
          hooks: {
            SessionStart: [{ hooks: [{ type: 'command', command: 'tagma prime' }] }],
            Stop: [{ hooks: [{ type: 'command', command: 'echo bye' }] }],
            Notification: [{ hooks: [{ type: 'command', command: 'echo ping' }] }],
          },
        }),
      );
      const claudeWrite = claudeOf(yield* installHooks(repo));
      expect(claudeWrite?.write).toBe('updated');
      const written = JSON.parse(readFileSync(join(repo, '.claude', 'settings.json'), 'utf8'));
      expect(written.permissions).toEqual({ allow: ['Bash'] });
      expect(written.hooks.SessionStart).toHaveLength(1);
      expect(JSON.stringify(written.hooks.SessionStart)).not.toContain('"tagma prime"');
      expect(JSON.stringify(written.hooks.SessionStart)).toContain('$t\\" hook session-start');
      expect(written.hooks.Stop).toHaveLength(2);
      expect(written.hooks.Stop[0]).toEqual({ hooks: [{ type: 'command', command: 'echo bye' }] });
      expect(JSON.stringify(written.hooks.Stop[1])).toContain('$t\\" hook stop');
      expect(written.hooks.Notification[0]).toEqual({ hooks: [{ type: 'command', command: 'echo ping' }] });
      expect(written.hooks.Notification).toHaveLength(2);
    }),
  );

  it.effect('one of ours under the operator matcher is refreshed in place and reported', () =>
    Effect.gen(function* () {
      const repo = yield* temporary;
      mkdirSync(join(repo, '.claude'), { recursive: true });
      const foreign = { type: 'command', command: 'echo vendor-owned', timeout: 7 };
      writeFileSync(
        join(repo, '.claude', 'settings.json'),
        JSON.stringify({
          hooks: {
            PreToolUse: [{ matcher: '.*', hooks: [foreign, { type: 'command', command: 'tagma hook pre-tool-use' }] }],
          },
        }),
      );
      const claudeWrite = claudeOf(yield* installHooks(repo));
      const written = JSON.parse(readFileSync(join(repo, '.claude', 'settings.json'), 'utf8'));
      expect(written.hooks.PreToolUse).toHaveLength(1);
      expect(written.hooks.PreToolUse[0].matcher).toBe('.*');
      expect(written.hooks.PreToolUse[0].hooks[0]).toEqual(foreign);
      expect(written.hooks.PreToolUse[0].hooks[1].command).toContain('$t" hook pre-tool-use');
      expect(claudeWrite?.deferred).toHaveLength(1);
      expect(written.hooks.UserPromptSubmit).toHaveLength(1);
      expect((yield* installHooks(repo)).every((row) => row.write === 'current')).toBe(true);
    }),
  );

  it.effect('a registration whose wait changed is refreshed, not read as current', () =>
    Effect.gen(function* () {
      const repo = yield* temporary;
      yield* installHooks(repo);
      const path = join(repo, '.codex', 'hooks.json');
      const seeded = JSON.parse(readFileSync(path, 'utf8'));
      const permission = seeded.hooks.PermissionRequest[0].hooks[0];
      expect(permission.timeout).toBe(300);
      permission.timeout = 60;
      writeFileSync(path, JSON.stringify(seeded));

      const rows = yield* installHooks(repo);
      expect(rows.find((row) => row.path === path)?.write).toBe('updated');
      const written = JSON.parse(readFileSync(path, 'utf8'));
      expect(written.hooks.PermissionRequest).toHaveLength(1);
      expect(written.hooks.PermissionRequest[0].hooks).toHaveLength(1);
      expect(written.hooks.PermissionRequest[0].hooks[0].timeout).toBe(300);
    }),
  );

  it.effect('a stale registration goes only where going moves nobody, by the format own representation', () =>
    Effect.gen(function* () {
      const repo = yield* temporary;
      const theirs = { hooks: [{ type: 'command', command: 'echo audit' }] };
      const stale = () => ({ hooks: [{ type: 'command', command: 'tagma hook stop' }] });
      for (const [dir, file] of [
        ['.codex', 'hooks.json'],
        ['.claude', 'settings.json'],
      ] as const) {
        mkdirSync(join(repo, dir), { recursive: true });
        writeFileSync(join(repo, dir, file), JSON.stringify({ hooks: { Stop: [stale(), stale(), theirs] } }));
      }
      const rows = yield* installHooks(repo);

      const codex = JSON.parse(readFileSync(join(repo, '.codex', 'hooks.json'), 'utf8'));
      expect(codex.hooks.Stop).toHaveLength(3);
      expect(codex.hooks.Stop[0].hooks[0].command).toContain('$t" hook stop');
      expect(codex.hooks.Stop[1]).toEqual({ hooks: [] });
      expect(codex.hooks.Stop[2]).toEqual(theirs);

      const claude = JSON.parse(readFileSync(join(repo, '.claude', 'settings.json'), 'utf8'));
      expect(claude.hooks.Stop).toHaveLength(3);
      expect(claude.hooks.Stop[0].hooks[0].command).toContain('$t" hook stop');
      expect(claude.hooks.Stop[1]).toEqual(claude.hooks.Stop[0]);
      expect(claude.hooks.Stop[2]).toEqual(theirs);
      expect(rows.find((row) => row.path.endsWith('settings.json'))?.deferred).toHaveLength(1);
    }),
  );

  it.effect('a composed command of the operator that runs tagma is named, never rewritten', () =>
    Effect.gen(function* () {
      const repo = yield* temporary;
      mkdirSync(join(repo, '.codex'), { recursive: true });
      const composed = { type: 'command', command: 'test -f .tagma/on && tagma hook stop || true' };
      writeFileSync(join(repo, '.codex', 'hooks.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [composed] }] } }));
      const rows = yield* installHooks(repo);
      const written = JSON.parse(readFileSync(join(repo, '.codex', 'hooks.json'), 'utf8'));
      expect(written.hooks.Stop[0].hooks[0]).toEqual(composed);
      expect(written.hooks.Stop).toHaveLength(2);
      expect(JSON.stringify(written.hooks.Stop[1])).toContain('$t\\" hook stop');
      expect(rows.find((row) => row.path === join(repo, '.codex', 'hooks.json'))?.deferred).toHaveLength(1);
    }),
  );

  it.effect('refreshing a stale registration leaves every foreign command at its own index', () =>
    Effect.gen(function* () {
      const repo = yield* temporary;
      mkdirSync(join(repo, '.codex'), { recursive: true });
      const behindGroup = { hooks: [{ type: 'command', command: 'echo audit' }] };
      const behindBeside = { type: 'command', command: 'echo beside', timeout: 7 };
      writeFileSync(
        join(repo, '.codex', 'hooks.json'),
        JSON.stringify({
          hooks: {
            Stop: [{ hooks: [{ type: 'command', command: 'tagma hook stop' }] }, behindGroup],
            PreToolUse: [{ hooks: [{ type: 'command', command: 'tagma hook pre-tool-use' }, behindBeside] }],
          },
        }),
      );

      yield* installHooks(repo);
      const written = JSON.parse(readFileSync(join(repo, '.codex', 'hooks.json'), 'utf8'));

      expect(written.hooks.Stop).toHaveLength(2);
      expect(written.hooks.Stop[1]).toEqual(behindGroup);
      expect(written.hooks.Stop[0].hooks[0].command).toContain('$t" hook stop');
      expect(written.hooks.PreToolUse).toHaveLength(1);
      expect(written.hooks.PreToolUse[0].hooks).toHaveLength(2);
      expect(written.hooks.PreToolUse[0].hooks[1]).toEqual(behindBeside);
      expect(written.hooks.PreToolUse[0].hooks[0].command).toContain('$t" hook pre-tool-use');

      expect((yield* installHooks(repo)).every((row) => row.write === 'current')).toBe(true);
    }),
  );

  it.effect('a malformed entry refuses by name before any write, and the file is untouched', () =>
    Effect.gen(function* () {
      const repo = yield* temporary;
      mkdirSync(join(repo, '.codex'), { recursive: true });
      const path = join(repo, '.codex', 'hooks.json');
      const held = JSON.stringify({ hooks: { Stop: [null, { hooks: [{ type: 'command', command: 'echo mine' }] }] } });
      writeFileSync(path, held);

      expect((yield* Effect.flip(installHooks(repo))).detail).toMatch(/malformed entry at Stop\[0\]/);
      expect(readFileSync(path, 'utf8')).toBe(held);

      const status = (yield* hooksStatus(repo)).find((row) => row.target === path);
      expect(status?.state).toBe('unreadable');
      if (status?.state === 'unreadable') expect(status.reason).toContain('Stop[0]');

      writeFileSync(path, JSON.stringify({ hooks: { Stop: [{ hooks: ['echo mine'] }] } }));
      expect((yield* Effect.flip(installHooks(repo))).detail).toMatch(/malformed entry at Stop\[0\]/);
    }),
  );

  it.effect('a duplicate of a current registration stops firing, and reads stale until it does', () =>
    Effect.gen(function* () {
      const repo = yield* temporary;
      yield* installHooks(repo);
      const path = join(repo, '.codex', 'hooks.json');
      const doc = JSON.parse(readFileSync(path, 'utf8'));
      const theirs = { hooks: [{ type: 'command', command: 'echo audit' }] };
      doc.hooks.Stop = [doc.hooks.Stop[0], JSON.parse(JSON.stringify(doc.hooks.Stop[0])), theirs];
      writeFileSync(path, JSON.stringify(doc));

      const before = (yield* hooksStatus(repo)).find((row) => row.target === path);
      expect(before?.state).toBe('stale');
      if (before?.state === 'stale') expect(before.differing).toEqual(['Stop']);

      yield* installHooks(repo);
      const written = JSON.parse(readFileSync(path, 'utf8'));
      expect(written.hooks.Stop[1]).toEqual({ hooks: [] });
      expect(written.hooks.Stop[2]).toEqual(theirs);
      expect(JSON.stringify(written.hooks.Stop[0])).toContain('$t\\" hook stop');
      expect((yield* hooksStatus(repo)).find((row) => row.target === path)?.state).toBe('current');
    }),
  );

  it.effect('a hook file missing an occasion reads stale and names it', () =>
    Effect.gen(function* () {
      const repo = yield* temporary;
      expect((yield* hooksStatus(repo)).map((row) => row.state)).toEqual([
        'missing',
        'missing',
        'missing',
        'missing',
        'missing',
        'missing',
        'missing',
      ]);

      yield* installHooks(repo);
      expect((yield* hooksStatus(repo)).map((row) => row.state)).toEqual([
        'current',
        'current',
        'current',
        'current',
        'current',
        'current',
        'current',
      ]);

      const path = join(repo, '.codex', 'hooks.json');
      const doc = JSON.parse(readFileSync(path, 'utf8'));
      delete doc.hooks.UserPromptSubmit;
      writeFileSync(path, JSON.stringify(doc));

      const codex = (yield* hooksStatus(repo)).find((row) => row.target === path);
      expect(codex?.state).toBe('stale');
      if (codex?.state === 'stale') {
        expect(codex.missing).toEqual(['UserPromptSubmit']);
        expect(codex.differing).toEqual([]);
      }
      expect((yield* hooksStatus(repo)).filter((row) => row.state === 'current')).toHaveLength(6);
    }),
  );

  it.effect('a changed wait reads stale, and the install that fixes it reads current', () =>
    Effect.gen(function* () {
      const repo = yield* temporary;
      yield* installHooks(repo);
      const path = join(repo, '.codex', 'hooks.json');
      const doc = JSON.parse(readFileSync(path, 'utf8'));
      doc.hooks.PermissionRequest[0].hooks[0].timeout = 60;
      writeFileSync(path, JSON.stringify(doc));

      const stale = (yield* hooksStatus(repo)).find((row) => row.target === path);
      expect(stale?.state).toBe('stale');
      if (stale?.state === 'stale') {
        expect(stale.differing).toEqual(['PermissionRequest']);
        expect(stale.missing).toEqual([]);
      }

      yield* installHooks(repo);
      expect((yield* hooksStatus(repo)).find((row) => row.target === path)?.state).toBe('current');
    }),
  );

  it.effect('a registration of ours at an occasion nothing asks for is withdrawn, and reads extra until it is', () =>
    Effect.gen(function* () {
      const repo = yield* temporary;
      yield* installHooks(repo);
      const path = join(repo, '.claude', 'settings.json');
      const doc = JSON.parse(readFileSync(path, 'utf8'));
      const theirs = { type: 'command', command: 'echo compacting' };
      const ours = { type: 'command', command: 'tagma hook observe' };
      doc.hooks.PreCompact = [{ hooks: [theirs, ours] }];
      doc.hooks.SubagentStop = [{ hooks: [ours] }];
      writeFileSync(path, JSON.stringify(doc));

      const before = (yield* hooksStatus(repo)).find((row) => row.target === path);
      expect(before?.state).toBe('stale');
      if (before?.state === 'stale') {
        expect(before.extra).toEqual(['PreCompact', 'SubagentStop']);
        expect(before.missing).toEqual([]);
        expect(before.differing).toEqual([]);
      }

      expect(claudeOf(yield* installHooks(repo))?.write).toBe('updated');
      const written = JSON.parse(readFileSync(path, 'utf8'));
      expect(written.hooks.PreCompact).toEqual([{ hooks: [theirs] }]);
      expect(written.hooks).not.toHaveProperty('SubagentStop');
      expect((yield* hooksStatus(repo)).find((row) => row.target === path)?.state).toBe('current');
    }),
  );

  it.effect('a withdrawal that would move a command of theirs is deferred instead', () =>
    Effect.gen(function* () {
      const repo = yield* temporary;
      yield* installHooks(repo);
      const path = join(repo, '.claude', 'settings.json');
      const doc = JSON.parse(readFileSync(path, 'utf8'));
      const theirs = { hooks: [{ type: 'command', command: 'echo compacting' }] };
      doc.hooks.PreCompact = [{ hooks: [{ type: 'command', command: 'tagma hook observe' }] }, theirs];
      writeFileSync(path, JSON.stringify(doc));

      const claudeWrite = claudeOf(yield* installHooks(repo));
      expect(claudeWrite?.deferred?.join(' ')).toContain('PreCompact');
      const written = JSON.parse(readFileSync(path, 'utf8'));
      expect(JSON.stringify(written.hooks.PreCompact[0])).toContain('$t\\" hook observe');
      expect(written.hooks.PreCompact[1]).toEqual(theirs);
    }),
  );

  it.effect('an occasion holding none of ours is never read, malformed or not', () =>
    Effect.gen(function* () {
      const repo = yield* temporary;
      yield* installHooks(repo);
      const path = join(repo, '.claude', 'settings.json');
      const doc = JSON.parse(readFileSync(path, 'utf8'));
      doc.hooks.PreCompact = [null];
      writeFileSync(path, JSON.stringify(doc));

      expect(claudeOf(yield* installHooks(repo))?.write).toBe('current');
      expect(JSON.parse(readFileSync(path, 'utf8')).hooks.PreCompact).toEqual([null]);
      expect((yield* hooksStatus(repo)).find((row) => row.target === path)?.state).toBe('current');
    }),
  );

  it.effect('a file holding none of ours reads missing, and a place that will not open reads unreadable', () =>
    Effect.gen(function* () {
      const repo = yield* temporary;
      mkdirSync(join(repo, '.codex'), { recursive: true });
      writeFileSync(
        join(repo, '.codex', 'hooks.json'),
        JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }),
      );
      expect((yield* hooksStatus(repo)).find((row) => row.target.endsWith('.codex/hooks.json'))?.state).toBe('missing');

      writeFileSync(join(repo, '.codex', 'hooks.json'), 'not json at all\n');
      const broken = (yield* hooksStatus(repo)).find((row) => row.target.endsWith('.codex/hooks.json'));
      expect(broken?.state).toBe('unreadable');
      if (broken?.state === 'unreadable') expect(broken.path).toBe(join(repo, '.codex', 'hooks.json'));
    }),
  );

  it.effect('installSkill writes exactly the files it assembles and detects a changed file', () =>
    Effect.gen(function* () {
      const { contributed } = doctrineOf(yield* Doctrine);
      const target = join(yield* temporary, 'tagma');
      const { files } = yield* installSkill(target, contributed);
      expect(files).toEqual(['LIFECYCLE.md', 'OPERATIONS.md', 'ORCHESTRATION.md', 'REVIEW.md', 'SKILL.md']);
      expect((yield* skillStatus(target, contributed)).state).toBe('current');

      const review = readFileSync(join(target, 'REVIEW.md'), 'utf8');
      writeFileSync(join(target, 'REVIEW.md'), `${review}\n`);
      const status = yield* skillStatus(target, contributed);
      expect(status.state).toBe('stale');
      if (status.state === 'stale') expect(status.differing).toEqual(['REVIEW.md']);
    }),
  );

  it.effect('a filesystem refusal while checking a path is unreadable rather than missing', () =>
    Effect.gen(function* () {
      const { contributed } = doctrineOf(yield* Doctrine);
      const disk = yield* FileSystem.FileSystem;
      const repo = yield* temporary;
      const target = join(repo, 'tagma');
      yield* disk.symlink(target, target);
      expect(yield* skillStatus(target, contributed)).toMatchObject({ state: 'unreadable', target, path: target });
      const hooks = join(repo, '.codex', 'hooks.json');
      yield* disk.makeDirectory(dirname(hooks));
      yield* disk.symlink(hooks, hooks);
      expect((yield* hooksStatus(repo)).find((row) => row.target === hooks)).toMatchObject({ state: 'unreadable', path: hooks });
    }),
  );

  it.effect('a repository install resolves the skill link even when its parent is shared', () =>
    Effect.gen(function* () {
      const { contributed } = doctrineOf(yield* Doctrine);
      const disk = yield* FileSystem.FileSystem;
      for (const shared of [false, true]) {
        const repo = yield* temporary;
        if (shared) {
          yield* disk.makeDirectory(join(repo, '.claude'));
          yield* disk.makeDirectory(join(repo, '.agents', 'skills'), { recursive: true });
          yield* disk.symlink(join('..', '.agents', 'skills'), join(repo, '.claude', 'skills'));
        }
        const installed = yield* installInto(repo, 'LAW', async () => [], contributed);
        expect(yield* skillStatus(installed.skill.target, contributed)).toMatchObject({ state: 'current' });
        expect(yield* disk.realPath(installed.links[0]!)).toBe(yield* disk.realPath(installed.skill.target));
        expect(installed.agents.write).toBe('created');
      }
    }),
  );

  it.effect('a place a status reading cannot open is answered, not thrown', () =>
    Effect.gen(function* () {
      const { contributed } = doctrineOf(yield* Doctrine);
      const target = join(yield* temporary, 'tagma');
      writeFileSync(target, 'not a directory\n');
      const skill = yield* skillStatus(target, contributed);
      expect(skill.state).toBe('unreadable');
      if (skill.state === 'unreadable') expect(skill.path).toBe(target);
    }),
  );

  it.effect("installForUser writes every format's own user hooks file under an isolated HOME", () =>
    Effect.gen(function* () {
      const home = yield* temporary;
      const nested = { hooks: [{ type: 'command', command: 'echo foreign' }] };
      const direct = { command: 'echo foreign' };
      const seed: [string, unknown][] = [
        ['.claude/settings.json', { hooks: { SessionStart: [nested] } }],
        ['.cursor/hooks.json', { version: 1, hooks: { sessionStart: [direct] } }],
        ['.codex/hooks.json', { hooks: { SessionStart: [nested] } }],
        ['.gemini/settings.json', { hooks: { SessionStart: [nested] } }],
        ['.grok/hooks/tagma.json', { hooks: { SessionStart: [nested] } }],
        ['.config/opencode/tagma-hooks.json', { hooks: { SessionStart: [nested] } }],
      ];
      for (const [file, doc] of seed) {
        const target = join(home, ...file.split('/'));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, JSON.stringify(doc));
      }
      const driver = join(home, 'drive-install.ts');
      const installModule = fileURLToPath(new URL('../../../external-harnesses/installs/skillInstall.ts', import.meta.url));
      const graphModule = fileURLToPath(new URL('../../doctrine.ts', import.meta.url));
      writeFileSync(
        driver,
        [
          `import { Effect } from ${JSON.stringify(import.meta.resolve('effect'))};`,
          `import * as BunFileSystem from ${JSON.stringify(import.meta.resolve('@effect/platform-bun/BunFileSystem'))};`,
          `import { installForUser } from ${JSON.stringify(installModule)};`,
          `import { doctrine } from ${JSON.stringify(graphModule)};`,
          `import { shippedAdaptersLayer } from ${JSON.stringify(fileURLToPath(new URL('./shipped.ts', import.meta.url)))};`,
          `console.log(JSON.stringify(await Effect.runPromise(Effect.flatMap(doctrine, ({ contributed }) => installForUser(contributed)).pipe(Effect.provide(BunFileSystem.layer), Effect.provide(shippedAdaptersLayer)))));`,
        ].join('\n'),
      );
      const {
        CODEX_HOME: _codex,
        CLAUDE_CONFIG_DIR: _claude,
        GROK_HOME: _grok,
        OPENCODE_CONFIG_DIR: _opencode,
        ...inherited
      } = process.env;
      const ran = yield* spawnedEffect([process.execPath, driver], {
        env: { ...inherited, HOME: home },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(ran.exitCode).toBe(0);
      const wrote: UserInstall = JSON.parse(ran.stdout.toString());
      expect(wrote.skill.target).toBe(join(home, '.agents', 'skills', 'tagma'));
      expect(wrote.hooks.map((row) => row.path).sort()).toEqual(
        [
          ...seed.map(([file]) => join(home, ...file.split('/'))),
          join(home, '.config/opencode/plugins/tagma/index.ts'),
          join(home, '.config/opencode/plugins/tagma/package.json'),
        ].sort(),
      );
      const claude = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
      expect(claude.hooks.SessionStart[0]).toEqual(nested);
      expect(JSON.stringify(claude.hooks.UserPromptSubmit)).toContain('hook observe');
      const cursor = JSON.parse(readFileSync(join(home, '.cursor', 'hooks.json'), 'utf8'));
      expect(cursor.version).toBe(1);
      expect(cursor.hooks.sessionStart[0]).toEqual(direct);
      expect(JSON.stringify(cursor.hooks.beforeSubmitPrompt)).toContain('hook observe');
      const codex = JSON.parse(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8'));
      expect(codex.hooks.SessionStart[0]).toEqual(nested);
      expect(JSON.stringify(codex.hooks.UserPromptSubmit)).toContain('hook observe');
      const gemini = JSON.parse(readFileSync(join(home, '.gemini', 'settings.json'), 'utf8'));
      expect(gemini.hooks.SessionStart[0]).toEqual(nested);
      expect(JSON.stringify(gemini.hooks.BeforeAgent)).toContain('hook observe');
      const grok = JSON.parse(readFileSync(join(home, '.grok/hooks/tagma.json'), 'utf8'));
      expect(grok.hooks.SessionStart[0]).toEqual(nested);
      expect(JSON.stringify(grok.hooks.UserPromptSubmit)).toContain('hook observe --harness grok');
      const opencode = JSON.parse(readFileSync(join(home, '.config/opencode/tagma-hooks.json'), 'utf8'));
      expect(opencode.hooks.SessionStart[0]).toEqual(nested);
      expect(JSON.stringify(opencode.hooks.UserPromptSubmit)).toContain('hook observe --harness opencode');
    }),
  );

  it.effect('installForUser honors a configured CODEX_HOME for the Codex user hooks file', () =>
    Effect.gen(function* () {
      const home = yield* temporary;
      const codexHome = join(home, 'codex-home');
      mkdirSync(codexHome, { recursive: true });
      const nested = { hooks: [{ type: 'command', command: 'echo foreign' }] };
      const target = join(codexHome, 'hooks.json');
      writeFileSync(target, JSON.stringify({ hooks: { SessionStart: [nested] } }));
      const driver = join(home, 'drive-install.ts');
      const installModule = fileURLToPath(new URL('../../../external-harnesses/installs/skillInstall.ts', import.meta.url));
      const graphModule = fileURLToPath(new URL('../../doctrine.ts', import.meta.url));
      writeFileSync(
        driver,
        [
          `import { Effect } from ${JSON.stringify(import.meta.resolve('effect'))};`,
          `import * as BunFileSystem from ${JSON.stringify(import.meta.resolve('@effect/platform-bun/BunFileSystem'))};`,
          `import { installForUser } from ${JSON.stringify(installModule)};`,
          `import { doctrine } from ${JSON.stringify(graphModule)};`,
          `import { shippedAdaptersLayer } from ${JSON.stringify(fileURLToPath(new URL('./shipped.ts', import.meta.url)))};`,
          `console.log(JSON.stringify(await Effect.runPromise(Effect.flatMap(doctrine, ({ contributed }) => installForUser(contributed)).pipe(Effect.provide(BunFileSystem.layer), Effect.provide(shippedAdaptersLayer)))));`,
        ].join('\n'),
      );
      const {
        CODEX_HOME: _codex,
        CLAUDE_CONFIG_DIR: _claude,
        GROK_HOME: _grok,
        OPENCODE_CONFIG_DIR: _opencode,
        ...inherited
      } = process.env;
      const ran = yield* spawnedEffect([process.execPath, driver], {
        env: { ...inherited, HOME: home, CODEX_HOME: codexHome },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(ran.exitCode).toBe(0);
      const wrote: UserInstall = JSON.parse(ran.stdout.toString());
      expect(wrote.skill.target).toBe(join(home, '.agents', 'skills', 'tagma'));
      expect(wrote.hooks.map((row) => row.path).sort()).toEqual(
        [
          join(home, '.claude', 'settings.json'),
          join(home, '.cursor', 'hooks.json'),
          join(home, '.gemini', 'settings.json'),
          join(home, '.grok/hooks/tagma.json'),
          join(home, '.config/opencode/tagma-hooks.json'),
          join(home, '.config/opencode/plugins/tagma/index.ts'),
          join(home, '.config/opencode/plugins/tagma/package.json'),
          target,
        ].sort(),
      );
      const codex = JSON.parse(readFileSync(target, 'utf8'));
      expect(codex.hooks.SessionStart[0]).toEqual(nested);
      expect(JSON.stringify(codex.hooks.UserPromptSubmit)).toContain('hook observe');
    }),
  );

  it.effect('an install that finds an unreadable target writes none of them', () =>
    Effect.gen(function* () {
      const { contributed } = doctrineOf(yield* Doctrine);
      const repo = yield* temporary;
      mkdirSync(join(repo, '.codex'), { recursive: true });
      writeFileSync(join(repo, '.codex', 'hooks.json'), '{nope');
      expect((yield* Effect.flip(installInto(repo, 'LAW', async () => [], contributed)))._tag).toBe('InstallFailed');
      expect(existsSync(join(repo, 'AGENTS.md'))).toBe(false);
      expect(existsSync(skillTarget(repo))).toBe(false);

      rmSync(join(repo, '.codex'), { recursive: true });
      writeFileSync(join(repo, 'AGENTS.md'), `${LAW_START}\nnever closed\n`);
      expect((yield* Effect.flip(installInto(repo, 'LAW', async () => [], contributed)))._tag).toBe('InstallFailed');
      expect(existsSync(skillTarget(repo))).toBe(false);
      expect(existsSync(join(repo, '.codex'))).toBe(false);
    }),
  );
});
