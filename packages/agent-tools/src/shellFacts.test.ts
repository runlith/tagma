import { expect, test } from 'bun:test';
import { shellFacts } from './shellFacts';
import { impliedBy } from './WorkspaceChanges';

const CWD = '/repo';

const shape = (command: string) =>
  shellFacts(command, CWD).parts.map((part) => ({
    role: part.readsOnly ? 'reads' : part.listed ? 'listed' : part.named !== null ? 'named' : 'writer',
    named: part.named,
    signature: part.signature,
  }));

test('a check behind wrappers and prefixes is a listed reader, and its own exception flag or an output variable makes it a writer', () => {
  expect(shape('cd apps/x && timeout 200 bun test ./a.test.ts 2>&1 | tail -3').map((part) => part.role)).toEqual([
    'reads',
    'listed',
    'reads',
  ]);
  expect(shape('uv run python -m pytest -q tests/')).toEqual([{ role: 'listed', named: [], signature: 'pytest' }]);
  expect(shape('bun run tagma:typecheck')[0]?.role).toBe('listed');
  expect(shape('npx jest -u')[0]?.role).toBe('writer');
  expect(shape('RUNLITH_TEST_REPORT=1 bun test')[0]?.role).toBe('writer');
});

test('an editor names the paths it changes from the directory the line moved to, a backup suffix included', () => {
  expect(shape('cd src && node_modules/.bin/oxfmt a.ts b.ts')[1]).toEqual({
    role: 'named',
    named: ['/repo/src/a.ts', '/repo/src/b.ts'],
    signature: 'oxfmt',
  });
  expect(shape("sed -i.bak 's/a/b/' x.ts")[0]?.named).toEqual(['/repo/x.ts', '/repo/x.ts.bak']);
  expect(shape('mv old.ts new.ts')[0]).toEqual({ role: 'named', named: ['/repo/old.ts', '/repo/new.ts'], signature: null });
  expect(shape('bun test > /tmp/log.txt')[0]).toEqual({ role: 'listed', named: ['/tmp/log.txt'], signature: 'bun test' });
});

test('shell operands preserve glob syntax and quoting, find names its roots, and dynamic paths stay opaque', () => {
  expect(shape('rm dist/*.js *.log')[0]?.named).toEqual([{ glob: '/repo/dist/*.js' }, { glob: '/repo/*.log' }]);
  expect(shape('rmdir build/{one,two}?')[0]?.named).toEqual([{ glob: '/repo/build/one?' }, { glob: '/repo/build/two?' }]);
  expect(shape('touch dist/[ab].js')[0]?.named).toEqual([{ glob: '/repo/dist/[ab].js' }]);
  expect(shape('rm "dist/*.js" dist/\\*.log')[0]?.named).toEqual(['/repo/dist/*.js', '/repo/dist/*.log']);
  expect(shape('rm "dist/["*.js')[0]?.named).toEqual([{ glob: '/repo/dist/\\[*.js' }]);
  expect(shape("find -L build cache -name '*.map' -delete")[0]?.named).toEqual(['/repo/build', '/repo/cache']);
  expect(shape("find -name '*.map' -delete")[0]?.named).toEqual(['/repo']);
  expect(shape('find -f build -delete')[0]?.named).toEqual(['/repo/build']);
  expect(shape("find build -name '-delete'")[0]?.role).toBe('reads');
  expect(shape("find build -name '-exec' -delete")[0]?.named).toEqual(['/repo/build']);
  expect(shape('find -files0-from roots -delete')[0]?.named).toBeNull();
  expect(shape('rm dist/missing*/../a.js')[0]?.named).toBeNull();
  for (const command of [
    'rm $ROOT/*.js',
    'rm "${ROOT}"/*.js',
    'rm ~/dist/*.js',
    'rm $(pwd)/*.js',
    'find "$ROOT" -delete',
    'find build -delete -exec touch /elsewhere \\;',
  ])
    expect(shape(command)[0]?.named).toBeNull();
});

test('git names the working files its pathspecs change, and nothing for an index-only change', () => {
  expect(shape('git -C src checkout HEAD -- a.ts b')[0]?.named).toEqual(['/repo/src/a.ts', '/repo/src/b']);
  expect(shape('git mv -k old.ts lib/new.ts')[0]?.named).toEqual(['/repo/old.ts', '/repo/lib/new.ts']);
  expect(shape('git restore --source HEAD~1 a.ts')[0]?.named).toEqual(['/repo/a.ts']);
  expect(shape('git rm --cached a.ts')[0]?.named).toEqual([]);
  expect(shape('git restore --staged a.ts')[0]?.named).toEqual([]);
  expect(shape('git checkout main')[0]?.role).toBe('writer');
  expect(shape("git rm -r 'src/*.ts'")[0]?.role).toBe('writer');
  expect(shape('git restore :/a.ts')[0]?.role).toBe('writer');
  expect(shape('git rm -n -- a.ts')[0]?.named).toEqual([]);
  expect(shape('git mv --dry-run old.ts new.ts')[0]?.named).toEqual([]);
  expect(shape('git restore -qS -- a.ts')[0]?.named).toEqual([]);
  expect(shape('git restore --conflict diff3 a.ts')[0]?.named).toEqual(['/repo/a.ts']);
  expect(shape('git restore --pathspec-from-file=list')[0]?.role).toBe('writer');
  expect(shape('git --git-dir=/other/.git --work-tree=/other restore -- a.ts')[0]?.role).toBe('writer');
  expect(shape('git -c core.worktree=/other restore -- a.ts')[0]?.role).toBe('writer');
  expect(shape('GIT_WORK_TREE=/other git restore -- a.ts')[0]?.role).toBe('writer');
});

test('a check names the files its output flags and redirects write, and a download to a remote name names nothing it can stand by', () => {
  expect(shape('curl -fsSLo vendor/x.tgz https://example.com/x.tgz')[0]).toEqual({
    role: 'listed',
    named: ['/repo/vendor/x.tgz'],
    signature: 'curl',
  });
  expect(shape('curl -LO https://example.com/x.tgz')[0]?.named).toBeNull();
  expect(shape('pytest --junitxml=reports/junit.xml')[0]?.named).toEqual(['/repo/reports/junit.xml']);
  expect(shape('bun test > "$LOG"')[0]).toEqual({ role: 'listed', named: null, signature: null });
});

test('the implicit outputs a check declares cover the files its runner writes on its own', () => {
  const covered = (command: string, name: string) => impliedBy(shellFacts(command, CWD).parts[0]?.implicit ?? [], name);
  expect(covered('bun test', 'src/__snapshots__/a.test.ts.snap')).toBe(true);
  expect(covered('npx playwright test', 'tests/a.spec.ts-snapshots/home.png')).toBe(true);
  expect(covered('npx cypress run', 'cypress/screenshots/a.png')).toBe(true);
  expect(covered('cargo test', 'crates/x/Cargo.lock')).toBe(true);
  expect(covered('bun test', 'src/a.ts')).toBe(false);
});

test('what cannot be named is a writer, and one that changes files by nature carries no signature to learn from', () => {
  expect(shape("perl -pi -e 's/a/b/' src/*.ts")[0]?.role).toBe('writer');
  expect(shape("npx prettier --write 'src/**/*.ts'")[0]).toEqual({ role: 'writer', named: null, signature: null });
  expect(shape('cd ~/x && oxfmt a.ts')[1]?.role).toBe('writer');
  expect(shape('python3 -c \'open("x","w")\'')[0]).toEqual({ role: 'writer', named: null, signature: null });
  expect(shape('for f in a b; do bun test $f; done')[0]?.role).toBe('writer');
  expect(shape('bun install')[0]).toEqual({ role: 'writer', named: null, signature: null });
  expect(shape('RUNLITH_TEST_REPORT=1 bun test')[0]).toEqual({ role: 'writer', named: null, signature: null });
  expect(shape('tsc -p .')[0]).toEqual({ role: 'writer', named: null, signature: null });
  expect(shape('node scripts/x.js > docs/out.md')[0]).toEqual({ role: 'writer', named: null, signature: null });
  expect(shape('python3 scripts/gen.py')[0]).toEqual({ role: 'writer', named: null, signature: 'python3 /repo/scripts/gen.py' });
});
