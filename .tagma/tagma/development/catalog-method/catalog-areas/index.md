---
id: 01a14b9b-c833-7926-a281-4743cb83ce5d
title: Catalog areas
ord: 1
---
The whole Tagma product — server, application, desktop, CLI, agent runtime — is split into 12 feature-catalog areas. One oracle reads each (Opus xhigh, 1M window) from the surface down and writes one record per feature. Areas are cut by what the user gets: a module serving several areas is split by its operations, settings, and screens. The full mapping table is child block [[1310e014]]: every operation, setting, CLI verb, agent tool, screen, route, server module, and package stands in exactly one area.

## Size reference

The "agents and collaboration" area is already read this way: [[f8fe83a4|A1 catalog, Opus xhigh run]] — 35 records, ~74K characters, one run in 141 steps; the oracle's context reached 485,669 tokens of 850,000 before automatic compaction (57%). Its surface became area A1: the operations named in its records plus the unnamed doors of the same features (hosted doors `harness-run`, `list_thread_window`, `locate_thread`); only `read_attention` and `mark_thread_seen` went to A2. The A1 measurement is the ceiling: an area fits when none of its measures notably exceeds the A1 measure and 15–35 records are expected. Fewer than ~15 records means the area is trivial and merges with a neighbour.

## Areas

| | Area | Ops | Settings | CLI | Tools | Contract | Server | App | Packages (kit) | Records |
|---|---|---|---|---|---|---|---|---|---|---|
| A1 | Agents and collaboration | 86 | 25 | 14 | 6 | ~9.6k | ~73k | ~16.5k | agent ~68k, acp | 35 (measured) |
| A2 | Conversation and attention: chat, thread context, "Attention", phone | 20 | 7 | 1 | 3 | ~1.6k | ~11k | ~8k | chat-ui, activity ~18k | 20–24 |
| A3 | Knowledge graph: blocks, work, review, journal | 51 | 1 | 3 | — | ~5.5k | ~25k | ~7.6k | ~1k | 28–32 |
| A4 | Project and its law | 26 | 6 | 9 | — | ~3.8k | ~30k | ~2k | inspection 12k, code-facts ~5k | 24–28 |
| A5 | Code: checkout, files, edits, commits, worktrees | 45 | 10 | — | 8 | ~7.3k | ~47k | ~13.3k | git, editor, agent-tools ~15k | 30–34 |
| A6 | Executions: terminals, commands, sandboxes, machine | 41 | 44 | 3 | 1 | ~6.1k | ~33k | ~18.5k | execution-host, executions ~49k | 26–30 |
| A7 | Models and providers | 22 | — | 2 | — | ~1k | ~6k | ~4.1k | llm and 14 adapters ~29k | 16–20 |
| A8 | Speech | 22 | 17 | — | — | ~1.5k | ~8k | ~6.6k | speech, audio ~16k | 18–22 |
| A9 | Web: built-in browser and agent web tools | 21 | 4 | — | 2 | ~1.6k | ~8k | ~2.4k | cdp, cookies ~2k | 15–18 |
| A10 | Extensions: skills, MCP, apps, views, pages | 26 | 12 | 1 | 1 | ~2k | ~7k | ~2.7k | mcp ~3k | 18–22 |
| A11 | Tagma on the machine: access, install, updates, window | 12 | 2 | 13 | — | ~1.6k | ~15k | ~0.1k | desktop ~9k | 20–25 |
| A12 | Shell and utilities: settings, navigation, operation doors, diagnostics | 10 | 7 | 1 | — | ~1.8k | ~7k | ~13k | performance, layer, query ~19k | 15–18 |
| | Total | 382 | 135 | 47 | 21 | | ~270k | ~95k | | ~285 |

Ops — catalog operations; Tools — native-agent tools outside the catalog; Contract — `contract/` module lines of the area; Server and App — lines of code outside tests. The largest after the reference are A5 and A6: by operations, contract, and server they sit below A1; A6's app is larger than A1's, but that is terminal rendering, and 39 of its 44 settings are terminal styling and behaviour covered by 2–3 records.

### A1 · Agents and collaboration (reference)
How threads and agents are born, which models they run on, delegate, correspond, assign work, interrupt, stop, continue, and branch each other, how reports return, and how the operator sees and leads the team; foreign CLIs as threads; agent definitions.
- **Owns:** `threads` (55 operations: birth, turns, collaboration, approvals, operator notes, folders and pins, archive and delete, thread reads and search), `native-harness` (17: thread model, defaults and favorites, compaction, tool calls, workflows, agent definitions, instruction refresh), `external-harnesses` (14, with hosted `tagma harness-run` doors), `thread-record`; delegation, approval, agent type and model settings, keep-warm, compaction, headers, and CLI-thread settings; CLI `ask`, `reply`, `steer`, `stop`, `continue`, `compact`, `unqueue`, `threads`, `thread`, `workflow`, `hook`, `review`, `harness-run`, `mcp-serve`; tools `compact_agent`, `rewind_agent`, `set_agent_model`, `read_models`, `ask_user`; in the app — `features/threads` without the chat surface: thread list and tree, team, thread birth, agent library, CLI-thread terminal, model picker, rewind, compaction, slash commands of these features.
- **Leaves:** feed, composer, thread context, recap, "Attention", and phone — A2; provider connections — A7; app skills and views — A10; CLI-session orientation outside threads — A4; call threads — A8; worktree creation — A5; sandboxes — A6. The probe record [[739b512c]] also spoke of the counters of what waits for the operator: team counters in the thread list — A1, the "Attention" list itself — A2.

### A2 · Conversation and attention: thread chat, its context, "Attention", phone
How the operator reads and writes a thread, what thread context consists of and holds, how a thread is remembered, and how Tagma calls the operator — in "Attention", by push, and on the phone.
- **Owns:** feed and composer (drafts, attachments, prompt history, deferred messages, recap cards, run-end and start cards), transcript reads (`read_thread_snapshot`, `read_thread_entries`, `read_thread_entry`), context composition (`read_thread_composition`, `agent.startShare`, `agent.toolOutputShare`, the `read_tool_output` and `tool_search` tools), what a thread holds (`read_thread_held`, `held_resources`: attachments, scratch, rollout, terminals), recap (`generate_thread_recap`, `threads.recap`), thread-record durability (`threads.idleProjectionDays`, `read_thread_rollout`, `repair_thread_rollout`), the activity record (`tagma activity`, `activity.*`), "Attention" (`read_attention`, `mark_thread_seen`, `send/answer/dismiss_notification` notifications), phone (pairing and devices `remote`, `remote.enabled`, push, mobile shell, shell choice, `/pair`, device admission); the `/chat` route.
- **Leaves:** turn control, thread reads and search, headers — A1; tool cards in the feed — the tools' areas; voice input in the composer — A8; slash commands — their features' areas.

### A3 · Knowledge graph: blocks, work, review, journal
How a project holds knowledge as one graph — blocks, tags and vocabulary, sources over code, work lifecycle, review amendments, journal and history, trash — and how it shows in the application.
- **Owns:** `graph` (49: writes, reads, search and queries, briefs, path owners, sources, claim/finish/close/release/supersede, amendments, journal and diff, trash, writer sessions), `reflections` (reflections into Tagma's graph, developer only), `catalogs` and `graph.catalogs`; CLI `trash`, `edges`, `sessions`; `features/graph` (outline, block page with body editor, journal, filters, statuses, read state, authors, spatial view), routes `/graph`, `/journal`, `/b/[id]`; graph-tool feed cards, ToolBlockDiff, BlockCard, BlockRefText from threads.
- **Leaves:** project registration, graph storage and sync, branches, conflicts and recovery, law and its delivery — A4; launching reviewers with `tagma review` — A1, their `read_review_brief` — here.

### A4 · Project and its law
How a checkout becomes a Tagma project, where its graph lives and how it reaches the branch, and how project law reaches agents and judges their changes.
- **Owns:** registry and storage (`add_project`, `remove_project`, `set_project_root`, `set_project_storage`, `set_project_policy`, `list_projects`, `read_project`, `list_branches`, `sync_graph`, `rewrite_graph_files`, `resolve_graph_conflict`, `read_graph_recovery`, `start_graph_recovery`, `graph.commit`, CLI `project`, `files`, `merge-driver`), Tagma installation into a repository (CLI `install`, `upgrade`), law (`set_rule_delivery`, `set_rule_enabled`, `read_law`, `rules.global.*`, CLI `law`, `disable`, `enable`), on-place orientation and delivery (`session_start`, `first_prompt`, `touch_path`, `orientation.mapBudget`), enforcement (`check_rules`, `enforce_rule`, `read_enforcement`, `read_inspections`, `record_commit`, `set_module`, CLI `check`), comments (`writing.comments`, `strip_comments`); the `/rules` screen, the Writing and Graph files settings sections, the recovery banner from `features/graph`, the new-project dialog with catalogs, `apps/tagma/inspection` (8 builtin inspections in 3 packs and runners of external programs).
- **Leaves:** graph content and vocabulary — A3; commit landing and commit steps — A5; what hooks do inside foreign CLIs — A1; project switching in the window — A12.

### A5 · Code: checkout, files, edits, commits, worktrees
How operator and agents work with code: read and edit files, see changes and whose they are, commit, pull and push, move work to its own worktree and merge it.
- **Owns:** `workspace` (10: checkout state, history, and commit, stage/unstage/discard, fetch/push/abort, storages), `checkout-files` (10: file-tree state, Quick Open, edit save, file trash, reveal, file outside projects), `change-record` (4: line authorship, session holdings, hook edits, thread-line rollback), `landing` (7: `submit_work`, `commit_checkout`, `pull_checkout`, worktree check and merge, PR), `commit-steps`, `worktrees` (12) and `update_worktree`; `checkout.*`, `editor.*`, `worktrees.*`, `agent.checkout`, `agent.autoCommit`; tools `read`, `write`, `edit`, `glob`, `grep`, `ls`, `delete`, `rename`; `features/checkout` (`/checkout`), `worktrees`, `opening`, the worktree switcher in chrome.
- **Leaves:** moving a thread to a worktree and `agent.worktrees` — A1; the rules court over a commit and the comment policy — A4; `bash` — A6.

### A6 · Executions: terminals, commands, sandboxes, machine
Where operator and agent processes run: terminals and their custody, bounded commands and their deadlines, command rules, sandboxes, machine load and wakefulness.
- **Owns:** `executions` (34: terminals, operator lanes, bytes and screen, ports and processes, commands and waits, command rules, machine load, residual processes), `sandbox` (7: guests, prepared trees, output import), `power`, `mac-user-environment`; `terminal.*` (39), `host.memoryShare`, `power.*`, `agent.checkoutWorld`, `agent.commandDescription`; CLI `command`, `execution-host`, `sandbox`; the `bash` tool; `features/executions`, `power`, the load panel and wake controls in chrome, bash cards in the feed.
- **Leaves:** thread placement in a sandbox at birth and CLI threads as threads — A1; the load button as a status-bar segment — A12.

### A7 · Models and providers
How Tagma reaches models: subscription sign-in, keys, and CLIs, accounts, defaults and quotas, console keys, provider adapters and their instances.
- **Owns:** `providers` (22), CLI `auth`, `adapter`; `features/providers`, quota counters in chrome, quota cards in the feed; the `llm`, `credential-file`, `tagma`, and 14 `adapter-*` packages.
- **Leaves:** thread model choice, defaults, favorites, model menu — A1; speech-provider keys stored as console keys — A7 owns the storage, their use — A8.

### A8 · Speech
Voice in Tagma: dictation into a field and into any application, call recording and recognition, transcripts and their delivery to threads, synthesis, local recognition models.
- **Owns:** `speech` (22), `speech.*` (17); `features/speech` (Settings → Speech, `/calls` calls, voice input in the composer), the `/_desktop/dictation` dictation pill and key hold in desktop; the `speech*`, `audio*`, `echo`, and `desktop-input` packages.
- **Leaves:** key storage — A7; the desktop window — A11.

### A9 · Web: built-in browser and agent web tools
A built-in browser for operator and agents, and what agents search and read the web with.
- **Owns:** `browser` (21: pages, actions, snapshots, console, network, downloads, profiles, cookie import), `managed-browser`, `desktop-browser`; `browser.*`, `agent.web`; the `webfetch` and `websearch` tools; `features/browser` (`/w`), browser-tool cards in the feed, the browser host in `apps/tagma/desktop/src/browser`; the `cdp` and `browser-cookies` packages.
- **Leaves:** desktop windows — A11.

### A10 · Extensions: skills, instruction files, MCP, apps, views, pages
What extends the agent and the window beyond the built-in: project skills and instruction files, MCP servers and their App views, Tagma apps with views, pins, secrets, and schedules, pages agents publish.
- **Owns:** `mcp` (7), `plugins` (4), `views` (4), `secrets` (3), `artifacts` (CLI `artifacts`), `schedule`, `pin_view`, `unpin_view`, `read_agent_skills`, `read_workspace_sources`, `reload_workspace_sources`; `skills.*`, `agent.contextFiles.*`, `mcp.servers`, `plugins.*`; the `load_skill` tool; `features/mcp`, `plugin-views`, `views`, `secrets`, `pages`, routes `/p/[...path]` and `/_desktop/view/…`, view windows on desktop, the skill catalog in the composer, SkillsSection.
- **Leaves:** agents and workflows brought by apps — A1; bridge notifications — A2.

### A11 · Tagma on the machine: access, install, updates, window
How a human gets and keeps Tagma: the rights document, install, updates, restart and rollback, channels and world moves, the desktop window.
- **Owns:** `installation` (8), `access` (4), `release-channel`, `checkout-builds` (developer only), `mac-applications`; `release.feed`; CLI `serve`, `db`, `restart`, `status`, `switch`, `quit`, `transfer`, `web`, `desktop`, `build`, `update`, `release`, `install-from`; `features/access`; `apps/tagma/desktop` (project windows, release, exit and stop, wait page), release-composition `composition/cut` (developer only).
- **Leaves:** dictation — A8; view windows — A10; browser — A9; phone — A2.

### A12 · Shell and utilities: settings, navigation, operation doors, diagnostics
The frame everything else works in: the settings screen and layers, navigation and projects in the window, palette and keys, status bar, connection state, operation doors, and server diagnostics.
- **Owns:** `settings` (3), `performance` (6), `invocation` (`read_operations`), `http`, `socket`, `cli` (`tagma op`); `appearance.loadInStatusBar`, `telemetry.*`; `features/settings` (`/settings`), `projects` (project strip, warm projects), `workspace`, `palette`, `notices`, `telemetry`, `lib/app/chrome` minus the parts other areas name, `panes`, `keys`, `lib/wire`, routes `/` and `/[project]`.
- **Leaves:** each key's meaning — its area's table; `mcp-serve` and `hook` — A1.

## Cross-cutting features
- **Approval modes and operator questions** (trust, review, bypass; `answer_question`, `ask_user`) — A1; other areas name only which of their acts ask.
- **Law delivery on place and session orientation** — A4; A5 file tools and foreign-CLI hooks (A1) are only carriers.
- **Every edit's authorship** — agent tools, operator editor, commands — A5.
- **Settings as a mechanism** (screen, scopes, layers, agent rights) — A12; a key's meaning — its area by the table.
- **Operation doors and answer shape** (HTTP, live socket, `tagma op`, refusal with code/reason/unblock, `project` and act place) — A12; doors for foreign CLIs (`mcp-serve`, `hook`, `session_start`) — A1 and A4.
- **Tool cards in the feed** — the tool's area: bash — A6, browser — A9, graph — A3, MCP App and plugin views — A10, quota — A7, dictation in the composer — A8, compaction and model — A1; the feed itself — A2.
- **"Attention"** — the list, its rows, and notifications — A2; why a thread waits (question, refusal, run end) — A1.
- **Worktree and thread:** creation, merge, `update_worktree` — A5; `move_thread` and worktrees for children — A1.
- **Sandbox and thread:** sandbox — A6; thread birth in it — A1.
- **Thread headers** — A1; recap — A2.
- **`tagma install`** puts law, skill, workflows, and hooks into a repository — A4; hook and workflow behaviour — A1; skills — A10.
- **Code comments** — A4; commit steps — A5.
- **Thread model** — A1; provider connection — A7.
- **Desktop:** window and release — A11; dictation pill — A8; view windows — A10; browser host — A9.
- **Mobile shell** as a frame — A2; its tabs' content — those features' areas.
- **Product-work records:** the activity record — A2; thread reads (`read_thread`, `read_thread_record`, `search_threads`) — A1; server telemetry — A12.

## Method and measurements
All counted 2026-10-17 on the `/opt/workspaces/runlith` working tree.
- **Operations:** `tagma op` listed 382 when the table was made; the app operations it counted are now the four plugin operations, so the table holds 381. Split by module: graph 67, threads 64, executions 34, native-harness 25, speech 22, providers 22, browser 21, external-harnesses 14, worktrees 12, workspace 10, checkout-files 10, installation 8, sandbox 7, mcp 7, landing 7, performance 6, enforcement 6, plugins 4, change-record 5, views 4, remote 4, access 4, settings 3, push 3, secrets 3, notify 3, reflections 2, schedule 1, invocation 1, commit-steps 1, artifacts 1.
- **Settings:** `read_settings` for runlith — 133 keys in 23 sections; plus `release.feed` (declared only in the release build) and `terminal.lastGrid` (written by the terminal itself) — 135 total. Keys declared only in tests were not counted.
- **CLI:** 45 top-level verbs in developer-build `tagma --help` plus `release` and `install-from` in the release build — 47; with subcommands — 85 `Command.make`.
- **Agent tools:** the `tagma` agent catalog — 221 tools, 210 of them operations; outside the operation catalog 11 (`bash`, `read`, `write`, `edit`, `glob`, `grep`, `ls`, `delete`, `rename`, `tool_search`, `ask_user`) plus 10 more arriving at thread birth from collaboration, skills, fork, output, web, and resources sources (`compact_agent`, `rewind_agent`, `set_agent_model`, `read_models`, `fork_thread`, `load_skill`, `read_tool_output`, `held_resources`, `webfetch`, `websearch`) — 21.
- **Application:** 26 `features` folders (~85k lines, largest threads 22k, executions 17k, checkout 10k, graph 8k, speech 6.6k), `lib/app`, `lib/shared`, `lib/wire` shell and routes — ~14k; 15 page routes.
- **Server:** 47 module folders, ~286k lines outside tests; `platform` (~10k) and `composition` (~6.5k) are substrate with no surface of their own, their `serve` and `db` verbs belong to A11.
- **Lines** are `wc -l` over `.ts` and `.svelte` without `*.test`, `*.itest`, `*.stest`, `*.bench` and `testing/`; shares of split modules (graph, threads, native-harness, change-record, features/threads) are estimated by subfolder and file, hence the "~".
- **Records** were measured only for A1; the rest estimate by distinct surface capabilities.
- **Reference** — probe-thread `01a14b5a-42b0-7266-94d4-64482b0b875b`: its task, report, and context measurement read from its record; of the 90 operations named in its records, 79 stand in A1, 2 in A2 (`read_attention`, `mark_thread_seen`), 9 with neighbours A3, A5, A6, and A7.

## Outside the catalog
Development and test packages (`dev-runner`, `effect-test`, `testing`, `tsconfig`, `vite-browser-guard`). Shared mechanisms with no surface of their own — the `utils`, `sqlite-process`, `ndjson-rpc`, `file-lock`, and `paging` packages and the `platform` and `composition` modules — stand in the table as substrate: an oracle reads them only under its own area's feature.
