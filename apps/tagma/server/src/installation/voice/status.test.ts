import { describe, expect, test } from 'bun:test';
import type { MachineState } from '../contract/wire/machine.js';
import type { NextFrame } from '../contract/wire/next.js';
import { type Answered, renderMachine, renderStatus } from './status.js';

const quiet: NextFrame = {
  instance: 'status-fixture',
  pid: 1,
  revision: 1,
  readAt: '2026-09-18T00:30:00.000Z',
  readFrom: null,
  watched: false,
  issue: null,
  standing: { tone: 'alone', said: [{ text: 'nothing offers a next installation', strong: false }], behind: null },
  offers: [],
  update: null,
  back: null,
  installing: null,
  installed: null,
  acts: [],
};

describe('tagma status', () => {
  const build = 'abc1234 20260202T000000000Z';
  const held = {
    surface: { served: { build, root: '/i/current/surface' } },
    host: { served: { build, root: '/i/current/desktop' } },
  };
  const stated = {
    ok: true as const,
    version: '0.1.0',
    database: '/d/tagma.sqlite',
    schema: { applied: 3, latest: '20260101_x' },
    standing: null,
    sessionIdentity: { prefix: {}, extras: [] },
  };

  test('an installed process names its closure once and says only where each part stands', () => {
    const answered: Answered = {
      _tag: 'Health',
      health: { ...stated, source: { cut: null, installation: { build, digest: 'sha256:aa' } }, builds: held },
    };

    const lines = renderStatus(answered, 'http://127.0.0.1:5633').split('\n');

    expect(lines).toContain(`installation ${build} — sha256:aa`);
    expect(lines).toContain('surface /i/current/surface');
    expect(lines).toContain('host /i/current/desktop');
    expect(lines.some((line) => line.startsWith('source '))).toBe(false);
  });

  test('a checkout process names the installation it hands out, because that is not the code answering', () => {
    const answered: Answered = {
      _tag: 'Health',
      health: {
        ...stated,
        source: { cut: { startedAt: '2026-02-02T00:00:00.000Z', revision: { head: 'ff00aa', dirty: true } }, installation: null },
        builds: held,
      },
    };

    const lines = renderStatus(answered, 'http://127.0.0.1:5633').split('\n');

    expect(lines).toContain(`surface /i/current/surface — installation ${build}`);
    expect(lines.some((line) => line.startsWith('source up since'))).toBe(true);
  });

  test('the standing prints the two processes in plain words, and every act with what it ends', () => {
    const standing: MachineState = {
      restart: { record: null, issue: null, stage: null, startup: null },
      readAt: '2026-09-18T00:30:00.000Z',
      server: {
        pid: 1,
        startedAt: '2026-09-18T00:18:00.000Z',
        agents: 0,
        calls: 0,
        born: { replacedPid: 7 },
        installation: { build, digest: 'sha256:aa' },
        cut: null,
        waiting: { build: 'a69e0c3f 20260918T000412Z', digest: 'sha256:bb' },
        next: {
          ...quiet,
          standing: {
            tone: 'behind',
            said: [
              { text: 'runlith', strong: true },
              { text: ' is 3 commits ahead of this build', strong: false },
            ],
            behind: '3 commits',
          },
          offers: [
            {
              id: 'release-12',
              title: 'Release',
              detail: 'what changed',
              label: '12',
              size: 52_428_800,
              irreversible: true,
              current: false,
              disabled: null,
              why: null,
              update: 'tagma release update',
              install: 'tagma release update',
            },
          ],
          installed: {
            offer: 'head',
            title: 'Latest commit',
            target: 'a69e0c3',
            outcome: 'landed',
            build: 'a69e0c3f 20260918T000412Z',
            detail: 'installation a69e0c3f 20260918T000412Z stands',
            endedAt: '2026-09-18T00:29:00.000Z',
            log: '/Users/me/.tagma/build.log',
            since: '2026-09-18T00:27:00.000Z',
            tail: [],
            then: null,
            restartRefused: null,
          },
        },
      },
      host: {
        presence: 'answering',
        detail: 'This server raised the host from its own bundle.',
        incarnation: 14,
        build,
        since: '2026-09-18T00:18:05.000Z',
        custody: 'ours',
        holds: {
          running: [
            {
              execution: 'e1',
              incarnation: 14,
              title: 'Tagma app dev server',
              kind: 'terminal',
              holder: 'operator',
              since: '2026-09-17T21:00:00.000Z',
            },
            { execution: 'e2', incarnation: 14, title: 'bun run typecheck', kind: 'command', holder: 'thread:t1', since: null },
          ],
          terminals: 1,
          commands: 1,
          records: 105,
        },
        memory: { reserved: 1, retained: 2, grant: 3 },
      },
      acts: [{ act: 'restart', command: 'tagma restart', disabled: null }],
    };

    const text = renderMachine(standing, 'http://127.0.0.1:5633');

    expect(text).toContain('update ready: build a69e0c3f — tagma restart');
    expect(text).toContain('host    up  build abc1234 · up 12 min');
    expect(text).toContain('running: 1 terminal, 1 command');
    expect(text).toContain('Tagma app dev server · yours · 3 h 30 min');
    expect(text).toContain('bun run typecheck · thread:t1');
    expect(text).not.toContain('sha256');
    expect(text).not.toContain('pid');
  });

  test('a host that is not there is said as down, with the floor’s own sentence', () => {
    const standing: MachineState = {
      restart: { record: null, issue: null, stage: null, startup: null },
      readAt: '2026-09-18T00:30:00.000Z',
      server: {
        pid: 1,
        startedAt: '2026-09-18T00:29:30.000Z',
        agents: 0,
        calls: 0,
        born: { replacedPid: null },
        installation: null,
        cut: { startedAt: '2026-09-18T00:29:30.000Z', revision: { head: 'ff00aa11', dirty: true } },
        waiting: null,
        next: quiet,
      },
      host: {
        presence: 'absent',
        detail: 'No execution host is running.',
        incarnation: null,
        build: null,
        since: null,
        custody: 'unknown',
        holds: null,
        memory: null,
      },
      acts: [],
    };

    const text = renderMachine(standing, 'http://127.0.0.1:5633');

    expect(text).toContain('host    down  No execution host is running.');
  });

  test('with nothing installed each part says so', () => {
    const answered: Answered = {
      _tag: 'Health',
      health: {
        ...stated,
        source: { cut: null, installation: null },
        builds: { surface: { served: null }, host: { served: null } },
      },
    };

    const lines = renderStatus(answered, 'http://127.0.0.1:5633');

    expect(lines).toContain('surface none stands');
    expect(lines).toContain('host none stands');
    expect(lines).not.toContain('installation ');
  });
});
