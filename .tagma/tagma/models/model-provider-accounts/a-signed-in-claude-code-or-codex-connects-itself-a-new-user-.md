---
id: 01a1a269-e94d-72aa-a381-ba8c0f512781
title: "A signed-in Claude Code or Codex connects itself: a new user types the first prompt with no sign-in step"
ord: 34
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bef6fa09803
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bf142804f17
  - kind: relates
    to: 01a164d4-4b95-7103-9928-d27241797cec
---
## Outcome

A person who already uses Claude Code or Codex opens Tagma for the first time and types a prompt. No "Connect a model" card, no wizard, no sign-in step: a model is already chosen in the composer and the first send runs. Tagma finds the existing login itself, prefers Claude Code over Codex, and follows that login when it appears, changes or leaves while Tagma is open. The first seconds with the product decide whether it is kept, so this path outranks every feature built on top of it.

| On the machine | New-thread screen | Composer model | Providers row |
|---|---|---|---|
| Claude Code signed in with a Claude subscription | no connect card | Claude Code's default model | Claude: connected, the login's label, its place |
| Codex signed in with ChatGPT, no usable Claude Code login | no connect card | the ChatGPT subscription's default model | Codex: connected |
| Both | no connect card | Claude Code's default model; Codex models in the picker | both connected |
| A CLI installed, signed out | connect card: Sign in on that row | — | not connected, Sign in |
| Nothing installed | connect card: Install on Claude, browser sign-in on ChatGPT | — | not installed |
| Claude Code signed in with an API key, Bedrock or Vertex | connect card names it: "Claude Code uses an API key here; Tagma runs it on a Claude subscription", Sign in with a subscription | — | the same reason on the row |

The default stays unsaved until the person picks a model: it keeps following what is connected, so a Claude Code sign-out falls through to a signed-in Codex instead of a refusal.

## Why it fails now

- The code keeps rule [[41797cec]] as it stood before this spec: no provider CLI starts before the provider is selected. Startup, `read_model_defaults` (`connectedModel` in `native-harness/models/preference.ts`) and the Providers list therefore never run `claude auth status` or `codex login status`: `DefaultLoginBook.listed` returns nothing without a `requested` row (`providers/accounts/defaultLogins.ts`), the composer answers `unconnected`, and a restart changes nothing.
- The one act left, Sign in, calls `begin` with no account, which makes a new Tagma directory (`<data>/claude/<uuid>`) and runs `claude auth login` under its own `CLAUDE_CONFIG_DIR` (`providers/accounts/harnessAccounts.ts`): a second login in a second Keychain item, never the one the person's terminal already holds. The card's hint "Uses the logins of Claude Code on this machine" promises what the button does not do.
- Sending from the composer is refused `no-model-connected` (`preference.ts`), so the existing login is read only once a thread on a Claude Code model is launched some other way; that launch path (`HarnessAccountBook.launch` reading `DefaultLoginBook.current`) already works and stays as it is.

The rule came from Tagma starting CLIs nobody chose — `--version` on every installed harness, `cursor-agent mcp enable` at server start. That stays forbidden for every other CLI. Claude Code and Codex are the subscriptions a new user most likely already has; finding their login is the onboarding itself.

## Design

**The adapter declares discovery; the core stays variant-free.** `HarnessAccountAuth` (`packages/tagma/src/adapter/provider.ts`) gains an optional discovery declaration: the login files the CLI writes when it signs in or out, relative to its account place. Claude Code declares `.claude.json` (its `oauthAccount`), Codex declares `auth.json` under `CODEX_HOME`. Exact paths under a set `CLAUDE_CONFIG_DIR` are verified against the shipped CLI at implementation. No other adapter declares it, so Cursor, OpenCode, Gemini, Grok, Devin and Muse keep the selection rule unchanged.

**One owner reads the login.** `DefaultLoginBook` stays the only reader of the default login and the CLI stays the authority: `auth.status` answers, and file contents are never parsed for the verdict, since they are private formats. For a declaring adapter, the passive read counts as selection:
- **at server start**, once the user environment is ready, one status run per installed declaring CLI, in parallel. Measured here, one sample: Claude ≈0.5 s, Codex ≈0.1 s. The driver is wired in the same change. Rows persist in `harness-accounts.json`, so every later start shows the last answer at once and confirms it in the background;
- **on a login-file event** while the login is not known signed in: the owner watches the declared files, including paths that do not exist yet, by their directory, and runs one status read per event with at most one in flight. While signed in it does not react to that file, because Claude Code rewrites `.claude.json` constantly during terminal use. A sign-out then arrives as it does now: through list freshness (`LISTED_MS`) and the launch path;
- **on an explicit act**: Sign in, a Providers refresh, a CLI-thread launch — as now.

A changed answer publishes through the same path a sign-in uses (`AccountQuota.refresh` → `accounts.subscribe`). The app already rereads `read_model_defaults` on that frame (`ModelDefaults`), so the card disappears and the composer gains its model with no client code.

**No flash of the card.** On a first start, `read_model_defaults` answers `unconnected` only after the discovery reads of installed declaring CLIs have answered; it awaits the in-flight read, which is a fact with the status command's own deadline. Until then the new-thread screen shows the composer with a neutral model slot ("Looking for Claude Code…"), never the card.

**Install is found without a process.** Locating stays a stat over the login-profile `PATH`, version-manager directories and the adapter's install places (`InstalledHarnesses`). Claude Code adds its native installer's destination `~/.local/bin` (measured here: `~/.local/bin/claude` → `~/.local/share/claude/versions/2.1.317`) next to `~/.claude/local`; Codex declares the destinations of its own installers. A new location is looked for when the Tagma window gains focus, when the Tagma terminal that ran Install ends, and on a login-file event — the person has to come back to the window to see it anyway. A miss names its cause on the card: the login profile could not be read, and with what outcome. A silent fallback to the system `PATH` would read as "not installed".

**The default place is the person's own.** The default login's address is what the person's login environment gives the CLI: `CLAUDE_CONFIG_DIR` / `CODEX_HOME` from the login profile when it sets them, otherwise unset. Unsetting a variable the person's shell sets reads another Keychain namespace than their terminal, which is the same symptom as this bug.

**Sign in uses the default place first.** With no signed account for the provider, Sign in:
1. reads the default login. When it is signed in, it is adopted at once with no terminal, and the card shows "Signed in as …";
2. otherwise runs `claude auth login` / `codex login` in the default place, so Tagma and the person's terminal share one login.

"Add account" on Providers, with a signed account already present, keeps making a Tagma directory. So does Sign in over a non-subscription Claude Code login, so the person's API-key or cloud setup in the terminal is left alone. Codex without its CLI keeps Tagma's own browser sign-in ("ChatGPT" card).

**Probe hygiene.** Status reads run with stdin closed, outside a terminal, in Tagma's own scratch directory (not `$HOME`, where cwd-scoped wrappers refuse to run), and with the profile variables version managers need beside `PATH` (for example mise's `__MISE_DIFF`). A read that times out keeps the previous answer and marks the row `unreadable` with the reason, as now.

**Words.** The Claude card says what happens: "Uses your Claude Code sign-in on this Mac". A connected row names the label and the place ("Claude Code login · ~/.claude"). Copy is settled in the app change, under the design skill.

## Owners touched

- `packages/tagma/src/adapter/provider.ts` — the discovery declaration.
- `packages/adapter-anthropic` (`accounts.ts`, `harness/claudeCode.ts` `installedIn`), `packages/adapter-openai` (`accounts.ts`, `harness/codex.ts`) — their declarations.
- `apps/tagma/server/src/providers/accounts` — `defaultLogins.ts` (passive read, start and watch drivers, publication), `harnessAccounts.ts` (`begin` adopts or signs into the default place).
- `apps/tagma/server/src/native-harness/models/preference.ts` — waits on in-flight discovery before `unconnected`.
- `apps/tagma/server/src/external-harnesses/birth/installed.ts` and the app focus signal — re-locating.
- `apps/tagma/app/src/lib/features/threads/birth/ConnectCard.svelte`, `providers/Group.svelte` — states and words.
- Rule [[41797cec]] already carries the Claude Code and Codex exemption. The change corrects the explanations and features that still describe the passive rule: [[3b360b13]], [[1cfa3cd9]], [[46e7ebcd]], [[38ce4f43]], [[6fa09803]] and [[42804f17]].

## Acceptance

Performer checks, each through the door the app calls, on a fresh data directory, with CLI fixtures standing where the real ones do:
1. Claude Code fixture signed in with a subscription, nothing else: `read_model_defaults` answers `read` on the Claude Code provider with no prior sign-in, catalog or launch act. Red on the current code.
2. Both fixtures signed in → Claude Code. Only Codex signed in → the ChatGPT subscription provider. Neither → `unconnected` with both plans.
3. A first-start `read_model_defaults` issued while discovery runs answers `read`, never `unconnected` first.
4. A fixture that writes its login file after start: the `accounts.subscribe` frame changes and `read_model_defaults` answers `read`, with no other call between.
5. While signed in, rewriting `.claude.json` repeatedly starts no status process.
6. Server start runs at most one status process per installed declaring CLI. An undeclared CLI fixture (OpenCode-like) still runs nothing passively (`providers/passiveCli.itest.ts` stays green).
7. Sign in with a signed default login starts no login terminal and adopts the login. With a signed-out one, it starts the login with the default-place environment (`CLAUDE_CONFIG_DIR` unset, or the profile's value).
8. A non-subscription Claude Code status: no adoption, the reason on the row, and Sign in makes a Tagma directory.
9. An e2e of the new-thread screen under testbed: with a signed fixture, no `[data-connect-model]` and the composer shows the model; with none, the card shows.
