---
id: 01a13bf9-11e2-786b-95e8-fc902afe23ec
title: "Orca: how the GUI app finds agent CLIs — shell-profile PATH in the background within 10 s, fallback folders last, install-location search, --version check, node alongside — read 2026-10-14"
ord: 1
tags: ["research"]
fields:
  {
    "source": {
      "name": "stablyai/orca, checkout /opt/workspaces/runlith/.external/orca; commit 0df25b7ac9 (2026-10-11), read 2026-10-14",
      "ref": "https://github.com/stablyai/orca/tree/0df25b7ac9b4c068f10b46715fdd823ad135a58c"
    }
  }
---
How Orca finds agent CLIs when launched from Dock or Finder, where the process PATH holds only system folders. Read 2026-10-14 in `.external/orca` (stablyai/orca, commit 0df25b7ac9 from 2026-10-11). This is a reading of code and its comments: nothing was launched, and Orca's measurements come from its own comments and are not repeated here.

## Observations

- **The shell profile is read once, in the background** (`src/main/startup/hydrate-shell-path.ts`). `$SHELL -ilc` prints `$PATH` between two `__ORCA_SHELL_PATH__` separators; before parsing, the output is cleaned of ANSI, so banners and a colored profile prompt never break it (`shell-path-probe.ts`). The result is cached for the process lifetime as a promise; on POSIX only the agent search awaits it, the app launch never waits on it.
- **Deadline: 10 s.** The comment explains 5 s was picked with no measurement: bash with nvm, rvm, conda, and gcloud takes about 1 s on a free machine and 6–7 s on a loaded one, and a cold start silently ended up with no user PATH. Past the deadline the shell is killed, and the answer names the cause (`timeout`, `spawn_error`, `empty_path`, `no_shell`) — Orca sends it to telemetry.
- **The profile knows it is being read.** The child gets `ORCA_SHELL_PATH_PROBE=1` so a heavy rc file can skip the extras. The profile receives the PATH as it was at launch, without Orca-added folders: otherwise `nvm use` would pin a planted node version.
- **Fallback folders go last** (`patchPackagedProcessPath` in `src/main/startup/configure-process.ts`): `/opt/homebrew/bin`, `/opt/homebrew/sbin`, `/usr/local/bin`, `/usr/local/sbin`, nix, `~/bin`, `~/.local/bin`, `~/.nix-profile/bin`, individual `~/.<vendor>/bin`. Only version-manager shims go first (volta, asdf, mise, bun, nvm default) — otherwise an nvm user gets a foreign runtime. `~/.local/bin` and `~/bin` never go first: in issue #18234 a `~/.local/bin/gh` wrapper around `mise x gh` shadowed the real `/usr/bin/gh`.
- **Profile folders go first** (`mergePathSegments`): the user order is kept, duplicates removed, fallback folders stay after them.
- **When the program is not on PATH, install locations are searched** (`src/shared/node-cli-command-resolution.ts`, `system-cli-install-dirs.ts`): nvm versions — first the `default` alias (with alias-cycle protection), then newest to oldest; volta, asdf, fnm, mise, `~/.local/bin`, `~/Library/pnpm`, `~/.yarn/bin`, `~/.bun/bin`; then Homebrew, `/usr/local/bin`, nix. Only an executable file fits (`X_OK`), not a directory or a stub.
- **The found copy is verified and pinned** (`findRunnableLocalCommand` in `src/main/ipc/preflight-command-exec.ts`): candidates run with `--version` under a shared deadline, the first to answer becomes `binary`, and exactly it is used afterwards. Otherwise a dead shim earlier on PATH kept being picked (issue #22975).
- **Runtime paired with the program** (`withCliRuntimeOnPath`): when the CLI is found in a directory with `node` beside it, that directory goes first on the launched child's PATH. Otherwise a CLI from `~/.nvm/.../v20/bin` with `#!/usr/bin/env node` started on the PATH's v22 and crashed on a native module (issue #10932).
- **Re-check without restart.** The "Refresh" button in agent settings re-reads the profile with `force` and searches agents again, so a CLI installed after Orca launched is visible immediately.
- **The agent catalog** (`src/shared/tui-agent-config.ts`) knows every command: `claude`, `codex`, `gemini`, `agy` (Antigravity), `grok`, `muse` (launched as `muse --trust-workspace`), `cursor-agent`, and dozens more, with aliases where a vendor has several names.

## What this does not establish

- The 1 s and 6–7 s figures come from an Orca comment, not a measurement. A measurement on the operator's machine on 2026-10-14: a login shell on M-series answered in 3.1 s of Tagma's 5 s budget.
- Orca lists no dedicated installer folders for Grok, Muse, and Antigravity: on the operator's machine all three put the command in `~/.local/bin` (grok as a symlink to `~/.grok/bin/grok`), Gemini in Homebrew, Codex in nvm.
- How nvm behaves when the `default` alias points at a deleted version is visible from code only; no probe was run.
