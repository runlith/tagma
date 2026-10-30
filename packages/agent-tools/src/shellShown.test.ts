import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { shellShown } from './shellShown';

const ROOT = '/repo';
const FILES = new Set(['/repo/src/a.ts', '/repo/src/sub/b.ts', '/repo/src/c.ts', '/repo/src/my-file.ts']);

const shown = (command: string, output = '', cwd = ROOT) =>
  shellShown({ command, output, cwd, root: ROOT }, (path) => Effect.succeed(FILES.has(path)));

it.effect('a file named by a command is read, whatever the command', () =>
  Effect.gen(function* () {
    expect(yield* shown('sed -n 1,5p src/a.ts')).toEqual([{ path: '/repo/src/a.ts', as: 'read' }]);
    expect(yield* shown('cat /repo/src/c.ts | head -3')).toEqual([{ path: '/repo/src/c.ts', as: 'read' }]);
    expect(yield* shown('cd src && head sub/b.ts')).toEqual([{ path: '/repo/src/sub/b.ts', as: 'read' }]);
    expect(yield* shown('git show HEAD:src/a.ts')).toEqual([{ path: '/repo/src/a.ts', as: 'read' }]);
  }),
);

it.effect('home-relative operands use the shell home while quoted tildes and expansions stay literal or unknown', () =>
  Effect.gen(function* () {
    for (const [command, files] of [
      ['head ~/a.ts', ['/repo/src/a.ts']],
      ["head '~/a.ts'", []],
      ['head ~/a*.ts', []],
      ['head ~/$FILE', []],
    ] as const) {
      const result = yield* shellShown({ command, output: '', cwd: ROOT, root: ROOT, home: '/repo/src' }, (path) =>
        Effect.succeed(FILES.has(path)),
      );
      expect(result).toEqual(files.map((path) => ({ path, as: 'read' })));
    }
  }),
);

it.effect('flags, patterns, directories and missing paths show nothing', () =>
  Effect.gen(function* () {
    expect(yield* shown('rg -n --glob "*.ts" pattern src missing.ts')).toEqual([]);
  }),
);

it.effect('a search hit in the output is found, relative to where the command stood', () =>
  Effect.gen(function* () {
    expect(yield* shown('cd src && rg x .', 'a.ts:3:const x = 1;\nmy-file.ts-4-context\nsub/b.ts:9:x')).toEqual([
      { path: '/repo/src/a.ts', as: 'found' },
      { path: '/repo/src/my-file.ts', as: 'found' },
      { path: '/repo/src/sub/b.ts', as: 'found' },
    ]);
  }),
);

it.effect('filename-less search output stays data while forced filenames remain search sites', () =>
  Effect.gen(function* () {
    const output = `function es(t){${'x'.repeat(1_000)};return t?t?1:2:3;}`;
    const probe = (path: string) => (path.length > 255 ? Effect.fail('name-too-long') : Effect.succeed(FILES.has(path)));
    for (const command of ['rg -a -o pattern src/a.ts', 'rg -n -o pattern src/a.ts', 'grep -h pattern src/a.ts src/c.ts']) {
      const result = yield* shellShown({ command, output, cwd: ROOT, root: ROOT }, probe);
      expect(result).toEqual(
        command.startsWith('grep')
          ? [
              { path: '/repo/src/a.ts', as: 'read' },
              { path: '/repo/src/c.ts', as: 'read' },
            ]
          : [{ path: '/repo/src/a.ts', as: 'read' }],
      );
    }
    expect(yield* shown('rg -Hn x src', 'src/sub/b.ts:3:x')).toEqual([{ path: '/repo/src/sub/b.ts', as: 'found' }]);
  }),
);

it.effect('a diff names its files from the repository root', () =>
  Effect.gen(function* () {
    expect(yield* shown('cd src && git diff', 'diff --git a/src/c.ts b/src/c.ts\n+line', '/repo/src')).toEqual([
      { path: '/repo/src/c.ts', as: 'found' },
    ]);
  }),
);

it.effect('a file both named and found counts as read', () =>
  Effect.gen(function* () {
    expect(yield* shown('rg x src/a.ts', 'src/a.ts:1:x')).toEqual([{ path: '/repo/src/a.ts', as: 'read' }]);
  }),
);

it.effect('colored search sites keep the filename and never probe the matching text', () =>
  Effect.gen(function* () {
    const output = `\u001b[35msrc/a.ts\u001b[0m:\u001b[32m1\u001b[0m:const text = "${'x'.repeat(1_000)}:2:later";`;
    const result = yield* shellShown({ command: 'rg -n x src', output, cwd: ROOT, root: ROOT }, (path) =>
      path.length > 255 ? Effect.fail('name-too-long') : Effect.succeed(FILES.has(path)),
    );
    expect(result).toEqual([{ path: '/repo/src/a.ts', as: 'found' }]);
  }),
);

it.effect('inline programs and JSON operands are data even when they contain file spellings', () =>
  Effect.gen(function* () {
    const code = `import { Database } from "bun:sqlite"; console.log("${'x'.repeat(1_000)}");`;
    const output = `{"url":"https://chatgpt.com/0:1:${'x'.repeat(1_000)}"}`;
    const result = yield* shellShown({ command: `bun -e '${code}' '{"path":"src/a.ts"}'`, output, cwd: ROOT, root: ROOT }, (path) =>
      path.length > 255 ? Effect.fail('name-too-long') : Effect.succeed(FILES.has(path)),
    );
    expect(result).toEqual([]);
  }),
);

it.effect('argument roles distinguish programs, selectors and SQL from real file operands', () =>
  Effect.gen(function* () {
    const cases = [
      [`swift -j 3 -e 'src/a.ts'`, []],
      [`swift test -j 3 --filter 'src/a.ts'`, []],
      [`exec bun -e 'src/a.ts'`, []],
      [`env -u SECRET MODE=probe bun -e 'src/a.ts'`, []],
      [`jq --arg name src/a.ts --slurpfile rows src/c.ts 'src/a.ts' src/sub/b.ts`, ['/repo/src/c.ts', '/repo/src/sub/b.ts']],
      [`jq -f src/a.ts src/c.ts`, ['/repo/src/a.ts', '/repo/src/c.ts']],
      [`sqlite3 src/a.ts 'src/c.ts'`, ['/repo/src/a.ts']],
      [`swift src/a.ts src/c.ts`, ['/repo/src/a.ts']],
      [`bash -o pipefail src/a.ts src/c.ts`, ['/repo/src/a.ts']],
      [`node --require src/a.ts src/sub/b.ts src/c.ts`, ['/repo/src/a.ts', '/repo/src/sub/b.ts']],
      [`node --require=src/a.ts src/sub/b.ts src/c.ts`, ['/repo/src/a.ts', '/repo/src/sub/b.ts']],
      [`node --eval=src/a.ts src/c.ts`, []],
    ] as const;
    for (const [command, files] of cases) {
      expect(yield* shown(command)).toEqual(files.map((path) => ({ path, as: 'read' })));
    }
  }),
);

it.effect('awk and sed programs are code while their input files stay files, and only a launched interpreter is re-entered', () =>
  Effect.gen(function* () {
    const cases = [
      [`awk '{print $1}' src/a.ts src/c.ts`, ['/repo/src/a.ts', '/repo/src/c.ts']],
      [`awk -F: -v n=1 '{print}' src/a.ts`, ['/repo/src/a.ts']],
      [`awk -f src/a.ts src/c.ts`, ['/repo/src/a.ts', '/repo/src/c.ts']],
      [`awk -fsrc/a.ts src/c.ts`, ['/repo/src/a.ts', '/repo/src/c.ts']],
      [`gawk --file=src/a.ts src/c.ts`, ['/repo/src/a.ts', '/repo/src/c.ts']],
      [`gawk -e 'BEGIN{}' --source 'END{}' src/c.ts`, ['/repo/src/c.ts']],
      [`sed -e's/a/b/' src/a.ts`, ['/repo/src/a.ts']],
      [`sed -e x --expression=y src/a.ts`, ['/repo/src/a.ts']],
      [`sed '' src/a.ts`, ['/repo/src/a.ts']],
      [`sed -i '' 's/a/b/' src/a.ts`, ['/repo/src/a.ts']],
      [`cat sh src/a.ts`, ['/repo/src/a.ts']],
      [`cat sed src/a.ts`, ['/repo/src/a.ts']],
      [`timeout 5 sed -n 1p src/c.ts`, ['/repo/src/c.ts']],
      [`runner /bin/sh -c 'cat src/a.ts'`, []],
    ] as const;
    for (const [command, files] of cases) {
      expect(yield* shown(command)).toEqual(files.map((path) => ({ path, as: 'read' })));
    }
  }),
);

it.effect('git log text is not a search site even if its prefix is an existing filename', () =>
  Effect.gen(function* () {
    expect(yield* shown('git log --format=%s', 'src/a.ts:1:a commit subject')).toEqual([]);
  }),
);

it.effect('boolean flags of readers and git do not consume a following file', () =>
  Effect.gen(function* () {
    expect(yield* shown('cat -e src/a.ts')).toEqual([{ path: '/repo/src/a.ts', as: 'read' }]);
    expect(yield* shown('git show -p HEAD:src/a.ts')).toEqual([{ path: '/repo/src/a.ts', as: 'read' }]);
  }),
);

it.effect('quoted bracket paths stay files rather than JSON operands', () =>
  Effect.gen(function* () {
    const path = '/repo/[id]/+page.svelte';
    const read = yield* shellShown({ command: `head '[id]/+page.svelte'`, output: '', cwd: ROOT, root: ROOT }, (name) =>
      Effect.succeed(name === path),
    );
    expect(read).toEqual([{ path, as: 'read' }]);
  }),
);

it.effect('git grep delivers search sites and a later cd does not move an earlier search', () =>
  Effect.gen(function* () {
    expect(yield* shown('git grep -n x -- src', 'src/a.ts:3:x')).toEqual([{ path: '/repo/src/a.ts', as: 'found' }]);
    expect(yield* shown('rg -n x src && cd sub', 'src/a.ts:3:x')).toEqual([{ path: '/repo/src/a.ts', as: 'found' }]);
  }),
);

it.effect('git log patch headers are sites while its ordinary text stays data', () =>
  Effect.gen(function* () {
    expect(yield* shown('git log -p', 'diff --git a/src/a.ts b/src/a.ts\n+changed')).toEqual([{ path: '/repo/src/a.ts', as: 'found' }]);
  }),
);

it.effect('C-quoted diff filenames decode their bytes and preserve escaped backslashes', () =>
  Effect.gen(function* () {
    const files = new Set(['/repo/src/б.ts', '/repo/src/a\\303.ts']);
    const output = String.raw`diff --git "a/src/\320\261.ts" "b/src/\320\261.ts"
diff --git "a/src/a\\303.ts" "b/src/a\\303.ts"`;
    const result = yield* shellShown({ command: 'git diff', output, cwd: ROOT, root: ROOT }, (path) => Effect.succeed(files.has(path)));
    expect(result).toEqual([
      { path: '/repo/src/б.ts', as: 'found' },
      { path: '/repo/src/a\\303.ts', as: 'found' },
    ]);
  }),
);

it.effect('a search pattern is data even when it spells an existing filename', () =>
  Effect.gen(function* () {
    expect(yield* shown('rg src/a.ts src')).toEqual([]);
    expect(yield* shown('rg --glob "*.ts" src/a.ts src')).toEqual([]);
    expect(yield* shown('rg -e src/a.ts src')).toEqual([]);
  }),
);

it.effect('a colon in a filename keeps its spelling outside a git revision operand', () =>
  Effect.gen(function* () {
    const files = new Set(['/repo/source:src/a.ts', '/repo/src/a.ts']);
    const result = yield* shellShown({ command: 'head source:src/a.ts', output: '', cwd: ROOT, root: ROOT }, (path) =>
      Effect.succeed(files.has(path)),
    );
    expect(result).toEqual([{ path: '/repo/source:src/a.ts', as: 'read' }]);
  }),
);
