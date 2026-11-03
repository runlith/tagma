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
---
## Outcome

A person who already uses Claude Code or Codex opens Tagma for the first time and types a prompt. There is no "Connect a model" card, no wizard and no sign-in step: a model is already chosen in the composer and the first send runs. Tagma finds the existing login itself, prefers Claude Code over Codex, and follows that login when it appears, changes or leaves while Tagma is open. The first minutes with the product decide whether it is kept, so this path outranks every feature built on top of it.

| On the machine | New-thread screen | Composer model | Providers row |
|---|---|---|---|
| Claude Code signed in with a Claude subscription | no connect card | Claude Code's provider default | Claude: connected, the login's label and place |
| Codex signed in with ChatGPT in `auth.json`, no usable Claude Code login | no connect card | the ChatGPT subscription's provider default | Codex: connected |
| Both | no connect card | Claude Code's provider default; ChatGPT models in the picker | both connected |
| Codex signed in with its login in the system keychain | ChatGPT row: "Codex keeps its login in the system keychain, which Tagma does not read", Sign in with ChatGPT | — (Codex CLI threads still run) | Codex: connected for CLI threads, the reason for Tagma's agent |
| A CLI installed, signed out | connect card: Sign in on that row | — | not connected, Sign in |
| Nothing installed | connect card: Install on Claude, browser sign-in on ChatGPT | — | not installed |
| Claude Code's stored login is a Console account, Bedrock or Vertex | Claude row names the method the CLI reports, Sign in with a subscription | — | the same reason |

**A sign-out never switches anything.** Logins can be lost without the person's intent, for example when another tool rewrites tokens, and moving work onto another account or subscription silently would bill one the person did not choose. So a lost login never changes a provider's default account, a saved model, an open draft or a born thread. The composer and the Providers row name the signed-out account with "Sign in again". The person may pick another account or model; Tagma does not.

Until the first send, the composer's model is the fallback: the first provider in ladder order with a usable signed account. The first send keeps that model as the person's default, so from then on nothing moves it.

A new thread on a signed-out default account is stopped before the send, with the notice and its two acts in the composer. Today it reaches launch and is refused (`HarnessAccountBook.launch` answers `unknown-account`, or `account-required` when no default is set and several accounts are signed in).

## Why it fails now

- For a fresh, untouched default login, nothing passive ever asks the CLI. `DefaultLoginBook.listed` returns nothing without a `requested` row (`providers/accounts/defaultLogins.ts`). So startup, `read_model_defaults` (`connectedModel`, `native-harness/models/preference.ts`) and the Providers list never run `claude auth status` or `codex login status`, the composer answers `unconnected`, and a restart changes nothing.
- Sign in calls `begin` with no account, which makes a new Tagma directory (`<data>/claude/<uuid>`) and runs `claude auth login` under its own `CLAUDE_CONFIG_DIR` (`providers/accounts/harnessAccounts.ts`). That is a second login in a second Keychain item, never the one the person's terminal holds. The card's hint "Uses the logins of Claude Code on this machine" promises what the button does not do.
- With no saved model, sending is refused `no-model-connected` (`preference.ts` birth selection). The addressed paths already find the default login: a Claude Code launch (`HarnessAccountBook.launch` → `DefaultLoginBook.current`) and the first native ChatGPT request, whose model-time token store discovers the default `~/.codex` login (`credentials/borrowed.ts`, `borrowedRows` with `renew`). The defect is the passive side only: the composer never gets a model to send with.

Today the provider order already puts Claude first. Contributor order is Anthropic before OpenAI (`composition/adapters.ts`), with keys after subscriptions (`pickerOrder`). Claude's Tagma agent runs on `claude-code` through its hosted ACP profile; the ChatGPT one runs on `openai-oauth`, whose `accountSource` is `codex` in CLI mode.

## Design

**The adapter declares discovery; the core stays variant-free.** `HarnessAccountAuth` (`packages/tagma/src/adapter/provider.ts`) gains an optional discovery declaration with two parts:
- the environment variable naming the CLI's account place: `CLAUDE_CONFIG_DIR`, `CODEX_HOME`;
- the login files the CLI writes when it signs in or out, relative to that place: Claude Code's `.claude.json`, Codex's `auth.json`.

Exact paths are verified against the shipped CLIs at implementation. No other adapter declares it yet, so Cursor, OpenCode, Gemini, Grok, Devin and Muse keep today's behaviour: nothing of theirs runs before the provider is selected. How they join is the ladder below.

**Typed status.** `loggedIn` answers one of four outcomes instead of identity, null or a message:
- signed in with the subscription, with its label;
- signed out;
- signed in with an unsupported method, naming the method the CLI reports;
- unreadable, with the reason.

The status is read under the same environment the run gets, with keys cleared (`claudeEnvironment`), because the question is what Tagma would run on. A terminal that relies on an exported `ANTHROPIC_API_KEY` therefore reads as signed out for Tagma. An unreadable answer keeps the previous observation and marks the row with the reason, as now.

**Observation is not selection.** `DefaultLoginBook` stays the only reader of the default login, and the CLI stays the authority: file contents are never parsed for the verdict. For a declaring adapter it observes without a prior selection, and only a signed-in answer writes `requested`, so a signed-out or unreadable probe does not unlock catalogs and the rest. The passive status command runs the executable located without a process (`InstalledHarnesses` locate). It never goes through `program()`, whose candidate `--version` probe would add a spawn before any answer. Observation runs:
- **at server start**, without waiting for the login-profile read. The server builds `PATH` at once from the version managers, the launch `PATH` and the macOS fallback list (`installation/process/userEnvironment.ts` `build`), which holds the usual install places. A CLI located there is observed immediately. Only a CLI not found there waits for the profile read, which can take up to its 10 s deadline, and is located again after it. One status process runs per installed declaring CLI, in parallel. Measured here, one sample: Claude ≈0.5 s, Codex ≈0.1 s. That is no bound for a weak machine; the status command's own deadline is. The driver is wired in the same change;
- **on a login-file event**, signed in or not. The owner watches the declared files by their directory, including paths that do not exist yet. One read is in flight at a time, and a burst coalesces to one read of the latest state. Claude Code writes `.claude.json` on session start and exit and on login changes. Measured here, one sample: no write in 40 s with 28 `claude` processes running. So the watch costs a status process per real change, not per message;
- **on window focus**, for a declaring CLI not known signed in: re-locate (stats) and one status read. This also covers a Codex keyring login, which writes no file;
- **on an explicit act** — Sign in, a Providers refresh, a launch — as now.

A changed answer publishes through the path a sign-in uses (`AccountQuota.refresh` → `accounts.subscribe`). The app already rereads `read_model_defaults` on that frame (`ModelDefaults`), and the scheduled 15-minute refresh is not relied on. Rows persist in `harness-accounts.json`, so a later start shows the last answer at once and confirms it in the background.

**Readiness is one fact.** From owner construction, discovery holds a readiness fact. It settles when the highest-ranked installed declaring CLI answers signed in, or when every installed declaring CLI has answered, whatever the outcome. A CLI missing from the immediate `PATH` is ready once the profile read settles and it is still missing. A timed-out one is ready as unreadable. Discovery starts with the server, in parallel with the window loading, so on an ordinary start the answer is in before the app asks. The pending slot covers only a slower start; it is not meant to be seen. `read_model_defaults` and the birth selector both call `connectedModel` and both await it, so no early call answers `unconnected` or refuses `no-model-connected` while a login may still be found. A persisted signed row is ready at once; an unsigned or unreadable one waits for its fresh answer. Until readiness, the composer keeps its shape with a pending model slot ("Looking for Claude Code…") in `BirthSettings` / `ModelPicker`, and the connect card stays hidden as it already is while defaults are unknown.

**The fallback needs a usable account.** `connectedModel` accepts a provider only through an account whose `problem` is null, for wire providers too; `held.length > 0` today lets an unreadable borrowed row hide the card and fail the first send. Existing mode choices stay authoritative (`modes.ts`): a saved mode or owned Tagma logins win over the CLI mode. "Default model" means the provider's declared default, not the model the person configured in the CLI.

**Login places keep their exact address.** The null default stays the unset address ([[c8041df5]]). When the login profile exports a declared variable, discovery observes that place as its own explicit directory account, spelled exactly as the profile gives it. Status, login, launch, catalog, renewal, native borrowing and the watch then all use that row's directory like any directory account. A later profile change adds a row and never retargets an old one. This needs the profile read (`mac-user-environment/shell.ts`, `installation/contract/service/userEnvironment.ts`), which today keeps only `PATH`, to carry the variables adapters declare and hand them to the successor, and `readCodexAccount` to read the row's directory instead of a hard-coded `~/.codex`.

**Codex credential stores.** Codex may keep its login in `auth.json` or in the system keychain (`cli_auth_credentials_store`: file, keyring, auto). `codex login status` is the authority for "signed in", which is enough for Codex CLI threads. Tagma's own ChatGPT path needs a credential it can read, so a keyring login leaves that path not connected with the reason above. Tagma never reads the keychain and never exports the grant into a file. In `auto` Codex prefers the keychain and can leave a stale `auth.json` beside it, so a readable file alone does not prove it is the login Codex uses. Codex has no side-effect-free way to name its effective account: in v0.164 `codex app-server` opens its state database and refreshes the model catalog at start. So the native path borrows a readable `auth.json` when `codex login status` reports ChatGPT, and a missing file leaves it not connected with the reason. The known limit: a stale file that survived a failed cleanup beside a keychain login can name another account. Renewal no longer forces file storage, so a 401 on an unchanged file asks for a new sign-in and never moves a keychain grant into a file.

**Sign in, by case.** `begin_sign_in` gains an `adopted` answer (provider, account, label) that `SignInFlow` shows as signed, with no pending state, poll or terminal. A project is required only when a terminal is opened.

| Case | Sign in does |
|---|---|
| No signed account and no pending attempt for the provider | reads the default login; signed → `adopted`; signed out → the CLI login in the default place, so Tagma and the terminal share one login |
| Stored login of an unsupported method | the CLI login in a new Tagma directory; the person's place stays untouched |
| Reconnect of a named account | that account's own directory, as now |
| Add account, with a signed account present | a new Tagma directory, as now |

`Group` decides "connected" and offers "Add account" by signed rows; a discovered unsigned row counts as neither.

**Probe hygiene.** Status runs with stdin closed, outside a terminal, in Tagma's scratch directory rather than `$HOME`, where cwd-scoped wrappers refuse to run. It carries the profile variables version managers need beside `PATH`, such as mise's `__MISE_DIFF`. A locate that misses names its cause on the card, including a login profile that could not be read and its outcome; a silent fallback to the system `PATH` would read as "not installed".

**Words.** The Claude card says what happens: "Uses your Claude Code sign-in on this Mac". A connected row shows the label and, dimmed beside it, the place: "Claude Code default" for the unset address, the exact directory for an explicit one. Final copy is settled under the design skill.

## Scope now, and how more CLIs join

This change ships discovery for Claude Code and Codex only. It is built so that a later CLI joins by its own adapter change alone, with nothing of the core rewritten. Behaviour is decided by a ladder, not by a list of names:

1. **Entry condition.** A CLI declares discovery only after its status command is proven cheap and free of side effects on the shipped version: no writes, no network sign-in, no prompt, no update check. The declaration itself is the place variable, the login files and the typed status. This is what was wrong with the CLIs Tagma used to start unasked.
2. **One order is the ladder.** The priority is the order of providers the catalog already keeps: contributor order in `composition/adapters.ts`, with subscriptions before keys. The composer default is the first provider in that order with a usable signed account. Adding an adapter means placing it in that order; nothing else ranks providers.
3. **The card is built from what is found, in ladder order.** A found, signed-out CLI comes first with Sign in, then the top plans. A CLI whose login Tagma's own agent cannot run on (today Grok, Gemini, Devin: no accounts or hosted runner in the core) is offered as a CLI thread, never as the composer default. Claude Code and Codex use only the first two of these places now; the rule is written so the rest fill in.
4. **Cost stays bounded as the list grows.** At start, discovery observes installed declaring CLIs in ladder order with a small fixed concurrency. Readiness settles as soon as the highest-ranked installed CLI answers signed in, because nothing below it can change the default; otherwise it settles when all have answered. Uninstalled CLIs cost a stat. Each watch is one directory with no process. With fifteen adapters, start cost is processes for the installed ones only, a few at a time, and the composer waits only for the first that answers signed in.

## Limits

- A login revoked at the vendor with no local change is found when the CLI refuses the first turn, through the existing "Sign in again" path.

## Owners touched

- Public adapter contract: `packages/tagma/src/adapter/provider.ts`, for the discovery declaration and typed status.
- Built-in Anthropic and OpenAI adapters: `accounts.ts`, the harness declarations, and `oauth/cli/codex.ts`, which reads the row's directory.
- macOS user environment and installation: the profile read carries the declared variables.
- Model provider accounts:
  - `accounts/defaultLogins.ts`: observation versus selection, the start, watch and focus drivers, readiness, publication. The focus driver is an operator-only operation (`observe_logins`) the app calls when the window gains focus;
  - `accounts/harnessAccounts.ts` and `harnessSignIns.ts`: the sign-in cases;
  - `contract/wire/signIns.ts` and `operations.ts`: the `adopted` answer;
  - `external-harnesses/accounts/cli.ts`: running the located executable without a version probe.
- Native harness default selection, `native-harness/models/preference.ts`: readiness, the usable-account rule, keeping the first sent model, and a typed refusal (`account-signed-out`, naming provider and account) when a birth falls on a signed-out account. That refusal is the backstop behind the composer's own stop.
- App:
  - `ModelDefaults`, `birth/BirthSettings`, `native/ModelPicker`: the pending slot;
  - the composer's signed-out notice with "Sign in again" and "Choose another account";
  - `providers/SignInFlow`, `AccountsRepo`, `Group`, `birth/ConnectCard`: the cases and words;
  - the focus signal.
- The change corrects every explanation and feature that describes the passive restriction or the address: [[3b360b13]], [[1cfa3cd9]] (including its stale "its own rows win" claim), [[46e7ebcd]], [[38ce4f43]], [[c8041df5]], [[6fa09803]], [[42804f17]] and [[948797f4]].

## Acceptance

Performer checks. They run in an isolated runtime with the production owners and drivers and controlled `claude`/`codex` executables standing where real ones do. The shared door fixture would mask the precondition: it fills `AccountCli` without processes and preselects modes and a model (`composition/testing/doorFixture.ts`, `chosenModel.ts`). No preselection helper is used. Process counts are asserted from the fixture executables' own starts.

1. **Claude only, fresh.** With the fixture's status held, the composer shows the pending slot and an early `read_model_defaults` and birth wait. On release, `read_model_defaults` answers `read` on `claude-code` with no prior act, and a first send through the app's create and send doors completes on the default login. Red on the current code. Restart: `read` at once with no new selection.
2. **Both, then sign-out.** Claude Code is chosen, and a first send keeps it as the default. The fixture then signs the default login out by rewriting its login file while a draft is open. The feed frame marks the account signed out, the draft keeps Claude Code and its account, and the composer shows "Sign in again" before any send. With another signed Claude account present, nothing switches to it either. After the fixture signs in again, the send completes with no refresh. The provider default account, the saved model and born threads are unchanged throughout.
3. **Codex stores.** With a file-held login, a first send on `openai-oauth` completes. With a keyring-held login (no `auth.json`), the native path stays not connected with the reason, the card shows, and a Codex CLI thread still launches.
4. **Sign in cases.** A signed default answers `adopted` with no terminal and no project. A signed-out default opens the login with the default-place environment. Reconnect keeps its directory, and Add account makes a new one. An unsupported-method login makes a Tagma directory and leaves the original place byte-identical. Existing directory accounts and a saved default survive every case.
5. **Profile places.** A profile exporting `CLAUDE_CONFIG_DIR` / `CODEX_HOME` yields an explicit directory row with that exact spelling, and Claude launch and Codex native borrowing both use it. With the variable unset, the null row. A failed profile read is named and does not erase an earlier answer.
6. **Cost.** Server start runs exactly one status process per installed declaring CLI and no `--version` probe for it. A burst of login-file writes runs at most two status processes. A focus with everything signed runs none. An undeclared CLI fixture runs nothing passively (`providers/passiveCli.itest.ts` stays green).
7. **Install after start.** A fixture binary appearing in an install place is found on the next focus, then observed.
8. **The screen.** An e2e of the new-thread screen under testbed shows the pending slot, then the model with no `[data-connect-model]` for a signed fixture, and the card when nothing is signed in.
