import { expect, test } from 'bun:test';
import { shellCommitDirs, shellFileEdit, shellOnlySleeps, shellReadsOnly, shellSweepShape, type ShellSweepShape } from './shellShapes';

for (const command of [
  "wc -l serve.log && date '+%Y-%m-%dT%H:%M:%S%z'",
  'sed -n 1,80p src/a.ts',
  'cd src && rg -n token . | head -5 2>/dev/null',
  'git -C repo log --oneline -5 && git status --short',
  'find . -name "*.ts" | sort',
]) {
  test(`writes nothing: ${command}`, () => {
    expect(shellReadsOnly(command)).toBe(true);
  });
}

for (const command of [
  'cat a > b',
  'sed -i s/a/b/ f',
  "sed -n '1w out' f",
  'find . -name x -delete',
  'rg token --pre ./decode',
  'sort -o out in',
  'echo "$(touch x)"',
  'cat <"$(./make-input)"',
  'file -C -m rules',
  'tree -o listing.txt src',
  "git -c diff.external='touch marker' diff --ext-diff",
  'git commit -m change',
  'git diff --output=patch',
  'bun run typecheck',
  'wc -l a | tee b',
]) {
  test(`may write: ${command}`, () => {
    expect(shellReadsOnly(command)).toBe(false);
  });
}

const SWEEPS: readonly (readonly [string, ShellSweepShape['shape']])[] = [
  ['git commit -m change', 'git commit'],
  ['git commit -am change', 'git commit'],
  ['git commit -a', 'git commit'],
  ['git commit --all -m change', 'git commit'],
  ['git add -A', 'git add --all'],
  ['git add --all', 'git add --all'],
  ['git stash', 'git stash'],
  ['git stash pop', 'git stash'],
  ['bun test && git add -A', 'git add --all'],
  ['sh -c "git stash push"', 'git stash'],
  ['git reset --hard', 'git reset --hard'],
  ['git reset --hard HEAD~1', 'git reset --hard'],
  ['git checkout .', 'git checkout .'],
  ['git checkout -- .', 'git checkout .'],
  ['git restore .', 'git restore .'],
  ['git clean', 'git clean'],
  ['git clean -fd', 'git clean'],
  ['git -C . commit -m change', 'git commit'],
  ['git -c user.name=me commit -m change', 'git commit'],
  ['git --no-pager stash', 'git stash'],
];

for (const [command, shape] of SWEEPS) {
  test(`shared-checkout sweep: ${command}`, () => {
    const found = shellSweepShape(command);
    if (found === null) throw new Error('expected a shared-checkout sweep');
    expect(found.code).toBe('shared-checkout');
    expect(found.shape).toBe(shape);
    expect(found.reason.length).toBeGreaterThan(0);
  });
}

for (const command of [
  'git commit -- a b',
  'git commit --only a',
  "git commit -m 'change' -- $paths",
  'git commit --only "$path"',
  'git add a b',
  'git log',
  'git stash list',
  'git stash list --stat',
  'git stash show -p stash@{0}',
  'git reset --hard -- src/a.ts',
  'git reset --hard -- src/a.ts src/b.ts',
  'git reset --soft HEAD~1',
  'git checkout -- src/a.ts',
  'git checkout src/a.ts',
  'git checkout main',
  'git restore src/a.ts',
  'git restore --staged src/a.ts',
  'git clean -fd src',
  'git clean -- src',
  'git clean -n',
  'git clean --dry-run',
  'git -C . commit -- a',
  'git -c core.editor=true merge --continue',
  'git --version',
]) {
  test(`path-scoped git passes: ${command}`, () => {
    expect(shellSweepShape(command)).toBeNull();
  });
}

test('-C directories ride the shape in order', () => {
  expect(shellSweepShape('git -C ../other -C sub commit -m change')?.within).toEqual(['../other', 'sub']);
  expect(shellSweepShape('git commit -m change')?.within).toBeUndefined();
});

test('a followed cd moves where a sweep and every commit run; an unfollowed one leaves them where they were', () => {
  expect(shellSweepShape('cd /work/other && git commit -m change')?.within).toEqual(['/work/other']);
  expect(shellSweepShape('cd "$repo" && git commit -m change')?.within).toBeUndefined();
  expect(shellCommitDirs('cd /work/other && git add a && git commit -m change -- a')).toEqual([['/work/other']]);
  expect(shellCommitDirs('cd ../other && git -C sub commit -- a')).toEqual([['../other', 'sub']]);
  expect(shellCommitDirs('git commit -- a')).toEqual([[]]);
  expect(shellCommitDirs('git log')).toEqual([]);
});

test('a computed stash subcommand is swept with the bare form', () => {
  expect(shellSweepShape('git stash $verb')?.shape).toBe('git stash');
  expect(shellSweepShape('git stash -u')?.shape).toBe('git stash');
});

for (const command of [
  'sleep 300',
  'sleep 60; sleep 60',
  'sleep 30 && sleep 30',
  '/bin/sleep 5',
  'sleep 280; echo waited',
  'date; sleep 60 && printf done',
]) {
  test(`only sleeps: ${command}`, () => {
    expect(shellOnlySleeps(command)).toBe(true);
  });
}

for (const [command, files] of [
  ["sed -i '' 's/void_/empty/g' terminalDelivery.stest.ts", ['terminalDelivery.stest.ts']],
  ["sed -i.bak -e 's/a/b/' src/a.ts src/b.ts", ['src/a.ts', 'src/b.ts']],
  ["gsed --in-place 's/a/b/' src/a.ts", ['src/a.ts']],
  ["cd server && perl -pi -e 's/a/b/' src/a.ts", ['src/a.ts']],
  ["perl -i.orig -pe 's/a/b/' -- src/a.ts", ['src/a.ts']],
] as const) {
  test(`edits named files in place: ${command}`, () => {
    expect(shellFileEdit(command)?.files).toEqual(files);
  });
}

for (const command of [
  "sed -n '1,40p' src/a.ts",
  "sed 's/a/b/' src/a.ts > out.ts",
  "sed -i '' 's/a/b/' src/*.ts",
  "rg -l old src | xargs sed -i '' 's/old/new/g'",
  `sed -i '' 's/a/b/' ${Array.from({ length: 10 }, (_, at) => `f${at}.ts`).join(' ')}`,
  "perl -ne 'print if /a/' src/a.ts",
]) {
  test(`is no edit of a few named files: ${command}`, () => {
    expect(shellFileEdit(command)).toBeNull();
  });
}

for (const command of [
  'sleep 2; cd shop && pnpm test',
  'sleep 30 && tail -5 build.log',
  'until test -f done; do sleep 2; done',
  'echo sleep',
  'sleep 5; echo "$(curl -s localhost)"',
  'sleep 5; echo done > marker',
]) {
  test(`does more than sleep: ${command}`, () => {
    expect(shellOnlySleeps(command)).toBe(false);
  });
}
