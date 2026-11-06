# Formatter on commit and its baseline

Format commands are the project's format-on-save at commit time: commands Tagma runs over the version of every commit it lands (`submit_work`, `commit_checkout`) and whose result enters the commit. A merge commit is the exception: it lands its merged tree as it stands, unformatted. They are declared under `format` in `tagma.config.ts` at the repository root; `read_config` answers what HEAD declares. Act only when the owner asks; write nothing before their word.

## 1. Read what the repository already has

Read, do not guess: formatter and linter configs (`.prettierrc*`, `biome.json`, `dprint.json`, `.oxfmtrc.json`, `rustfmt.toml`, `ruff.toml`, `pyproject.toml`, `.editorconfig`), `package.json` scripts and lint-staged, `.husky/`, `.pre-commit-config.yaml`, `lefthook.yml`, the CI workflows' form checks (`prettier --check`, `gofmt -l`, `cargo fmt --check`, `ruff format --check`), and an existing `tagma.config.ts`. Check that the tool is installed (`node_modules/.bin`, `PATH`) and its version.

## 2. Decide

- Form is already held by team hooks (husky + lint-staged, pre-commit, lefthook): they run on Tagma's commits. Say so and propose no format commands: two formatters in a row cost twice, and different ones rewrite each other forever.
- A formatter exists only in the editor or CI: propose one command from that installed tool, with the project's own config and the same file set CI checks.
- No formatter: propose nothing. Name a formatter only if the owner asks for one.

## 3. The command

```ts
import { defineConfig, Format } from '@runlith/tagma/rules';

export default defineConfig({
  format: {
    oxfmt: Format.command({
      run: ['node_modules/.bin/oxfmt', '--no-error-on-unmatched-pattern'],
      files: ['**/*.{ts,tsx,json,svelte}', '!archive/**'],
      reads: 'nearby',
    }),
    ruff: Format.command({ run: ['ruff', 'format'], files: ['**/*.py'] }),
    eslint: Format.command({ run: ['node_modules/.bin/eslint', '--fix'], files: ['src/**/*.ts'], ok: [0, 1] }),
  },
});
```

- A key is lowercase letters, digits and `-`, starting with a letter; it names the command in refusals.
- `run` is argv; the changed files matching `files` are appended, as lint-staged does, so an entry from lint-staged, lefthook or pre-commit carries over almost verbatim. It runs from the repository root. An `argv[0]` containing `/` resolves from the root, otherwise through `PATH`.
- `files` are globs with `!` exclusions; the tool's own ignore files apply on top. A path whose git attributes set `linguist-generated` (as a plugin's `dist/**` and `tagma-plugin.json`) or a `filter` is never handed to a command, and no rule judges or measures a generated path either.
- `ok` lists every exit code by which the tool says it ran, default `[0]`: `eslint --fix` and `ruff check --fix` exit 1 while unfixable findings remain, so they take `[0, 1]`. Findings left after the fix are an inspection's to judge, not the command's.
- `reads` says which committed files the tool reads besides its own: `tree`, the default, gives it the whole commit; `nearby` gives it only the tracked files in its files' directories and their parents, plus the tracked paths `run` names, so a commit in a large repository writes a handful of files instead of all of them. Set `nearby` only where that holds — a formatter finding its config upward from the file; never a type-aware linter or a config importing a file from another directory, which would quietly run without it.
- Commands run in the order they are written, each over the previous result. A command only turns a file into itself: formatting, import sorting, a linter's `--fix`, a file header. Codegen, lockfiles and anything writing other files stay hooks or CI.
- A command that exits outside `ok`, dies, is missing or runs past its ceiling refuses the whole commit (`format-failed`, `format-missing`, `format-cut`); there is no best-effort.
- The rules judge the commands' result, so a rule's places and counts read the formatted file. A refusal after the commands ran writes that form into the working files and names them; check_rules over the change names them in `formed` without writing.
- Keep the tool's own config where the tool finds it. Match what CI checks, so a commit passing steps passes CI.

## 4. Baseline

A file not already in the declared form is rewritten whole by the first edit that touches it, and collides with other sessions' lines in it. So propose, with the command, a one-off baseline commit of the whole declared scope:

1. Run the tool over exactly the `files` scope in a clean state, with no worktree holding uncommitted work.
2. Show the owner what it changes: files changed, lines added and removed (`git diff --shortstat`), which files cross size limits or other standing rules, which files fail to parse, and which paths the scope should exclude (generated, vendored, fixtures that depend on line numbers).
3. Where the tool has a layout option that changes the diff (line width, quote style), measure the candidates and recommend one by evidence from this repository.
4. After the owner agrees: land the baseline as its own commit, run the project's typecheck and tests, and add the commit to `.git-blame-ignore-revs` with `git config blame.ignoreRevsFile` guidance for the team.

## 5. Write

Write `tagma.config.ts` only on the owner's word, as a normal change; where it already exists, add the `format` section beside its inspections. It is read from the commit's own version, so it changes with the branch that changes the formatter; a `tagma.config.ts` git ignores is not read.

Report: what the repository had, what you propose or why nothing, the baseline's measured effect, what is unproved.
