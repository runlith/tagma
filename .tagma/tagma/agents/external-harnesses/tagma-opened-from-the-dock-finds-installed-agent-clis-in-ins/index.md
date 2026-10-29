---
id: 01a13bf9-2f15-7d9a-aca2-21a02aa569ba
title: "Tagma opened from the Dock finds installed agent CLIs in install places and under a broken shell profile: one PATH owner, background profile read with waiters, --version check, runtime pair outside PATH, recheck with no restart"
ord: 69
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a13209-1c70-7d0c-87f4-40b2e7b7be7f
  - kind: relates
    to: 01a13bf9-11e2-786b-95e8-fc902afe23ec
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/birth/installed.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/loginPath.ts
---
Tagma, opened from the Dock or Finder, finds installed agent CLIs — Claude Code, Codex, Grok, Gemini, Devin, Cursor — in the places their installers, nvm, Homebrew, and version managers put them, even when the user's shell profile loads slowly or fails; it also finds a CLI installed while Tagma is open, on "Check again". When a CLI is not found, Tagma says where it looked and why not.

## Why

The operator's friend installed public 0.1.0, and the accounts panel said "Claude Code isn't installed" (`packages/adapter-anthropic/src/adapter.ts`, `missing`), though Claude Code was there. Before even looking at his machine, the code breaks in several places:

- A CLI is looked up only on the process PATH (`Bun.which`), and a Dock-opened app's PATH is system folders alone.
- The server reads the user's folders once at startup from `$SHELL -i -l -c` with a 5 s deadline (`installation/process/loginPath.ts`). Any outcome but success leaves the system PATH: a timeout, a profile `exit N` (an rc with `exec tmux`), or a single record with a literal `$` that voids the whole PATH as unusable. Restarting the server never heals it: the successor sees a non-system PATH and skips the read; only an app restart heals it. On the operator's fast M-series the profile answered in 3.1 s; Orca at the same 5 s caught breakage on loaded machines and raised the deadline to 10 ([[2afe23ec|Orca reading]]).
- The first answer with no Claude Code found makes `settle` in `providers/accounts/modes.ts` write the Anthropic account-mode choice file as the no-Claude-Code alternative. The error stays after the CLI is found.
- A CLI is looked up by name in a dozen places (listed below), each in its own way.

The device is taken from Orca, because its road is proven on many users' machines; its code is not copied. Where the spec leaves Orca, the reason stands next to it.

The friend was asked for the `[tagma] … the inherited PATH is kept` line from `~/.tagma/serve.log` and `type -a claude`: they show which of the failures was his. The spec fixes all of them.

## What the user gets

- Launch menus and account panels show CLIs installed in the usual places: version managers (nvm — any version, volta, asdf, fnm, mise, bun), Homebrew, vendor installers (`~/.local/bin`, `~/.claude/local`), global npm (`/usr/local/bin`), pnpm (`~/Library/pnpm`), yarn (`~/.yarn/bin`). A program from a place only the user's profile knows (`~/.cargo/bin`, a custom folder) shows once the profile is read.
- A CLI installed while Tagma is open appears after "Check again" — in the launch menu, in the accounts panel, and in `tagma thread types --refresh`. While the check runs, the button shows Tagma is looking; new rows arrive over the live channel.
- Next to "not found" stands a one-line reason: "not on PATH and not in install places", "the shell profile never answered in 10 s — looked without it", "`~/.local/bin/claude` found but `--version` exited with code 1". It shows what to fix, for the user or for us.
- While the profile still reads, Tagma says "looking", not "not found", and remembers nothing from that answer.
- A CLI from nvm launches on that version's node; CLIs already on PATH launch as before, with no PATH reranking.

## The device

Two owners, one fact each ([[51c66cb6]]).

### The user environment — `installation` ([[6cc306ce]])

The `UserEnvironment` service in `installation/contract/service`: where the user's programs live and what the server process PATH is. It alone writes `process.env.PATH` ([[51c66cb6]]): profile reading (`server.ts:185`) and `ensuredPath` (`server.ts:189`) become its parts.

- **GUI launch** — the launch PATH is system folders alone (desktop, launchd). Only then does the service extend the PATH: it reads the profile and adds version-manager folders and fallback folders. A server launched from a terminal or a test with an intentional PATH keeps that PATH as is, with one world folder first: as Orca does only in a packaged app.
- **The PATH is rebuilt from parts on every change**, never appended to in place: the Tagma world folder (`ensuredPath`) first; then profile folders in their order, when the profile is read; then version-manager folders; then the launch PATH; then fallback folders. Duplicates drop. So the world stays first after any read, and a folder the profile stopped naming leaves after refresh.
- **Version-manager folders** — the `bin` of the nvm version under the `default` alias (alias resolved with cycle guard), `~/.volta/bin`, `~/.asdf/shims`, the `bin` of fnm's `default` alias (on macOS `~/Library/Application Support/fnm`, formerly `~/.fnm`), `~/.local/share/mise/shims`, `~/.bun/bin` — stand before the launch PATH, as in Orca: otherwise a CLI on `#!/usr/bin/env node` never finds node before the profile is read. **Fallback folders** — `/opt/homebrew/bin`, `/opt/homebrew/sbin`, `/usr/local/bin`, `/usr/local/sbin`, nix, `~/.local/bin`, `~/bin`, `~/Library/pnpm`, `~/.yarn/bin` — last: `~/.local/bin` in front would shadow system programs with wrappers (Orca #18234). Only existing folders are taken.
- **Profile reading**: `$SHELL -i -l -c` prints the environment via `/usr/bin/env -0` after a marker — independent of shell syntax and already robust to profile output, including OSC iTerm2 sequences (`loginPath.itest.ts`). An unusable record (one with `$`, a relative one) drops singly, never with the whole PATH; a leading `~/` expands to HOME, as the dotnet installer writes it. The probe gets `TAGMA_SHELL_PATH_PROBE=1` and the launch PATH. The default deadline is 10 s — a service parameter; the shell process group dies on deadline.
- **Reading runs in the background**: the server door opens without waiting for it. The service gives `ready` — a wait for the current read, no longer than its deadline — and an outcome: `read`, `timeout`, `exit`, `spawn-failed`, `empty`, `no-shell`, `not-needed`. Only actions that need the program itself wait for `ready`: program resolution for launch and install (below), run recovery (`recoverRuns`), home integration (`homesIntegrated` → `installHomes`), plugin launch (`plugins.start`), and the `AccountCli.installed` answer for `settle`. All sit off the door-opening path. Inner row reading (`InstalledHarnesses.read`, which the kernel calls on every run open) never waits; the `list_thread_types` operation, which the menu calls on open, waits for `ready` (`InstalledHarnesses.settled`) — no longer than the read deadline and only in the first seconds after a GUI launch, so no live-channel event is needed. The outcome goes to `serve.log` in one line.
- **The successor** — and a build the predecessor raises again when the successor never reaches `Serving` — gets the launch PATH, the outcome, and the last good read's folders through succession. Its `ready` comes at once when that read succeeded; when it failed, it keeps the handed folders and rereads the profile ([[5f9b619e]]). The snapshot variable is set only in the environment succession builds for the successor (`succession.ts`) and dropped at startup, as `RESTART_ID` is (`server.ts`): otherwise terminals and agent commands would inherit it, and a server an agent launches from them would take the system snapshot for its own.
- **Program lookup by name**: `locate(name, dirs)` answers candidates in order — every executable match on the built PATH, then in the `bin` of every nvm version (newest first), then in the handed folders, with no realpath duplicates, at most 4. nvm versions are searched separately because only the default sits on PATH, and a Codex installed under another version would otherwise never be found.
- **Refresh**: reread the profile and rebuild the PATH; concurrent asks wait on one read.
- macOS variants — Homebrew folders and `~/Library`, profile reading through a login shell — live in their own macOS user-environment adapter, which fills the installation module's `UserEnvironment` contract and plugs in by composition, as the Mac app module does [[79a88a92]] ([[6f758080]]). Linux and Windows are their own adapters, out of scope.

### Where the CLI lives — `external-harnesses` ([[287a4906]])

The owner is `birth/installed.ts`, which already answers the `HarnessInstall` install row through the `InstalledHarnesses` port (`threads/contract/service/harness.ts`). No new tag: "where the program is" and the install row are one subject. The port gains `refresh`, and the row gains a path, a state, and a reason.

- **The vendor adapter declares** in `vendors/<vendor>/row.ts`, besides `binary`, its install folders `installedIn` (Claude's `~/.claude/local`, where `claude migrate-installer` puts it and calls it through an alias PATH never sees). No adapter has program-name aliases: a foreign program with a shared name (`agent` exists in both Cursor and Grok) would pass the `--version` check; an alias only appears with a vendor version mark.
- **The check**: `UserEnvironment.locate` candidates launch with `--version` one by one, in the same environment the CLI will launch with (the server PATH and the runtime pair). Exit code 0 and a non-empty first line mean it is the row's program. There is no vendor version mark: some CLIs print a bare number (Cursor `2026.10.01-…`, Gemini `0.37.1`), and a template broken by a new output shape would turn an installed CLI into "not found" — worse than accepting a foreign program of the same name. One that never launches or exits non-zero moves to the next candidate, and the reason accumulates. One that misses 5 s leaves the remaining candidates in a second shared 5 s budget, as in Orca: a hung shim of a deleted version never becomes the row's program when another answers. When nobody answered, the first one that never made it stays found with an unread version, as today (`unreadable`): a probe deadline on a loaded weak machine ([[fe83acfa]]) never turns an installed CLI into "not found".
- **The runtime pair**: a program found outside the server PATH (in an adapter folder) with a `node` next to it gets that folder first on the launch PATH. A program on PATH gets no pair: otherwise Gemini from Homebrew would lift `/opt/homebrew/bin` above pyenv and nvm for every agent command — Orca class #18234.
- **While the profile reads** (`UserPaths.reading`), a row with no found program answers `searching: true` with no wait; launch, install, and `list_thread_types` wait for `ready` and answer finally. `AccountCli.installed` never waits: the `ProviderRegistry` build calls it on the server-ready road, so it answers a `Found` | `Missing` state with a reason, or `Searching`, whose type `providers` declares ([[144dfedc]]), and the accounts panel shows the reason or "Looking for …".
- **The account-mode choice is never written under force**: `settle` in `providers/accounts/modes.ts` writes the section choice only when the preferred variant is available or the user already logged in through an available variant. Otherwise the choice is computed on every read: before, `section.selected` skipped an unavailable variant, and the first miss wrote the alternative down forever.
- **Memory**: each adapter's resolution lives until refresh or a PATH change; a found one — while the chosen file's stat (realpath, mtime, size) matches; concurrent asks wait on one resolution; a failed probe caches by file and the PATH it ran with — so a broken shim never launches `--version` on every run open, but after the profile arrives that gives it a runtime it is retried. A version switch behind an asdf, mise, or volta shim is only seen by refresh.
- **Changes**: `InstalledHarnesses.changes` (and with it `AccountCli.changes`) reports `ready` arrival and every refresh. On it `ProviderRegistry` rechecks account modes and publishes the catalog, so the open accounts panel refreshes and the server repeats home integration (`homesIntegrated`). `refresh` calls `UserEnvironment.refresh`, drops memory, and rechecks rows; the "Check again" button in the new-thread menu and `list_thread_types` with a `refresh` parameter call it (`tagma thread types --refresh`).

#### How the program reaches launch

The recorded argv, `session.argv`, and vendor-row argvs hold the bare program name: by it the session binding compares `session.argv[0]` with the adapter's `binary` (`observations/binding.ts`, `contract/service/table.ts` `harnessRoot`), and an absolute path in the record would leave the binding `unproven`. One place substitutes it: before launch it replaces argv[0] with the found path and adds the runtime pair to the environment. It takes over every place that today launches or looks up a CLI by name:

- the install row — `birth/installed.ts`;
- terminal launch — `sessions/launch.ts`, `protocol/launcher.ts`;
- one-shot headers and calls — `sessions/oneShot.ts` (`claude -p`);
- root preparation — `sessions/prepareRoot.ts` (`codex app-server`);
- metadata — `metadata/runtime.ts`, `vendors/devin/metadata.ts` (`devin list`, environment from saved storage);
- MCP — `installs/mcpDeclaration.ts`, both lookup and `cursor-agent mcp enable` on approval;
- hooks and skills — `installs/skillInstall.ts`;
- accounts — `accounts/cli.ts`: `installed`, `run`, and `login` (the `claude auth status`, `claude -p /usage`, `codex login` programs from provider adapters); `installed` answers a state and a reason, not a boolean, and the `adapter.binary === program` lookup goes through the row of the adapter with its aliases;
- review — `review/launch.ts`.

Callers outside the server process — `tagma review` (`review/launch.ts`), MCP declaration from the setup step and reconcile builds, Cursor MCP approval — launch from a terminal with the user's PATH and look the program up with the owner function `installedHere` (`birth/installed.ts`): their own process PATH and the adapter folders, through the same `locatedIn`, with no `--version` probe.

**The Claude ACP runner** is a separate process: argv[0] there is `tagma` (`vendors/claude/acp.ts`), and `claude` the runner looks up itself (`runner/claude/run.ts`). The launcher hands it the found path and the PATH with the pair through the launch environment; the runner hands the path to the Agent SDK as `pathToClaudeCodeExecutable` as found, not realpath: the SDK launches a path ending in `.js` through `bun` from PATH, and in the release there is none.

### Out of scope

- Muse (`muse`, launch `muse --trust-workspace`) and Antigravity (`agy`) adapters — a separate spec. Their rows here are only `binary`, folders, and the version mark in `row.ts`.
- Linux, Windows, WSL, and a harness in a sandbox: the path resolves for the host target, which is every harness launch today; a sandbox would have to resolve the program in its own environment.
- An account mode `settle` already wrote on the friend's machine is never fixed by a correction: the friend picks Claude Code in the accounts panel once.

## Proven by the implementer

- `UserEnvironment` integration tests (`installation`), with the read deadline as a parameter, in fractions of a second ([[adb6798b]]):
  - a profile sleeping past the deadline gives `timeout`; before and after it the built PATH starts with the world folder, then version managers, then the launch PATH, then fallback;
  - a profile with a banner, ANSI, and one `$` record gives its own folders first, without the unusable record;
  - while the read runs, `ready` never came, yet the service already answers; a refresh after a profile switch drops the departed folder;
  - a launch PATH with a non-system folder is `not-needed`: the profile never launches, and version-manager and fallback folders are never added;
  - a successor with handed snapshot and folders answers `ready` at once and never launches the profile; the snapshot variable is dropped from the server environment, so a process it launches never inherits it;
  - a record with a leading `~/` expands to HOME.
- `InstalledHarnesses` integration tests (`external-harnesses`) on a temporary HOME with fixture scripts:
  - `claude` only in `~/.local/bin`, `codex` on `#!/usr/bin/env node` only in the nvm version under the `default` alias next to `node`, `claude` only in `~/.claude/local` — all found at a system launch PATH and a broken profile;
  - `codex` only under a non-default nvm version is found and launches with its version's `node` first on PATH;
  - a dead shim first on PATH is skipped, and the reason names it; on reread it never launches again;
  - a hung first candidate yields to an answering second; when nobody answered, the program stays found with an unread version;
  - a program placed after the first read appears after `refresh`; before `ready` the listing answers `searching` with no wait;
  - `settle` writes nothing while the preferred mode is unavailable, and writes it once the CLI is found;
  - a CLI found in an adapter folder reaches `Terminals.start` (a double under a tag) as an absolute program with a runtime pair, while the recorded `session.argv` holds the bare name.
- A system test (`*.stest.ts`) is not written: the server from the checkout in its own world, HOME temporary with the same fixtures, PATH system folders alone, SHELL a profile that never answers; `tagma thread types` shows claude and codex, and a Claude session launch over ACP gets the path into the runner. A 60 s release-build layer ([[99b9fa72]]) never fits this.
- The implementer's manual check on this machine, with no server: `UserEnvironment` and `InstalledHarnesses` in one process with the real HOME for reads only, `PATH=/usr/bin:/bin:/usr/sbin:/sbin` and `SHELL=/usr/bin/false` find claude, grok, devin, and cursor-agent in `~/.local/bin`, codex in nvm, and gemini in Homebrew. A separate server with the real HOME never starts: the operator's running server holds `active.lock`, and it is never touched.

## Checked by the operator

- On a MacBook Air and the friend's machine, a fresh notarized build sees Claude Code and Codex right after launching from Applications.
- A CLI installed while Tagma is open appears after "Check again".
