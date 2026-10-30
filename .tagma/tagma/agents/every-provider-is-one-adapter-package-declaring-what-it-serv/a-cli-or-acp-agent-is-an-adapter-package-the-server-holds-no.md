---
id: 01a18cbf-97fc-7f17-bc60-685157787448
title: "A CLI or ACP agent is an adapter package: the server holds no list of vendors"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0fd8b-bf09-7bd4-86c2-a17f287a4906
---
**Outcome.** A CLI or ACP agent comes to Tagma the way an API provider already does: as an adapter package. The package declares the provider and accounts, and also how its program is launched, read and driven, or how its ACP agent is reached. Builtin packages ship with Tagma. Others come by `install_adapter`. The server holds no list of vendors. A vendor dropped from the public build for its terms is an entry removed from the builtin adapter list or never added; a vendor kept privately ships as a machine adapter, as Muse OAuth does.

## What the user gets

- **A CLI from a package becomes a thread.** A user brings a CLI Tagma has never heard of. Its package is installed, and it appears in the `+` menu as a thread on the transports its package declares. Its chat, its titles (its own or Tagma's asks) and its compaction are whatever the package declares. Nothing more is promised.
- **A CLI that is not installed refuses at birth.** Picking one says so before anything launches, and names the package's install command (`harness-not-installed`).
- **One transport rule.** `threads.harnessTransport` and `threads.harnessProfile` are keyed by the installed harness ids. A harness that offers both transports follows its setting, and no key is silently ignored. Today `threads.harnessTransport.cursor` is never read, and claude-code and opencode cannot be set.
- **One title switch.** `threads.harnessTitle` decides both whether the CLI is asked to title its session and whether Tagma takes that title. A title is no longer paid for and then discarded.

## Contract (`@runlith/tagma/adapter`)

A harness provider gains two optional surfaces. The types move out of the server's `external-harnesses/contract/service/adapter.ts` and `protocol/profile.ts` into the public adapter contract:

- **`terminal`** — what `HarnessAdapter` and `HarnessLaunch` hold today:
  - binary, install hint, `installedIn`;
  - interactive, resume and assign argv; permission modes; model argv;
  - hook format id and event readers; metadata reader;
  - screen and composer readers; interrupt, quit and exit keys; ends; tool map; MCP surface;
  - cut, carry, prepare, address;
  - the vendor title switch.
- **`acp`** — what `AcpProfile` holds today:
  - argv, configure, extensions, login, grace and handshake;
  - `proves`, the capabilities the agent implements;
  - for a Tagma-hosted runner, the runner's entry module.

A provider must declare at least one of the two to be offered as a thread.

## Owners

- **Host modules for shared vendor code** (`@runlith/tagma/harness/*`). They are listed in the generated host modules so external packages may import them:
  - the hook formats (`external-harnesses/adapter/claudeFormat.ts`, `hookFormat.ts`, `payload.ts`, `screenAsk.ts`);
  - the hosted runner kit (`external-harnesses/runner/hosted/*`: `ServerDoor`, `Cycle`, `Session`, `Relay`, `turn`);
  - the metadata readers several vendors share.
- **Vendor packages.** Each builtin vendor's row, ACP profile, runner and vendor SDK dependency move into its adapter package:
  - `packages/adapter-anthropic`: Claude Code terminal and ACP, the Claude Agent SDK runner;
  - `packages/adapter-openai`: Codex;
  - `packages/adapter-cursor`: the `@cursor/sdk` runner;
  - `packages/adapter-opencode`: its client runner;
  - `packages/adapter-devin`.
  - Grok and Gemini get packages of their own.
- **`external-harnesses` becomes vendor-neutral.** It keeps the drivers (the ACP driver, the terminal transport, hooks ingress, installs, births, seats, asks' program runner). It reads every vendor fact from the registry's harness providers, and holds no directory per vendor.
  - `serving.ts` registers one `Harness` per loaded provider with a surface, and follows the registry's changes stream on install and removal.
  - `tagma harness-run <id>` loads the runner entry the package declares, with the same loader and the same `--no-install` rule as adapters (`packages/tagma/src/adapter/loader.ts`).
- **Names.**
  - `HARNESS_NAMES`, `HARNESS_LABELS` and the `ADAPTERS` table are removed.
  - `HarnessName` becomes a harness id validated against the registry at each wire boundary.
  - Settings key lists are derived from the registry.
  - Ids already stored in rows and settings keep their spelling: the builtin packages declare the same ids.
- **Truthful declarations.**
  - Registration checks each `acp.proves` flag against the extensions the runner registers. A mismatch is the adapter's load failure, as `Transports.mismatchOf` is for transports. Cursor and OpenCode then declare fork and rewind only once implemented.
  - The ACP transport's compaction declaration follows the session's value, not one flat `'session'`.
  - A native row's `web` names the vendor web it uses.
  - The `harness` agent's description is composed from the declarations instead of the fixed "this server never asks a model" (`native-harness/agents/harness/agent.ts:7`).

## Migration

1. Contract and host modules first.
2. Claude Code, the largest: terminal, hosted ACP runner, ask program.
3. Then Codex, Cursor, OpenCode, Devin, Grok and Gemini, one package per landing.

Each landing deletes that vendor's server code. Its existing tests move with it, and its behaviour does not change. Stored thread rows, settings and sessions need no migration, because ids are unchanged.

## Acceptance

1. `apps/tagma/server/src/external-harnesses` holds no `vendors/` directory and names no vendor id outside test fixtures. An enforced inspection proves it.
2. A test adapter package declaring a fake terminal CLI, installed with `install_adapter` in an integration world, is listed as a harness. `create_thread` with `harness:<its id>` launches its program through the terminal transport. Removing it withdraws the harness.
3. With one builtin vendor's entry removed from the builtin adapter list, the server typechecks and boots. This is checked once, in the change that lands the last vendor.
4. A birth of a harness whose program is not installed refuses `harness-not-installed` with the package's install hint, before any process starts.
5. A package whose `acp.proves` claims a capability its runner does not register fails to load, with a reason naming the capability.
6. With `threads.harnessTitle` off, the CLI is launched without its title call. With it on, the title the CLI writes is taken.

**Proof.** Integration tests through `install_adapter`, `create_thread`, the adapter registry's load answer and the settings door, with the test package. Plus the inspection of acceptance 1. The tests each vendor already has move into its package and stay green.
