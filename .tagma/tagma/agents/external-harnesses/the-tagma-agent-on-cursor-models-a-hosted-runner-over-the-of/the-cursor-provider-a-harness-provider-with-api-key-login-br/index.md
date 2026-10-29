---
id: 01a16434-fc60-7079-91d8-189c3c947db7
title: "The `cursor` provider: a harness provider with API-key login (browser via `Cursor.auth.login()` or paste), catalog from `GET /v1/models`, quota on the `cursor-agent` login"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a16401-4e1c-760d-8253-35ee9fe38a12
sources:
  - kind: file
    ref: apps/tagma/server/src/providers/accounts/harnessAccounts.ts
  - kind: file
    ref: apps/tagma/server/src/providers/registry.ts
  - kind: file
    ref: packages/tagma/src/adapter/declaration.ts
  - kind: file
    ref: packages/tagma/src/adapter/provider.ts
---
The `cursor` provider — Cursor subscription models for the Tagma agent — with API-key login, an official-API catalog, and quota on the `cursor-agent` login. Its models are served by the hosted runner (the neighbouring spec); this part is visible and works on the Providers screen and in model selection before the runner.

## What the user sees

- **Providers screen, "Cursor" section.** Two buttons: "Sign in with browser" and pasting an API key. Login opens the system browser on the Cursor page; after confirmation the account joins the list with the key owner's email. The login-issued key shows in Cursor's dashboard → API Keys as "Tagma"; deleting the account in Tagma does not revoke the key at Cursor, and the interface says so. Several accounts, a default account, pinning to a thread — as with other key providers ([[a65d1a0a]], [[7c1754fb]]).
- **Key lifetime.** The login key lives 90 days (the SDK default). Within 7 days of expiry and after it, the account shows "Sign in again" ([[8fe67900]]); a thread on an expired key does not start and names the login. A pasted key carries no lifetime.
- **Model selection.** Cursor models sit in the shared picker in a "Cursor" group, with the rungs and switches the model declared. Models unavailable to the account's plan never reach the catalog: a Free/Plus plan gets only Cursor models, third-party ones need Premium ([[9fe38a12]]).
- **Quota.** The Cursor counter in the status bar shows windows and resets when `cursor-agent` on this machine is logged into the same account (matched by email). Otherwise — "quota unknown" with a reason: the CLI is not logged in, is logged into another account, or Cursor did not answer.

## The adapter and `providers` contract

Today a harness provider must log in through a CLI (`packages/tagma/src/adapter/declaration.ts:99–103`), its account is the CLI settings-folder account (`HarnessAccountAuth`), and `HarnessAccounts.launch` hands only that folder's environment to the process (`apps/tagma/server/src/providers/accounts/harnessAccounts.ts:206–239`). The model catalog is a synchronous static declaration; a harness provider reads no quota (`quota: null`). Three extensions are needed at their owners ([[ea5c74f4]], [[f92da92b]]), with no branch on the provider:

1. **A keyed harness provider.** `auth: 'api-key'` is allowed for a harness provider. Its accounts are the same `providers` key records as keyed wire providers, with an optional lifetime; login is declared by the same sign-in kinds (`key` and the browser flow that returns credentials — the `run(openBrowser)` form). `environment` takes the selected account's credentials (a folder for a CLI account, a key for a keyed one), not only the folder; `HarnessAccounts.launch` hands its records over for both kinds. Account pinning at launch exists for CLI accounts (`external-harnesses/sessions/launch.ts:42–53`) but takes the provider from the model's terminal surface; for Cursor the runner-landing spec moves it to the landing owner.
2. **An async catalog.** A provider may declare `catalog.read(credentials) → models`. `providers` reads it with the default account — after login, on default change, on the Providers screen refresh button, and once a day while the server runs — keeps the last good answer in machine storage, and builds the provider's models in the shared catalog from it (`providers/registry.ts:85–140`); a server restart does not lose the catalog. A failed read keeps the old catalog and writes the reason to the Providers screen. A provider with no read catalog stands in the picker with no models and an invitation to log in; the "a provider has a default model" rule for such a provider is judged on the read catalog.
3. **A harness provider's quota.** A harness provider may declare a quota reader of the same `read(credentials, account)` form as wire (`packages/llm/src/profiles/contract.ts:69–77`); `AccountQuota` polls it with the same ledger, the same storage, and `QuotaUnsupported` for "unknown".

## The `adapter-cursor` package

A new `packages/adapter-cursor` — a #module of kind kit next to [[b6853ec2|adapter-anthropic]]: the provider description, login, catalog projection, quota reader, and the Cursor mark. The mark moves here from `external-harnesses/vendors/cursor/mark.ts`; the terminal row imports it from here, as Claude Code does `@runlith/adapter-anthropic/icon`. The built-in adapter plugs into `BUILTIN_ADAPTERS` (`composition/adapters.ts`).

- **Description.** `id: 'cursor'`, label "Cursor", `kind: 'harness'`, `auth: 'api-key'`, `cacheLifetime: { promisedSeconds: null, prior: null }` — Cursor's cache lifetime is unpublished and unmeasured. No id conflict: there is no built-in `cursor` provider at runtime, the old `cursorDescription` is not registered.
- **Browser login.** `Cursor.auth.login({ openBrowser, onLoginUrl, store: null, apiKeyName: 'Tagma' })` of the official SDK: the SDK loads by lazy `import()` only for the login; `store: null` — the key is never written to `~/.cursor/sdk/auth.json`, Tagma keeps it. The link opens in the system browser (the sign-in's `openBrowser`), not the built-in one. The credentials are the key, its lifetime, and the email.
- **Identity and catalog — documented HTTP, no SDK.** `Cursor.me()` and `Cursor.models.list()` of SDK 1.0.35 are themselves `GET https://api.cursor.com/v1/me` and `GET /v1/models` of the Cloud Agents API with the key (`models.list` only unwraps the `items`; bundled SDK code, symbols `O5`, `PU6`, `kU6`). The adapter calls these endpoints itself through the server HTTP client, so the SDK in the server process loads only for the browser login. The `get_models` limit is 30 per user per minute ([[9fe38a12]]): the catalog is read on events and once a day, never per thread.
- **Key pasting.** The key is checked with `GET /v1/me`; Cursor's refusal comes in Cursor's words.
- **Catalog.** Projection of `ModelListItem`: id and `displayName` become the Tagma model; the reasoning parameter becomes rungs and `defaultReasoning` from the default variant; other terminal parameters (`fast`, `thinking`) become switches with Cursor's exact ids and values and the default variant's default; max mode (SDK 1.0.40) is not a parameter but a separate `ModelSelection.maxMode` boolean, which the catalog marks on variants (`ModelVariant.isMaxMode`) — its own switch going to `maxMode`, not `params`, available only to models with such a variant; aliases are only for reading a previously saved id. The context window (`packages/llm/src/models/catalog.ts:90–94` requires capacity on a text model): the `context` parameter gives its value's window, and then every value is a separate Tagma model (Tagma's window is static per model and does not depend on switches, `catalog.ts:25–42`); without the parameter — the adapter table by families, checked against the Cursor model docs; a model with no known window never enters the catalog, and the Providers screen names it and the reason. SDK 1.0.40's `ModelListItem` has no shared default-model mark: take the first model of the Cursor pool (Composer/Grok), otherwise the first valid model; for context, the variant marked default comes first.
- **Quota.** The `cursor-agent` login token — from where the CLI keeps it on that OS: macOS Keychain (or `~/.cursor/auth.json` if the CLI keeps the login in a file), `$XDG_CONFIG_HOME/cursor/auth.json` (else `~/.config/cursor/auth.json`) on Linux, `%APPDATA%\Cursor\auth.json` on Windows (places per T3's `usageLimits.ts:109–126`); `POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage` with that token — plan windows and reset into `QuotaObservation`. The operator's decision of 2026-10-22: that endpoint is undocumented, T3 Code uses it ([[6255ed3c]]); it never touches turns. The reading counts only when the CLI login email (`POST DashboardService/GetMe`, as installed cursor-agent of 2026.10.19 does) matches the Tagma account email (`Cursor.me().userEmail`): otherwise it is someone else's quota. `QuotaUnsupported` does not fit here: it means "no mechanism ever", carries no reason, and switches the row's reading off forever (`packages/llm/src/llm/schema/quota.ts:64–77`, `providers/quota/ledger.ts:74–91,337–382`). Network failure and non-2xx answers are the existing transient quota failures; no CLI login and login to another account are a new typed transient outcome at the schema's owner, which the ledger rereads on the next tick and on the refresh button. The previous reading stays with a failure mark. The CLI token is never stored and never passed to the runner.

## Acceptance criteria

1. On the Providers screen, browser login opens the system browser; after confirmation the account stands with email and lifetime; key pasting works; a wrong key is refused in Cursor's words; the key never appears in `~/.cursor`.
2. After login, Cursor models stand in the picker with rungs and switches from the catalog; after a server restart with no network the catalog is the same; a model with no known window is absent from the picker and named on the Providers screen.
3. Quota: with `cursor-agent` logged into the same account — windows and reset in the status bar; with another account or no login — "unknown" with a reason; a CLI login to the right account after that gives a reading on the next tick with no server restart.
4. Through the public launch contract, a thread pinned to account A gets A's key, not the default; Claude and Codex CLI accounts launch as before.
5. Expired key: the account asks to "Sign in again", a thread refuses with a login.
