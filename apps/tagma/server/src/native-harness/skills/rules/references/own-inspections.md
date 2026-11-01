# Linters and the project's own programs

For a norm no builtin expresses. Either judges both sides of a change like a builtin, under the same gate, debt and Rules screen. Prepare the tools and dependencies in the checkout being judged using the repository's setup command. For each new worktree, write_setting with key `worktrees.setupRun` and that command as `value`; it runs before the worktree's first turn. Use the project's package manager and environment — its Bun, npm, pnpm, Yarn, Python or other setup — including generated tools the checks require.

## A linter the project already runs

The tool is described once in `tagma.config.ts`, and each norm is a key of its own through `.rule(id)`:

```ts
import { defineConfig, Linters } from '@runlith/tagma/rules';

const eslint = Linters.eslint({ config: 'eslint.config.js' });
const ruff = Linters.ruff();

export default defineConfig({
  inspections: {
    'no-console': eslint.rule('no-console'),
    'line-length': ruff.rule('E501', { files: ['src/**/*.py'] }),
  },
});
```

- Named tools: `Linters.eslint`, `oxlint`, `ruff`, `semgrep`, `astGrep`. `config` names the tool's config file, read at the judged tree — it must be committed, and a peer's uncommitted edit to it judges nothing else (ast-grep's `ruleDirs` likewise; of the files ESLint's config imports, the tracked JS, TS and JSON ones); `argv` the command that runs it: a first word `bun` is Tagma's Bun, one containing `/` resolves from the repository root, any other through `PATH`.
- Version floors follow the API or output the adapter consumes: ESLint 9.0.0 (flat-config `ESLint` and `ruleFilter`), oxlint 1.63.0 (SARIF), ast-grep 0.41.1 (severity overrides for inline rules), Semgrep 1.56.0 (`Semgrep OSS` SARIF). Later versions are accepted; a version below the floor fails with the required and found versions. ESLint checks its API before using it, oxlint and ast-grep check installed package metadata before linting. Semgrep reads its version from scan output and probes `--version` when a failed scan cannot be read; the adapters validate the versions in the output they consume.
- Any other tool: `Linters.command({ argv, output: 'sarif' })` is a tool whose `.rule(id)` keys select its SARIF 2.1 results by rule id. `Linters.command({ argv, output: 'findings' }, { files })` is itself the inspection: its stdout is `{ "findings": [ … ] }` in the program finding shape below, each `path` one it was given.
- A command gets the files of both sides of the change copied under `tree/` and `base/` in a scratch directory and appended to its argv. Exit 0 and 1 count as ran; any other code fails the check `inspection-failed`.
- For a named tool and a SARIF command the fingerprint is the key and the file, the count of the rule's results its value: the debt unit is a file. A findings command's fingerprints are its own, as a program's are.
- The tool's message is the finding's message. Its fix is the tool's own where it gives one — a SARIF result's `fixes[].description`, Ruff's fix message and rule page — else "Change the code so <tool> rule <id> no longer reports it here."
- `files` on a key narrows its reach to those globs. Keys of one tool share one lint invocation per judged tree; Semgrep's diagnostic version probe runs only on a failed scan.
- Linter rules stand under "External linters" on the Rules screen.

## The project's own program

A program is a module of the repository whose functions judge; `defineInspection` describes one of them for `tagma.config.ts`.

```ts
// checks/inspections.ts
import { defineInspection } from '@runlith/tagma/rules';

export type MarkersParams = { readonly words: readonly string[] };

export const markers = defineInspection<MarkersParams>({ program: 'checks/programs.ts', name: 'markers', concern: 'code' });
```

```ts
// checks/programs.ts
import { defineProgram, type Finding, type Reading, type Side } from '@runlith/tagma/rules';
import type { MarkersParams } from './inspections';

const reading = async (side: Side, words: readonly string[]): Promise<Reading> => {
  const findings: Finding[] = [];
  for (const path of side.paths) {
    const text = await side.read(path);
    if (text === null) continue;
    for (const word of words)
      if (text.includes(word)) findings.push({ fingerprint: `${word} @ ${path}`, path, message: `${path} carries ${word}` });
  }
  return { findings };
};

export default defineProgram<{ markers: MarkersParams }>({
  markers: async ({ params, tree, base }) =>
    base === null ? { tree: await reading(tree, params.words) } : { tree: await reading(tree, params.words), base: await reading(base, params.words) },
});
```

```ts
// tagma.config.ts
import { defineConfig } from '@runlith/tagma/rules';
import { markers } from './checks/inspections';

export default defineConfig({ inspections: { markers: markers({ words: ['FIXME'] }, { files: ['src/**/*.ts'] }) } });
```

- `defineInspection({ program, name, concern, needs })`: `program` is the module's path from the repository root, `name` its function, `concern` the Rules screen group (`imports`, `loading`, `code`, `size`), `needs` the code facts the server computes for it — `imports`, `declarations` — delivered as `side.facts`. Calling it with params and `{ files }` gives the key's description.
- The module's default export is `defineProgram({ <name>: program })`. Tagma runs it with its own Bun from the root of the checkout holding the judged work — for merge_worktree the source worktree, whose files a merge already holding its base equals; it loads its own dependencies from the project's `node_modules`, and `@runlith/tagma/*` comes from Tagma. Every JS, TS or JSON file git tracks — the module, its helpers, workspace packages linked into `node_modules` — is read at the judged tree; untracked and installed files are read from the checkout. All keys of one module run in one process per judged tree, each function called once per key.
- A program receives `params`, the `tree` side, the `base` side (null when there is none), and `mode` (`measure` for a standing measurement; absent or `change` for a landing). A tree reading may declare `remeasure: 'delta'`: its confirmed measurement then permits a future delta to supply that version as `base`. This promises measurement semantics: return every current finding on the covered paths, including findings already present on that base. Without that declaration, remeasurement keeps `base: null`. A program needing a cold index or whose reader changed may answer a whole-reach reading instead. A side holds its `commit`, `paths` — the changed paths in the key's reach, or every path of the reach when `whole` — `read(path)` (text, or null where the path is absent) and `facts`.
- It answers `{ tree: { findings, covered? }, base?: { … } }`. `covered: 'reach'` covers the whole reach; absent or `'paths'`, the paths given. An explicit path array covers the requested paths plus the unchanged paths the inspection rejudged through its affected frontier; include every requested path and every finding's path. Return the same affected paths on base and tree so a complete empty base read defeats stale debt, and unrelated debt stays untouched. For a change, a base reading left out means nothing was found on the base, so every tree finding is new: answer the base whenever one is given. A measurement may omit the base reading because all current findings count.
- A finding is `{ fingerprint, path, line?, message, fix?, value?, sites? }`. The fingerprint is the violation's identity and its debt unit: keep it stable under unrelated edits — a line number in it turns every edit above the violation into a new violation. `message` is what is wrong at the place, one phrase without the path, printed after `path:line`; only its first line is kept. `fix` is how to remove this one finding, from the program's own data — what to use instead, the allowance to declare; without it every surface prints "Remove it where <name>'s message points." `value` is a measure, such as a size; `sites` lists the places of one fingerprint, which the server unfolds after comparing with the base.
- The server reads every changed file of the reach as UTF-8 text for the program, and a file that is not text fails the check. `files` therefore names exactly what the program reads — a description without it claims the rule's whole region, binary files included. Findings outside the reach are dropped, so `files` narrower than what the program judges loses violations.
- A change to the program is judged by the program it carries, and a peer's uncommitted edit to it judges nothing else. Imports still resolve against the checkout's files: a tracked file of the program that a peer deleted or renamed without committing fails the check until that lands.
- When a program asks to prepare a revision index for a change, run `check_rules` with its inspection key and `over: "change"`, preserving the refused landing's `paths`, `whole` and `taking`. This measures the inspection's whole reach with the candidate's program on both sides; `over: "all"` measures HEAD and cannot prepare a different candidate reader.
