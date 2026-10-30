---
id: 01a18cbf-97fc-7f17-bc60-685157787448
title: "A CLI or ACP agent is an adapter package: the server holds no list of vendors"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0fd8b-bf09-7bd4-86c2-a17f287a4906
---
**Outcome.** A CLI or ACP agent comes to Tagma the way an API provider already does: as an adapter package. The package declares its provider and accounts, and then either how its program is launched, read and driven in a terminal, or how its own ACP agent is reached. Builtin packages ship with Tagma; any other package comes through `install_adapter`. The server holds no list of vendors. A vendor dropped from the public build for its terms is a builtin entry removed. A vendor kept privately ships as a machine adapter, as Muse OAuth does.

**Boundary.** A runner that Tagma hosts — a vendor SDK driven inside `tagma harness-run`, which is how Claude, Cursor and OpenCode run today — ships only in builtin packages. That runner speaks the server's private hosted protocol (`read_hosted_agent`, `open_hosted_turn`, `call_hosted_tool`) through the private kit `@runlith/hosted-runner`, whose door port the server fills (`ServerDoor`) and hands the runner a builtin package ships (`HostedRunner`, resolved by `harness-run` from composition's builtin table). Publishing the runner would turn that protocol into a versioned public API, and no outside vendor needs one: a vendor with its own ACP agent brings that agent, as Devin does, and a CLI needs only its declarations. The tradeoff: a new vendor that offers nothing but an SDK needs a Tagma release.

## What the user gets

- **A CLI from a package becomes a chat.** The user installs the package, and the CLI appears in the `+` menu on the transports the package declares. Its titles and compaction are what the package declares, and nothing more.
- **A CLI that is not installed refuses at birth,** before anything launches. The refusal is `harness-not-installed` and carries the package's install hint.
- **A removed harness keeps its chats.**
  - Its threads stay in the list and read as before. Label, mark and icon come from the presentation stored on the thread.
  - A new turn, a move onto it, or a fork onto it refuses `harness-not-installed`.
  - A live process of it ends at rest.
- **Settings keyed by what is installed.**
  - `threads.harnessTransport` is keyed by the installed harnesses that offer two transports that are not hosted. Today that is Devin. The dead `cursor` key goes. Hosted profiles keep ignoring the setting by design: an explicit harness type opens the vendor's own agent, and a model pick opens the hosted chat. The setting's text already says so.
  - `threads.harnessProfile` is keyed by the installed harnesses that have a terminal surface.
  - Both settings become records validated at write against the registry.
- **One title condition.** `threads.harnessTitle && threads.autoTitle` decides both whether the CLI is launched with its title call and whether Tagma takes the title. A surface without a title switch says so in its declaration, and its title call cannot be turned off. Today only the hosted Claude runner has a switch (`--untitled`).

## Contract (`@runlith/tagma/adapter`)

A harness provider gains two optional surfaces. Their types move out of the server and into the public adapter contract, together with the lowest-owned wire types they reference: the types currently imported from `threads`, `platform` and `external-harnesses` wire.

- **`terminal`** holds what `HarnessAdapter` and `HarnessLaunch` hold today, without `oneShot` (Part 1 removes it):
  - binary, install hint, `installedIn`;
  - argv for interactive, resume and assign launches; permission modes; model argv;
  - screen and composer readers; interrupt, quit and exit keys; ends; tool map; MCP surface;
  - cut, carry, prepare, address;
  - the title switch;
  - a **hook codec** and a **metadata reader**, implementations of public contracts:
    - the hook codec (`@runlith/tagma/adapter/hook`) writes the CLI's answers — permission, context, tool and prompt — and declares its hook file: top-level keys, where events sit, the trust table, the entry for one command; the surface's event readers (`occasionOf`, `subjectOf`, `filesOf`, …) read its events;
    - the metadata reader reads the CLI's transcripts.

    Today's codecs (`adapter/hookFormat.ts`, `adapter/claudeFormat.ts`) and metadata readers (`metadata/*`) move into the vendor packages. Helpers that are genuinely format-neutral become shared host modules.
- **`acp`** holds a vendor-run ACP profile, `hosts: null`: argv, configure, extensions, login, grace and handshake times, and `proves`. A builtin package may also declare a hosted runner entry.

A provider must declare at least one of the two surfaces to be offered as a chat. Its id is the harness id: up to 64 lowercase letters, digits and hyphens starting with a letter (the session-token grammar the MCP bridge proves), never a native id (`tagma`, `lode`). A package declaring both surfaces launches the same program on both, so the birth's install check covers the program either transport starts. The declaration refuses any other shape.

## Owners

- **Hook process.** `tagma hook` runs on every CLI tool call and parses the event in its own process. It loads only the named harness — its builtin row, or the one machine-installed adapter package that declares the id, through the loader and the server's host modules — and answers through that harness's hook codec. `--harness` (and `tagma mcp serve --harness`) takes any id; an id nothing declares refuses `harness-not-installed`. Builtin ids keep their spelling, so hook files already written into users' repositories and CLI homes keep working. A command written without `--harness` reads the builtin and installed harness declarations and answers in the codec of the thread the server's receipt names, else of the CLI whose published session variable carries the event's session, else not at all.

  `composition/testing/cli/hookIngress.bench.ts` measured HEAD `db387702` before the change, the thin-relay prototype, and the final named-row process. Each road used 60 door posts and 20 in-process `observe` and `post-tool-use` hooks; the first comparison used 12 launched source-run CLI processes. One reading per arm, p50 / p95 in milliseconds:

  | Road | HEAD baseline | Thin relay prototype | Final named-row process |
  | --- | ---: | ---: | ---: |
  | Door | 8.32 / 50.28 | 6.20 / 12.99 | 6.71 / 12.55 |
  | In-process observe | 8.29 / 103.63 | 6.86 / 29.73 | 8.93 / 19.76 |
  | Post-tool-use | 39.31 / 789.93 | 43.11 / 804.40 | 51.35 / 858.11 |
  | Launched observe | 179.19 / 579.26 | 113.50 / 157.26 | 206.04 / 348.86 |

  Machine contention made separate-run comparisons inconclusive: two further HEAD readings ranged from 172 to 198 ms launched p50 and 256 to 343 ms p95, while the relay ranged from 213 to 385 ms p50 and 370 to 529 ms p95; a later loaded sample made even HEAD's launched p50 647 ms. The final comparison alternated 24 HEAD and 24 final hook processes against the same server: HEAD 217.71 / 351.65 ms, final 206.04 / 348.86 ms. The named process therefore keeps the measured HEAD budget. The instrument retains `--baseline-entry` for this paired comparison, closes its own world, and no longer invokes the missing admission-benchmark file. The fixture is nongit, so its post-tool road measures captured writes and refused accounting, not successful git accounting; these source-run samples do not measure release bundles or other machines.

  After Claude Code moved into `@runlith/adapter-anthropic` (step 5), the same instrument ran 60 door posts, 20 in-process `observe` and `post-tool-use` hooks, and 12 launched `observe` processes per lane, the three launched lanes alternated against one server. One reading, p50 / p95 in milliseconds: door 6.38 / 13.89; in-process observe 8.46 / 24.31; post-tool-use 43.05 / 854.31; launched, a row the server still holds (`cursor`) 177.58 / 240.39; launched, a builtin package harness (`claude-code`) 192.43 / 270.37; launched, a machine-installed package harness (the Quill test package, installed through `AdapterInstalls`) 218.51 / 259.73. Against the HEAD reading above (217.71 / 351.65), every launched lane's p95 is lower; the installed-package lane's p50 is 0.8 ms above it, the others lower. The package lanes cost their import of the declaring package. One sample on one loaded machine.

  The named process was chosen because it also keeps capturing write bases and queuing pending writes on the CLI's own disk while the server is unreachable. A relay that does not parse cannot know which files to capture before the write, so those edits would lose their before-text witness during a server restart (note [[8ed5962b]]). The relay prototype was deleted.
- **`external-harnesses` becomes vendor-neutral.** It keeps the drivers: ACP, terminal, hooks ingress, installs, births and seats, and the `AskPrograms` filler. Every vendor fact it reads comes from the registry's harness providers.
- **Registry lifetime.**
  - `HarnessRegistry` gains withdraw and replace. Today it has neither, and it dies on a second registration (`threads/harness/registry.ts:11-16`).
  - Contributions follow the registry's changes stream on install, update and removal.
  - A harness id is a durable string, readable without the package installed. Availability is checked at the acts that need the implementation: birth, turn, move, fork, ask.
  - A hosted runner resolves to the concrete builtin package build, and is replaced at rest with its run and pending words kept, the way build replacement already works (`protocol/process.ts`).
  - An installed package's program ask holds its package version until the ask ends, and a terminal session launched from an installed harness holds the version it was launched from until the session ends; that session's hook process keeps loading its codec from that version after an update or removal. Install, update, removal and boot never delete a version directory a live process holds (`providers/adapters/installs.ts`).
- **Names and the app.**
  - `HARNESS_NAMES`, `HARNESS_LABELS` and `harnessAdapter()` are removed. `HarnessAdapters` holds the rows: the builtin catalog plus every installed harness provider, following `providers.changes`. An act resolves its row with `row(id, install)`, which refuses `harness-not-installed` with the install hint stored on the thread; a read uses `find` and degrades when the row is gone. The builtin catalog (`vendors/builtin.ts`) remains until the last vendor moves.
  - `threads.harnessTransport` and `threads.harnessProfile` are checked at write by `ManagedWrite` writers against the rows `HarnessAdapters` holds then; a key no installed harness offers refuses `setting-value`.
  - The app moves from the static labels to the served presentation (label, mark, icon; `table.ts:42-55` already serves them). That affects `external/Terminal.svelte`, `proofs.ts`, `transport.ts`, `native/modelWords.ts`, `launch.ts`, `HarnessMark.svelte` and `ColumnHead.svelte`.
- **Stored capabilities.** A thread's capabilities are copied into its seat at birth (`birth/seat.ts:14-91`). Where a changed declaration must reach existing threads, a step re-derives them; elsewhere they keep their birth values, as today.
- **Declarations that need checking:**
  - The birth install check (above).
  - The library descriptions: each `harness:<id>` type's is composed from its declared surfaces (`harnessSpawnTypes`), and the base `harness` agent's names no vendor and no fixed fact about one.
  - A vendor-run ACP profile's `proves` flags, compared at launch with what the agent negotiates. A claimed capability that is not negotiated refuses the launch and names it. Hosted profiles keep `proves.fork` and `proves.rewind` meaning "available, by the vendor's extension or by Tagma rebuilding the session from the journal". That is how Cursor and OpenCode fork and rewind today, and no check removes it.

## Migration

1. The public contract types and their lowest wire types.
2. `HarnessName` becomes a validated id. `harnessAdapter()` becomes a registry lookup, fed by the existing static rows. The app moves to served presentation. The hook design is measured and landed. No vendor moves.
3. Registry withdraw and replace, and the behaviour for a removed harness.
4. The first vendor moves: Grok or Gemini, which are terminal only. This proves the contract with the smallest surface.
5. Claude Code: terminal, hosted runner, and the program declared in Part 1.
6. Codex, Cursor, OpenCode and Devin, one per landing.

Each landing deletes that vendor's server code, and moves its tests into its package, where they stay green. Behaviour does not change, and builtin ids keep their spelling, so stored rows, settings and sessions need no migration of ids.

## Acceptance

1. The parent's string inspection holds for `external-harnesses` outside `steps/`.
2. A test package installed with `install_adapter` in an integration world declares a fake terminal CLI with its own hook codec and metadata reader, in a shape no builtin vendor has. Then:
   - it is listed as a harness;
   - `create_thread` with `harness:<its id>` launches its program through the terminal transport;
   - its hook event is parsed by its codec, through the hook process;
   - after removal, the existing thread still reads, and a new turn refuses `harness-not-installed`.
3. When the test package is updated while one of its program asks runs, that ask finishes on the old version and the next one uses the new version.
4. A birth of a harness whose program is not installed refuses `harness-not-installed`, with the package's install hint, before any process starts.
5. A vendor-run ACP test profile that claims a capability its agent does not negotiate refuses at launch, naming the capability.
6. With `threads.harnessTitle && threads.autoTitle` false, a surface that has a title switch launches without its title call. With the condition true, the title the CLI writes is taken.
7. The hook ingress benchmark stays within its budget.
8. In the change that lands the last vendor, the server builds and boots with one builtin vendor's package removed from its dependencies and host modules, and none of that package's code ships.

**Proof.** Integration tests through `install_adapter`, `create_thread`, the turn door, the hook door and the settings door, with the test package. The parent's string inspection. The hook benchmark. Each vendor's existing tests move into its package and stay green.
