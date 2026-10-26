import { describe, expect, it } from 'bun:test';
import type { Field } from './ProcessReader';
import { matchProgram, matchTightest, type ProgramLookups, type ProgramMatch, type ProgramRule } from './ProgramMatch';

const ROOT = '/repo';

const read = <A>(value: A): Field<A> => ({ _tag: 'Read', value });
const unread: Field<never> = { _tag: 'Unreadable' as const, detail: 'denied' };

const proc = (args: ReadonlyArray<string>, options: { executable?: string; folder?: string } = {}) => ({
  args: read(args),
  executable: read(options.executable ?? `/usr/bin/${args[0]}`),
  folder: read(options.folder ?? ROOT),
});

const lookups = (files: ReadonlyArray<string>, links: Record<string, string> = {}): ProgramLookups => ({
  isFile: (path) => files.includes(path),
  realPath: (path) => {
    for (const [link, target] of Object.entries(links)) {
      if (path === link || path.startsWith(`${link}/`)) return target + path.slice(link.length);
    }
    return path;
  },
});

type Named = ProgramRule & { readonly name: string };
const rule = (name: string, words: string, folder?: string): Named => ({ name, words: words.split(' '), folder });

const decided = (match: ProgramMatch<Named>): string | undefined => (match._tag === 'Matched' ? match.rule.name : undefined);

describe('program word', () => {
  it('matches the basename of argv[0]', () => {
    expect(decided(matchProgram(proc(['/opt/bin/tsc', '-p', 'x']), [rule('r', 'tsc')], ROOT, lookups([])))).toBe('r');
  });

  it('matches the basename of the executable when argv[0] names something else', () => {
    const helper = proc(['Code Helper'], { executable: '/Applications/x/electron' });
    expect(decided(matchProgram(helper, [rule('r', 'electron')], ROOT, lookups([])))).toBe('r');
  });

  it('tsc covers node running the tsc bin', () => {
    const tsc = proc(['node', '/repo/node_modules/typescript/bin/tsc', '-p', 'x']);
    const files = lookups(['/repo/node_modules/typescript/bin/tsc']);
    expect(decided(matchProgram(tsc, [rule('r', 'tsc')], ROOT, files))).toBe('r');
    expect(decided(matchProgram(tsc, [rule('r', 'tsc -p x')], ROOT, files))).toBe('r');
  });

  it('vitest covers node running vitest.mjs, the extension dropped', () => {
    const vitest = proc(['node', 'node_modules/vitest/vitest.mjs', 'run']);
    const files = lookups(['/repo/node_modules/vitest/vitest.mjs']);
    expect(decided(matchProgram(vitest, [rule('r', 'vitest')], ROOT, files))).toBe('r');
  });

  it('pytest covers python -m pytest', () => {
    const pytest = proc(['python', '-m', 'pytest', '-k', 'slow']);
    expect(decided(matchProgram(pytest, [rule('r', 'pytest')], ROOT, lookups([])))).toBe('r');
    expect(decided(matchProgram(pytest, [rule('r', 'pytest slow')], ROOT, lookups([])))).toBe('r');
  });

  it('takes the script relative to the process folder, skipping arguments that name no file', () => {
    const run = proc(['bun', 'run', 'scripts/test.ts'], { folder: '/repo/apps/api' });
    expect(decided(matchProgram(run, [rule('r', 'test')], ROOT, lookups(['/repo/apps/api/scripts/test.ts'])))).toBe('r');
    expect(decided(matchProgram(run, [rule('r', 'test')], ROOT, lookups(['/repo/scripts/test.ts'])))).toBeUndefined();
  });

  it('a file argument of a program that is no interpreter is no script', () => {
    const files = lookups(['/repo/pytest.ini', '/repo/tsc.log']);
    expect(decided(matchProgram(proc(['cat', 'pytest.ini']), [rule('r', 'pytest')], ROOT, files))).toBeUndefined();
    expect(decided(matchProgram(proc(['tail', '-f', 'tsc.log']), [rule('r', 'tsc')], ROOT, files))).toBeUndefined();
  });

  it('a shell given -c has no script, while a shell running a file does', () => {
    const files = lookups(['/repo/deploy.sh']);
    expect(decided(matchProgram(proc(['bash', 'deploy.sh']), [rule('r', 'deploy')], ROOT, files))).toBe('r');
    expect(decided(matchProgram(proc(['sh', '-c', 'deploy.sh']), [rule('r', 'deploy')], ROOT, files))).toBeUndefined();
    expect(decided(matchProgram(proc(['zsh', '-lc', 'deploy.sh']), [rule('r', 'deploy')], ROOT, files))).toBeUndefined();
  });

  it('known limit: an option value before the script shifts it', () => {
    const shifted = proc(['node', '--require', './x.js', 'vitest.mjs']);
    const files = lookups(['/repo/x.js', '/repo/vitest.mjs']);
    expect(decided(matchProgram(shifted, [rule('r', 'x')], ROOT, files))).toBe('r');
    expect(decided(matchProgram(shifted, [rule('r', 'vitest')], ROOT, files))).toBeUndefined();
    expect(decided(matchProgram(shifted, [rule('r', 'node vitest.mjs')], ROOT, files))).toBe('r');
  });
});

describe('other words', () => {
  const commit = [rule('commit', 'git commit')];

  it('git commit covers git -C repo commit -m x', () => {
    expect(decided(matchProgram(proc(['git', '-C', 'repo', 'commit', '-m', 'x']), commit, ROOT, lookups([])))).toBe('commit');
  });

  it('git commit does not cover git add docs/commit.md', () => {
    expect(decided(matchProgram(proc(['git', 'add', 'docs/commit.md']), commit, ROOT, lookups(['/repo/docs/commit.md'])))).toBeUndefined();
  });

  it('bun test does not cover bun run scripts/test.ts', () => {
    const run = proc(['bun', 'run', 'scripts/test.ts']);
    expect(decided(matchProgram(run, [rule('r', 'bun test')], ROOT, lookups(['/repo/scripts/test.ts'])))).toBeUndefined();
  });

  it('keeps the written order', () => {
    expect(decided(matchProgram(proc(['git', 'x', 'commit']), [rule('r', 'git commit x')], ROOT, lookups([])))).toBeUndefined();
  });

  it('known limit: git log --grep commit matches git commit', () => {
    expect(decided(matchProgram(proc(['git', 'log', '--grep', 'commit']), commit, ROOT, lookups([])))).toBe('commit');
  });
});

describe('folder', () => {
  const api = [rule('api', 'tsc', 'apps/api')];

  it('covers the rule folder and everything below it', () => {
    expect(decided(matchProgram(proc(['tsc'], { folder: '/repo/apps/api' }), api, ROOT, lookups([])))).toBe('api');
    expect(decided(matchProgram(proc(['tsc'], { folder: '/repo/apps/api/src/x' }), api, ROOT, lookups([])))).toBe('api');
  });

  it('does not cover a folder beside it, even one sharing its prefix', () => {
    expect(decided(matchProgram(proc(['tsc'], { folder: '/repo/apps/web' }), api, ROOT, lookups([])))).toBeUndefined();
    expect(decided(matchProgram(proc(['tsc'], { folder: '/repo/apps/api-old' }), api, ROOT, lookups([])))).toBeUndefined();
    expect(decided(matchProgram(proc(['tsc'], { folder: '/repo' }), api, ROOT, lookups([])))).toBeUndefined();
  });

  it('compares real paths on both sides', () => {
    const linked = lookups([], { '/link': '/repo' });
    expect(decided(matchProgram(proc(['tsc'], { folder: '/link/apps/api/src' }), api, ROOT, linked))).toBe('api');
    expect(decided(matchProgram(proc(['tsc'], { folder: '/repo/apps/api' }), api, '/link', linked))).toBe('api');
  });

  it('matches make where it runs after -C', () => {
    const make = [rule('make', 'make', 'x')];
    expect(decided(matchProgram(proc(['make', '-C', 'x'], { folder: '/repo/x' }), make, ROOT, lookups([])))).toBe('make');
  });

  it('a rule folder that does not resolve covers nothing', () => {
    const missing: ProgramLookups = { isFile: () => false, realPath: (path) => (path.startsWith('/repo/apps/api') ? undefined : path) };
    expect(decided(matchProgram(proc(['tsc'], { folder: '/repo/apps/api' }), api, ROOT, missing))).toBeUndefined();
  });
});

describe('ordering', () => {
  it('the last matching rule decides', () => {
    const test = proc(['bun', 'test']);
    const project = rule('project', 'bun test');
    const thread = rule('thread', 'bun');
    const other = rule('other', 'git commit');
    expect(decided(matchProgram(test, [project, thread, other], ROOT, lookups([])))).toBe('thread');
    expect(decided(matchProgram(test, [thread, project, other], ROOT, lookups([])))).toBe('project');
    const match = matchProgram(test, [project, thread, other], ROOT, lookups([]));
    expect(match._tag === 'Matched' && match.index).toBe(1);
  });

  it('across lists the tightest list decision binds, a tie going to the later list, and inside a list the last match decides', () => {
    const test = proc(['bun', 'test']);
    const listed = (name: string, words: string, list: number, limitMs: number) => ({ ...rule(name, words), list, limitMs });
    const machine = listed('machine', 'bun test', 0, 60_000);
    const machineLater = listed('machine-later', 'bun', 0, 300_000);
    const project = listed('project', 'bun', 1, 120_000);
    const looser = listed('looser', 'bun test', 2, 90_000);
    const tighter = listed('tighter', 'bun', 2, 30_000);
    const git = listed('git', 'git', 2, 1_000);
    expect(decided(matchTightest(test, [machine, project, looser], ROOT, lookups([])))).toBe('machine');
    expect(decided(matchTightest(test, [machine, project, looser, tighter], ROOT, lookups([])))).toBe('tighter');
    expect(decided(matchTightest(test, [machine, machineLater, project, git], ROOT, lookups([])))).toBe('project');
    expect(decided(matchTightest(test, [machine, { ...project, limitMs: 60_000 }], ROOT, lookups([])))).toBe('project');
    const match = matchTightest(test, [machine, project, git, tighter], ROOT, lookups([]));
    expect(match._tag === 'Matched' && match.index).toBe(3);
    expect(matchTightest(proc(['ls']), [machine, project], ROOT, lookups([]))._tag).toBe('None');
  });

  it('no matching rule answers none', () => {
    expect(matchProgram(proc(['ls']), [rule('r', 'bun test')], ROOT, lookups([]))._tag).toBe('None');
  });
});

describe('unread fields', () => {
  const rules = [rule('r', 'bun')];

  it('a process whose arguments were not read matches nothing and says so', () => {
    const process = { args: unread, executable: read('/usr/bin/bun'), folder: read(ROOT) };
    expect(matchProgram(process, rules, ROOT, lookups([]))).toEqual({ _tag: 'Unread', fields: ['args'] });
  });

  it('a process whose folder was not read matches nothing and says so', () => {
    const process = { args: read(['bun']), executable: read('/usr/bin/bun'), folder: unread };
    expect(matchProgram(process, rules, ROOT, lookups([]))).toEqual({ _tag: 'Unread', fields: ['folder'] });
  });

  it('an unread executable still matches through argv[0]', () => {
    const process = { args: read(['bun', 'test']), executable: unread, folder: read(ROOT) };
    expect(decided(matchProgram(process, rules, ROOT, lookups([])))).toBe('r');
  });
});
