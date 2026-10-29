---
id: 01a12c24-69a2-7f74-a6cf-a29052b10a62
title: "A model provider is an adapter package behind one contract: built-ins and custom providers in one registry"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/providers
  - kind: file
    ref: packages/llm/src/models/description.ts
  - kind: file
    ref: packages/llm/src/profiles/contract.ts
---
A model provider in Tagma is a package adapter behind one contract.

## What the user gets

- **One's own provider without code.** In settings, "Add provider": an OpenAI-compatible address (Ollama, LM Studio, vLLM, OpenRouter, any compatible API), a key when needed, and models with their context windows. Models appear in the menu next to the rest.
- **One's own provider with code.** An adapter installs from npm, GitHub or a local path with one command or button; anyone can write one against the published contract.
- **Sign-in and accounts work the same for every provider.** The Providers screen shows registry providers, their accounts, the default account and quotas; what a provider can do — several accounts, quota, sign-in kinds — its adapter declares.
- **A broken adapter is visible instead of taking Tagma down.** An adapter that failed to load or erred in its declaration stands in the list with a reason; the remaining providers keep working. A thread bound to a removed provider opens and says "provider not installed", its history and account sign-in intact; once the adapter is back, the thread continues with the same account.
- **Claude on subscription in a public install goes through the real `claude`.** The `claude` CLI itself signs in, one per account, shared by chat and terminal; see "Claude sign-in and accounts".

## What exists now

From the code map (thread [[01a12c02-c8b6-71f0-b21e-30b7e2816bec|adapters-critic]], 2026-10-11):

- The contract almost exists: `ProviderDescription` (`packages/llm/src/models/description.ts`) and `ProviderRegistration` (`profiles/contract.ts`) — models, request profile, quotas. `ProviderID` is a string, not a union.
- Providers are enumerated by hand: in llm — `models/vendors.ts` → `models/catalog.ts` (`SHIPPED`, `OAuthProviderId`), `profiles/index.ts` `VENDORS`, `oauth/shipped.ts`, a switch in `oauth/accountKey.ts`, `FileTokenStore.importedSourceMatches`, `oauth/credentialDocument.ts`; on the server — `providers/contract/wire/catalog.ts` `MODEL_CATALOG` and `MODEL_KEY_PROVIDERS`, `Schema.Literals` in wire accounts, signIns and settings, `REFRESHERS`, `isLoopback`, a switch in `cli/signIn.ts`, `DEFAULT_MODEL` in `native-harness/models/preference.ts`; in the client the catalog and icons are compiled in.

## Design

### Adapter contract

An adapter runs inside the server process, like OpenCode providers: OpenCode installs the provider package (`Npm.add`) and imports it into the main process (`.external/opencode/packages/opencode/src/provider/provider.ts`, snapshot 2026-09-17). No separate process or worker is built for it: a data boundary would require rebuilding the whole synchronous profile contract, and nobody has yet seen the problem it would protect against.

**The contract is the list of modules the host gives.** The server registers a `Bun.plugin` that serves `effect`, its permitted subpaths and the `@runlith/llm` modules in the contract as virtual modules from its own copy. An adapter writes plain imports, declares schemas and failure classes at the top level, and receives the same classes as the core: `instanceof LLMError`, refusal-reason classes, Schema classes and services match between built-in and external adapters. Built-in adapters compile from the same source. Measured on Bun 1.4.3, including from a server bundled into one file.

- **The server starts with `--no-install`.** Otherwise an import outside the list is silently resolved by Bun through auto-install from npm into a second copy of effect, and the adapter ends up with two. With `--no-install`, such an import is a loud adapter-load refusal.
- **The loader itself refuses external adapters when the server runs without `--no-install`** (the flag is visible in `process.execArgv`): one place holds the invariant, not the four server launch points (desktop `installation.ts`, `succession.ts`, `try.ts`, `launcher.ts`), which pass the flag through.
- **The host-module list is the contract surface.** It holds `effect` with the used subpaths, the `@runlith/llm` modules profiles use, `@runlith/utils/object`, `@runlith/held/Held` (its hold registry is global and must be one copy) and the exports of built-in adapters that other adapters depend on. The adapter takes effect, its subpaths and `@runlith/*` only through them, and its dependencies may not pull their own copy either; this is the rule for authors. While there are no external users, the list and contract change freely ([[acb620dd]]); from the first external adapter on, only so that installed adapters keep working. Contract and host-module types reach authors through the `/adapter/*` doors of the `@runlith/tagma` package (below); `@runlith/llm` stays `private`.

**The author package is the `/adapter/*` doors of the `@runlith/tagma` package** ([[d9ef0c58]]), public, in npm under the `@runlith` scope (the product name is lawful there: it is a boundary imported by outside code, [[eeaf88ec]]). In it:

- contract types — provider declaration, sign-in, account borrowing, quota, environment records, settings schema — and `defineAdapter(...)`, through which the declaration is type-checked;
- host-module type declarations; `effect` and the package itself are the author's dev dependencies for typechecking, and the host provides them at work;
- contract tests: the author runs their adapter locally and sees that Tagma will accept it — the declaration parses, sign-in and a model call against a stub pass, failures are `LLMError`;
- a new-adapter template (`bun create @runlith/tagma-adapter`).

At work the package is not needed: the adapter imports host modules, the host substitutes them. Built-in adapters are written on the same package — so the contract is one, and Tagma keeps checking on itself what it gives authors. The package exists in the monorepo from this work; it ships to npm with the first external author, and from then on changes only compatibly. The plugin SDK is a separate package with its own contract ([[a0a16218]]).

An adapter's entry exports its declaration — the provider list; one adapter may carry several providers of one vendor. A provider is one of two kinds:

- **Wire** — the model call goes through Tagma's native harness over HTTP. Declares a description (today's `ProviderDescription`), a profile (`ModelProfile`), sign-in, quota and optional web, compaction and result holds — as now.
- **Harness** — the call goes through an external CLI agent (Claude Code, Codex). Declares model descriptions, sign-in, quota and environment records for the account (`Set`/`Unset`); launching stays with `external-harnesses`, which apply those records without knowing their names (port below).

Per provider also:

- **Sign-in** — a set of methods (`loopback`, `device`, `paste`, `key`, `external-cli`) plus optional CLI-login reading and imported-source reconciliation (today `FileTokenStore.importedSourceMatches`); the credential schema extends the core minimum — `accessToken`, `refreshToken | null`, `expiresAt | null`; the adapter derives the account key and label from its credentials; refresher. Several accounts are the adapter's decision, not the core's table. Instead of its own sign-in, or beside it, a provider may declare that it takes another provider's accounts, and then reads their credentials the way it declares itself; it has no refresher for borrowed accounts.
- **Account facts** — what the profile needs to know about an account (uuid, email, organization), the adapter gets from its own credentials itself. The vendor `ModelCredentials` methods go away; the core port hands the adapter its credentials and token without knowing their shape.
- **Icon** — SVG text in the declaration; the client receives it in the catalog feed.
- **Adapter settings** — an optional field schema (type, label, required, whether the value is secret); Tagma stores the values, secrets next to credentials, and hands them to the adapter. The `openai-compatible` instances are described by this schema too.

**An adapter brings no UI.** The Providers screen is one and shared, drawn by Tagma from registry data: a section is a "provider, account kind" pair with the declared name and icon; "Add account" comes from the declared sign-in methods, and Tagma shows each one itself (`loopback` — browser and waiting, `device` — code and address, `paste` — code field, `key` — key field, `external-cli` — a Tagma terminal with the sign-in command); quota, default account, re-sign-in and removal are shared for all; the settings form follows the adapter schema. An adapter needs no custom view; anything beyond that belongs to a plugin with views ([[a0a16218]]).

Fields with no consumer in Tagma are removed: `egressOrigins`, `drawing` with `defaultImageModel`, `imageProviderIds` and `resolveImageModel`. Model hints for agent choice (`spawnGuidance`) are operator policy, not vendor fact: they leave adapter descriptions for an operator setting at the `settings` module — the "for what" text and "which reasoning" per (provider, model) pair, empty by default — read from there by `CollaborationTools`. A model without a hint stands in the menu without one.

**Not hanging the server is the author's duty.** The contract does not enforce it: part of the profile methods are synchronous (`options`, `output.budget`, `fromHeaders`, `compaction.select/summary`, `presentation.body/encode`), and a synchronous loop inside the process cannot be interrupted. The author keeps synchronous work bounded ([[7a910861]]) and starts background work only inside the Effects it hands over; there is no separate mechanism against it ([[06e41b6f]]).

### Registry

One owner in the server's `providers` module holds the registry: which adapters are installed, what each declared, in what load state. Everything that currently reads the static catalog — model menu, settings schemas, accounts, sign-in, quotas, the agent core, the client — reads the registry or its projection ([[51c66cb6]]). `Schema.Literals` over provider ids in the wire are replaced by a registry check at admission. The client receives the catalog by feed together with the icons; nothing about providers is compiled into the client.

- **A load failure is an adapter refusal.** An adapter whose entry threw at load, declared a malformed description or missed a module stands in the registry as `failed` with a reason. Built-in adapters connect through a lazy `() => import(...)` from the composition list, so their top-level failure is also caught by the loader instead of taking down startup. A failure inside a call is the provider's `LLMError`, as now.
- **A removed provider.** Ids stored in threads, the default-model setting, default accounts and credential rows survive adapter removal. Touching it is a typed `provider-not-installed` refusal with the "install the adapter" unblock, including where `catalog.named` throws today (`models/catalog.ts`, `providers/accounts/defaults.ts`). The credential document keeps a missing provider's section as is — key, label and credential as written — and does not parse it with a schema until the adapter returns; this covers writes from the `tagma auth` CLI too, which writes the same file.
- **The default model** is picked from installed providers. A stored default model served by no installed adapter does not refuse: defaults reads and thread birth answer as on a fresh install (first provider with an account), while the stored choice stays and takes effect again once the adapter is back. Favorites answer with servable models only, so the next favorites edit does not run into a departed model.
- **The model menu in agent tool schemas** holds declared models, not health: a `failed` or unreachable instance (a switched-off Ollama) does not remove models from the menu. The catalog freezes for the run, like instructions. The menu changes on adapter install, removal and model enablement — that is, by user action — and each change cools the threads' prompt cache once.

### Delivery and installation

The package format, contract and registry are one; delivery differs.

- **Built-in adapters** are packages in the repo, compiled into the server. Their list stands in composition: connecting variants is its business ([[6f758080]]).
- **External adapters** live in `~/.tagma/adapters/<id>/`; that is the install place, not the distribution channel. An adapter ships as an npm package or a GitHub repo.
  - `tagma adapter add <source>` and the same action in settings: an npm package name with or without a version, a GitHub address or a local path. Tagma fetches the package, installs its own dependencies without peer dependencies (`--omit=peer`) and remembers the install with a machine record `{id, source, version, enabled}`, like a plugin install ([[a0a16218]]).
  - Update, disable, remove — with the same verb by id. Removal takes the package away but not its providers' credentials.
  - The loader imports the adapter entry lazily, at the `providers` level ([[0d2c66a9]]); Bun transpiles TypeScript itself.
  - **No-restart update goes to a new folder.** ESM does not unload, and a repeated import of the same path re-reads the entry without its dependencies. So each version installs into its own `~/.tagma/adapters/<id>@<version>/` directory, the loader imports it from there — a new module graph — and the registry switches the provider to it; the previous version stays in memory until the server restarts (probe on Bun 1.4.3: eight versions of an 8 MB module raised RSS from 35 to 75 MB, garbage collection never returned them).
    - **A run holds the version it started with**, together with the description; the new version starts with the next run. This keeps retry, web and compaction inside a run from mixing versions; the price is that a run hours long works on the previous version until its end. The credential refresher switches at once.
    - The credential schema stays compatible across adapter versions — the author's duty: a run on the previous version reads a row written by the new one.
    - **Cleanup:** at server startup the loader removes every adapter-version directory except the current one ([[a00f91b0]]). The development link to a working directory refreshes the same way, by copying into a new directory on the "reload" action.
  - **An external adapter depending on another external one is not arranged:** an external adapter depends only on built-ins — through their exports in the host-module list.
  - An adapter catalog with search is out of scope.

### Model facts shared by several adapters

Vendor model specs are currently shared between the public provider and the CLI-harness menu (`ANTHROPIC_SPECS`, `OPENAI_SPECS`). An adapter may depend on another adapter and take model descriptions from it: a harness provider takes its vendor adapter's models.

### OpenAI-compatible provider from settings

One built-in `openai-compatible` adapter, N instances from settings. An instance is an address, an optional key, a name and models.

- **An instance id never changes**: renaming changes the name, threads do not lose the provider.
- **A model** has a required context window; the output limit is a field defaulted from the window (today the template sends `max_tokens` 32000, and an 8k-window model would be refused); vision and tool choice are optional marks, off by default; reasoning levels are an optional list with a default level and the request field the level goes into; protocol-compatibility flags (`compatibility` on `openai-compatible-chat`) are the instance defaults.
- **The model list** can be pulled from `/v1/models` by user action; only models the user enabled reach the registry (OpenRouter has hundreds, while the menu stands in every agent's prefix).

## Claude sign-in and accounts in a public install

The public path to Claude on subscription is a harness provider: the Agent SDK over the real `claude`, and `claude` itself in the terminal. Tagma does no sign-in for Claude Code and stores no token of its.

- **An account is a `CLAUDE_CONFIG_DIR` directory or "no directory".** The account record stores the machine and the directory, not the token; the directory string is stored exactly and passed to the launch as is: the keychain item is a hash of the string, and a tilde, symlink or trailing `/` yields a different item — that is, a "signed-out" account. Account directories created by Tagma are `~/.tagma/claude/<account>/`, each with its own keychain sign-in. An existing user sign-in is a launch with `CLAUDE_CONFIG_DIR` unset: this is not the same as an explicit `~/.claude`, they have different keychain items.
- **Add account** — Tagma creates a directory and runs `claude auth login` in the Tagma terminal with that directory; the user signs in through the browser, as in Claude Code.
- **The account environment port.** Environment records for (provider, account) are declared by the Claude adapter: `CLAUDE_CONFIG_DIR` or its removal, and removal of `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` for the subscription account. `providers` hands them through a port, `external-harnesses` applies them to the runner and terminal launch (`harnessPlace` in `external-harnesses/sessions/launch.ts`; `Unset` records already exist) — neither knows the variable names. The same port fits Codex (`CODEX_HOME`). This launch change is in scope. A key-based account is a separate account kind of the same provider with the key in the environment.
- **Running sign-in and `/usage`.** `claude auth login` in the terminal and headless `/usage` are run not by `providers` — it has no connection to executions — but by the port `providers` declares and `external-harnesses` fills ([[e090f46d]]).
- **The Tagma layer for Claude goes into each account directory.** Hooks in `settings.json` and the `tagma` skill are currently written to `~/.claude`, past `CLAUDE_CONFIG_DIR` (`hookFormat.ts` without `homeEnv` unlike codex, `skillInstall.ts`, `targets.ts`). Layer installation goes into each account's directory, otherwise a terminal `claude` on an account directory stays without hooks where the project has no repo layer.
- **SDK and terminal billing are one while Tagma holds the environment.** A key from the environment wins over the subscription in SDK mode, while interactive `claude` may reject it; so removing keys is required. The runner goes with `settingSources: []`; a terminal `claude` reads the project `.claude/settings.json` from the cwd, including `apiKeyHelper`, and the Tagma directory does not cover it — that is the limit.
- **Quota** comes from the SDK usage report (`get_usage` / `usage_report`, experimental SDK API 0.3.273+) without reading the token. Quota is given by this account's runner sessions: the runner puts it into the same `reading()` as the session totals (`runner/claude/sdk.ts`), it travels over ACP to the driver and into the existing `AccountQuota.observe(provider, account, observation)` door (`providers/contract/service/quota.ts`), whose `provider` becomes the registry id. Without a running session there is no Claude quota: headless `/usage` in the probe returned `usage_report.rate_limits: null`, and the quota windows (`five_hour`, `seven_day`) arrived in `rate_limit_event` after a model request. The screen shows the last quota with its timestamp. The harness provider is excluded from the 15-minute quota poll; no background `claude` launch exists for quota's sake. A terminal `claude` gives no quota. A breakage of the experimental API is a quota refusal, not a sign-in one.

### Codex accounts

The shape is the same as Claude's, and official by default too; both modes exist in the public install too:

- **Codex login mode** — an account is a `CODEX_HOME` directory or "no directory" for the user's existing sign-in (`~/.codex`). The real `codex login` in the Tagma terminal signs in. The Codex app-server and terminal `codex` start with the account directory through the same environment port. `openai-oauth` (Tagma's own path under the `tagma` name) borrows these accounts and reads the token from the directory's `auth.json`; only `codex` refreshes a borrowed account (an app-server `account/read` request with `refreshToken: true`, no model call), Tagma re-reads the file.
- **Tagma mode** — today's own Tagma sign-in with the Codex client id, `originator: tagma` and its own refresher.
- Probe on `codex` 0.162.0 (2026-10-11, test `CODEX_HOME`, `file` store): `codex` refreshes the sign-in only on 401 — never ahead by age — and writes new tokens to `auth.json`; the previous access token stays valid after refresh until its `exp`; the previous refresh token inside a short window after rotation is still accepted by the server (past the window it may refuse "refresh token was already used", window length not measured); two parallel `exec` runs on one directory both survived refresh, `codex` has no file lock, it re-reads `auth.json` before refresh. So Tagma's own path on a borrowed account re-reads `auth.json` on 401 and retries; when the token there is unchanged, it starts `codex` in the account directory so the CLI refreshes the sign-in itself.

### No sign-in at the door

A user who already signs in to `claude` or `codex` sees that account right after installing Tagma in the "Claude" or "Codex" section in CLI-login mode, and works on their subscription with no new sign-in. Tagma learns about the sign-in from the CLI itself, without reading the token: `claude auth status --json` (the `loggedIn` field) and `codex login status` — both offline, tens to hundreds of ms; they do not prove the sign-in is live, the first call shows that. The harness path never reads the token at all, and macOS asks nothing.

### Sign-in mode and vendor section

A vendor with several sign-in methods has one mode at a time; nobody has "both at once". A mode is an adapter setting the adapter declares (values and default) and the user changes; Tagma draws it the same for any provider.

- **One Providers screen section per vendor**: "Claude", "Codex". The mode switch stands in the section header next to "Add account" ("Sign in with Codex ▾"); a single-mode vendor has none. The row mode is visible in its caption ("Codex login · ~/.codex").
- **The mode decides** whose accounts are in the section, what "Add account" does (CLI login — `codex login` / `claude auth login` in the Tagma terminal; Tagma — browser sign-in) and what signs Tagma's own-path requests. Switching removes nothing: the other mode's accounts are stored and return when the mode is back.
- **The CLI path in the model menu does not depend on the mode.** Claude Code and Codex, running on their own CLI login, stand in the menu while the CLI is installed, in any mode: so a native thread on Tagma sign-ins and a CLI thread work side by side.
- **There is no import.** A copy of someone else's token refreshed by Tagma signs the CLI owner out (the refresh token becomes used). The "I already sign in" need is closed by CLI-login mode; moving to one's own sign-in is one browser sign-in.
- **An install where the provider already has its own Tagma sign-ins** starts in Tagma mode: running threads do not silently move to CLI logins.
- **First show** with no own sign-ins picks the mode by machine, then changes only by hand: CLI installed with a sign-in in it — CLI-login mode with a ready account; CLI installed without sign-in — CLI-login mode with a "Sign in" button; no CLI — for Codex, Tagma mode with one "Sign in with ChatGPT" button and the Codex variant in the switch inactive with a "codex isn't installed" caption; for Claude in public — a "Claude Code isn't installed" line with no button.
- **Claude in public** is one mode (Claude login), one model-menu path (Claude Code), no switches.
- **The section is simpler than today's:** the Cache row moves into a hint on the name, "updated … ↻" into "⋯" (quota refreshes itself), there are no default or imported badges (the radio button is the default account), a row has one action and only when needed ("Sign in"), the rest in "⋯".

Beyond this work are ideas: built-in CLI install in the section and SIWC for Codex Tagma mode.

### Refresh check

Borrowed-account refresh is proven by live probes before implementation and tests after: an expired token refreshes with no user action, a run does not wait on refresh longer than one provider request, parallel SDK, terminal and Tagma's own path on one account do not sign each other out. In `claude` 2.1.296 code, refresh runs 5 minutes before expiry under `<config>/.oauth_refresh.lock` with keychain re-reading and writing only over what was read; `claude auth status` triggers no refresh. Live probe: two parallel requests on one directory survived refresh.


## What changes in other nodes

- In the plugins spec [[a0a16218]], the paragraph about adapters is replaced by a link to this spec (done when writing the spec).
- `credentialDocument.ts` with its `version` field and V2 migration violates [[acb620dd]]; the document moves to the open form keyed by provider id in the same work.
- Each new package — built-in adapters, `openai-compatible` — gets a `#module` card with entries and imports per [[083d37f1]]; the `@runlith/llm` card ([[249ce587]]) loses the vendor profiles leaving it.

## Out of scope

- CLI harnesses as adapters: the `external-harnesses` tables (claude, codex, cursor, devin, gemini, grok) stay; only the account environment port, the launch port and the Claude and Codex accounts are in scope.
- A separate process or worker for adapters, an adapter catalog, billing.
- Speech providers.

## What the performer proves

- In the shipped core code `packages/llm`, `packages/agent`, the server and the client, no vendor id stands outside its adapter: a code check, except `external-harnesses/vendors/*`, which are out of scope (the `packages/agent` test defaults — `InMemoryAggregateStorage`, `ThreadRows`, `agentRoster` — move to a test provider).
- An adapter updated to a new version runs new code with no server restart, including a changed inner module.
- An example external adapter from `~/.tagma/adapters/` loads in the release build, its models are in the menu, the call goes through, its `LLMError` is recognized by the core; an import outside the host list is a load refusal, not a second copy of effect.
- An adapter that throws at load, and a built-in adapter with a top-level failure: the server starts, the provider is `failed` with a reason, the rest keep working.
- A removed adapter: the thread opens, the call and default-account read are `provider-not-installed`; credential rows survived another provider's write; when the adapter returns, the call goes with the same account.
- An OpenAI-compatible instance against a local stub: the model in the menu, a streamed answer, `max_tokens` within the window.
- A public install assembles and works; Claude goes through the SDK with a Tagma-catalog account; the terminal `claude` of the same account needs no new sign-in; the runner-session quota is visible.
- The user's existing `claude` and `codex` sign-ins are visible as accounts right after install, with no new sign-in.
- A borrowed account: an expired token refreshes with no user action (Codex — `codex` itself on 401); a run does not wait on refresh longer than one provider request; the SDK, terminal and Tagma's own path working at once on one account do not sign each other out; the own path makes no refresh call for a borrowed account.

## What the operator checks

- Add Ollama from settings and talk to a local model.
- Add a second Claude account in the public install, switch, open a `claude` terminal on it.
