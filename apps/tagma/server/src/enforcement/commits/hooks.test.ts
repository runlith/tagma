import { describe, expect, test } from 'bun:test';
import { gateStanding, passesOwnGit } from '../contract/wire/gateHook.js';
import { COMMIT_HOOKS, hookText, type HookCli } from './hooks.js';

const cli = (owner: string): HookCli => ({ runtime: '/run/bun', entry: '/run/cli.js', server: 'http://127.0.0.1:1', owner });

const alive = (standing: readonly string[]) => (owner: string) => standing.includes(owner);

describe('whose commit gate a hook file is', () => {
  test('a hook written by this installation is its own', () => {
    for (const hook of COMMIT_HOOKS) {
      expect(gateStanding(hookText(hook, cli('/data/main')), '/data/main', alive([]))).toBe('mine');
    }
  });

  test('a hook another live installation wrote is never taken', () => {
    const text = hookText('pre-commit', cli('/data/main'));
    expect(gateStanding(text, '/data/copy', alive(['/data/main']))).toBe('foreign');
  });

  test('a hook whose installation no longer stands is reclaimable', () => {
    const text = hookText('pre-commit', cli('/data/gone'));
    expect(gateStanding(text, '/data/main', alive(['/data/main']))).toBe('vanished');
  });

  test('a gate that names no owner has no installation standing behind it and is reclaimable', () => {
    const unowned = '#!/bin/sh\n# tagma commit gate\nchained="$(dirname "$0")/pre-commit.tagma-chained"\n';
    expect(gateStanding(unowned, '/data/main', alive([]))).toBe('vanished');
  });

  test('a hook that is not the commit gate is not ours', () => {
    expect(gateStanding('#!/bin/sh\necho hi\n', '/data/main', alive([]))).toBe('not-ours');
    expect(gateStanding('', '/data/main', alive([]))).toBe('not-ours');
  });

  test('every hook the gate writes ends before acting under the server’s own git, and an edited one does not', () => {
    for (const hook of COMMIT_HOOKS) expect(passesOwnGit(hook, hookText(hook, cli('/data/main')))).toBe(true);
    const text = hookText('pre-commit', cli('/data/main'));
    expect(passesOwnGit('pre-merge-commit', text)).toBe(false);
    expect(passesOwnGit('pre-commit', text.replace('exit 0', 'echo acted; exit 0'))).toBe(false);
    expect(passesOwnGit('pre-commit', text.replace('; fi', '; else echo acted; fi'))).toBe(false);
    expect(passesOwnGit('pre-commit', '#!/bin/sh\necho hi\n')).toBe(false);
  });

  test('the owner line names the installation, not the server address', () => {
    const first = hookText('pre-commit', cli('/data/main'));
    const moved = hookText('pre-commit', { ...cli('/data/main'), server: 'http://127.0.0.1:2' });
    expect(gateStanding(moved, '/data/main', alive([]))).toBe(gateStanding(first, '/data/main', alive([])));
  });
});
