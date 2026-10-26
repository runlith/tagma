import { describe, expect, test } from 'bun:test';
import { GitNotAdmitted } from '@runlith/git/Git';
import { GitRefused, GitUnreadable } from '@runlith/git/repository';
import { gitEnvironment, OwnGitFailed, readingFailed } from './ownGit.js';

const refused = (message: string) => new OwnGitFailed({ op: 'probe', message, ran: true }).reason;

describe('OwnGitFailed', () => {
  test('classifies what git said under the C locale', () => {
    expect(refused("fatal: Unable to create '/repo/.git/index.lock': File exists.\n\nAnother git process seems to be running")).toBe(
      'locked',
    );
    expect(refused('fatal: not a git repository (or any of the parent directories): .git')).toBe('not-a-repository');
    expect(refused("fatal: cannot change to '/gone': No such file or directory")).toBe('not-a-repository');
    expect(refused("git: 'hook' is not a git command. See 'git --help'.")).toBe('hook-unsupported');
    expect(refused('error: pathspec did not match')).toBe('refused');
  });

  test('a git that never ran is unstarted whatever its message says', () => {
    expect(new OwnGitFailed({ op: 'probe', message: 'fatal: not a git repository', ran: false }).reason).toBe('unstarted');
  });
});

describe('readingFailed', () => {
  const command = ['status'];

  test('a reading refused by admission is not admitted, with its refusal kept, and git’s own refusal is not', () => {
    const admission = new GitNotAdmitted({ command, code: 'terminal-no-owner', reason: 'no live owner', unblock: ['name a live owner'] });
    const refused = readingFailed('probe', new GitUnreadable({ command, reason: 'not admitted', admission }));
    expect([refused.reason, refused.ran, refused.admission]).toEqual(['not-admitted', false, admission]);

    const said = readingFailed('probe', new GitRefused({ command, status: 1, message: 'error: pathspec', truncated: false }));
    expect([said.reason, said.admission]).toEqual(['refused', undefined]);
  });
});

describe('gitEnvironment', () => {
  test('pins messages to C and keeps the inherited character type', () => {
    const saved = { all: process.env.LC_ALL, ctype: process.env.LC_CTYPE };
    try {
      process.env.LC_ALL = 'de_DE.UTF-8';
      delete process.env.LC_CTYPE;
      const env = gitEnvironment();
      expect(env.LC_ALL).toBeUndefined();
      expect(env.LC_MESSAGES).toBe('C');
      expect(env.LC_CTYPE).toBe('de_DE.UTF-8');
    } finally {
      if (saved.all === undefined) delete process.env.LC_ALL;
      else process.env.LC_ALL = saved.all;
      if (saved.ctype === undefined) delete process.env.LC_CTYPE;
      else process.env.LC_CTYPE = saved.ctype;
    }
  });
});
