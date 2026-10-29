---
id: 01a16472-6102-7eea-b3b2-337e6b694470
title: "The Tagma agent on the OpenCode V2 engine: a private CLI host, Tagma tools, and OpenCode providers with no OAuth port"
ord: 109
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a10510-45fb-7c7a-9c43-d16d378e9604
  - kind: relates
    to: 01a12c56-9126-7a2a-902e-aaa4ada7eee0
  - kind: relates
    to: 01a16434-fc60-7079-91d8-189d050e0330
  - kind: relates
    to: 01a16434-fc60-7079-91d8-189eb81e55d7
---
The user picks a model from a connected OpenCode and gets an ordinary Tagma agent thread: graph, context, tools, permissions, and authorship stay with Tagma, while a real OpenCode runs the conversation with providers and its own agent loop. The added value is OpenCode's providers and logins — above all the officially supported GitHub Copilot — with no port of its OAuth into a foreign client. OpenCode Go stays a separate model provider; this work never changes it.

## Surface choice and evidence

The target is OpenCode V2, the official CLI and `@opencode/client` 2.1.3 with the public plugin API. The CLI ships in delivery: the `@opencode/cli` dependency installs the native executable with its official postinstall generator, cut carries that package, and the boundary resolves the executable relative to its manifest; the user PATH and node_modules are never needed. On 22 October 2026 npm serves `opencode-ai` 1.19.4 and `@opencode/cli` 2.1.3 at once: different API generations. The local reference checkout is V2 2.0.29, so the critical types are checked against tag v2.1.3 and the installed npm packages. OpenCode was never on PATH; isolated CLI probes confirmed 1.19.3 and 2.1.3, the user login never changed.

The choice is a private `opencode serve --stdio --port 0` on loopback with a system-picked port and a random password, one subprocess per hosted runner. That is an unregistered server: no `--service`, no lookup of a user's background service. Readiness answers over JSON, an EOF on stdin is the lease: a dead held runner closes the private host with no orphan daemon. It is driven by the official [client API](https://dev.opencode.ai/v2/docs/build/client/), with one public [plugin](https://dev.opencode.ai/v2/docs/build/plugins/) replacing the system and the tool registry. `ToolContext.id` gives the model's real call id. No native Tagma loop is built over extracted OpenCode OAuth.

Embedded `@opencode/sdk` was the first candidate and was checked with a real loop against a local fake upstream API. The probe confirmed system replacement, JSON Schema custom tools, the original id, and `session.step.streamed` before a result returns. It also showed one `codemode:false` is not enough: OpenCode adds `execute` after the registry transform; the public `session.context` must keep only the Tagma catalog names.

Review accepted two P1s. V2 credentials and conversations belong to one Database, so per-thread SQLite never gets an account profile's login through HOME. Also `sdk/src/internal/host.ts` starts `SessionRestart.resumeSuspendedSessions` unconditionally: a per-thread DB could continue an interrupted turn with no hosted run, and a shared account DB could raise someone else's session. The choice is a private serve with a shared account DB: `server/src/process.ts` launches restart continuity only under a managed lifecycle, and a CLI default/stdio server never passes such a lifecycle. `core/src/session/execution/restart.ts` directly tells apart unregistered servers, which never sweep the shared DB. That is checked on current tag 2.1.3. An interrupt after an embedded create never fixes the race and is not used.

Direct ACP is not chosen: its own system, tool set, and exact execution still need a plugin. V1 is not chosen: the public ToolContext declares no callID; runtime spread and a WeakMap of args→id are an implementation dependency. T3 is only a reading reference; its code is not copied.

GitHub [officially supports OpenCode](https://github.blog/2026/01/16-github-copilot-now-supports-opencode/) for Copilot Pro/Pro+/Business/Enterprise. A real OpenCode is used through documented APIs/plugins, with no copy of OAuth client ids. Identity reports the real app. Availability and the organization's conditions are decided by the connected upstream; a refusal is never replaced with another login or a free model.

## Owners

`external-harnesses/runner/opencode/` — the adapter of the existing hosted-runner kit's loop. The kit holds the runner process's ACP session, turn opening, the relay, output, history, and the door to the server; the OpenCode runner never copies these mechanisms. Only the boundary owns the private subprocess, the client, the plugin, and event translation. Only the boundary touches OpenCode runtime types. `cycle.ts` implements the existing `Cycle`/`Session`; neutral kit types never change for the SDK.

`packages/adapter-opencode/` declares the `opencode` harness provider, accounts, and the catalog. One vendor boundary for launching/connecting to private OpenCode serves the catalog and the runner; there are never two CLI launchers, endpoint parsers, or account-directory resolvers. This provider exports no LLM client and is never picked as a native wire transport.

The existing landing owner picks the account and hands its directory/environment to the runner. The async catalog gets the same resolved CLI-account address — never read through wire ModelCredentials. The missing typed catalog context is added at the provider-catalog owner and agreed with the Cursor team before edits. Changes to the shared kit, account, landing, catalog, and compaction contracts only happen after that agreement.

## Account, process, and storage

A Tagma account is an OpenCode profile with several possible upstream logins. Official `opencode auth login --standalone` and safe JSON status connect Copilot, BYOK, and other allowed logins in its environment. Credentials and vendor conversations sit in the account-level OpenCode DB; no export/import of tokens and no thread-local refresh copies. Deleting a directory account drops the Tagma record, while the login stays with its owner, as with other CLI profiles.

Each runner launches a private unregistered serve in that account environment. SQLite WAL and session ids admit reads and separate conversations; a second thread's launch never sweeps the first. The account DB and credential refresh are never deleted with the thread; the vendor conversation stays there, as another CLI's history. The thread scratch holds the plugin/config/tmp and its session address, never copies of secrets. Same CLI versions share one account DB; an unsupported version answers with an explicit refusal before any work with it.

Before serve launch, the boundary sets its own config/project roots and drops an inherited explicit config. The hosted plugin replaces the primary system and the tool surface. User and project plugins/instructions never arrive through a second owner; system/MDM policies stay, and their refusal is never detoured with a fresh HOME. Snapshots, filewatcher, formatters, LSP, sharing, updater, and warming are off. Account credentials and config are kept apart from the runner's temporary config. Outside those declared roots the runner writes no service files.

The subprocess lifetime belongs to the runner scope: start → endpoint/readiness → work → close/exit, with no managed service and no leftover daemon. A held runner survives a Tagma server restart inside the execution host; the SDK loads only there. A dead private serve is an explicit death of the vendor boundary and the current prompt's end — never a silent restart and word repeat.

The ACP `sessionId` is the OpenCode id. Load before replacing the standing session checks the id, cwd, the last durable Execution terminal, and the vendor inbox fate; a new host's process-local idle is never counted as the old turn's completion. A finished conversation continues by id. An unfinished one after a process death never auto-resumes: the boundary answers notFound, and the existing hosted road starts a session from the Tagma journal. That way the server never executes an old callback with no live hosted run. External side effects of unknown outcome are never declared cancelled or executed twice.

## Models and UX

The ordinary Tagma picker shows OpenCode models as `<providerID>/<modelID>` ids, their names, declared context/output sizes, vision, and variants as reasoning with no invented shared scale. The catalog holds text/tool-capable models of the picked profile that are available. The unknown stays unknown; extra parameters only appear on a proven OpenCode API surface.

`AcpProfile.serves:'opencode'`, `hosts:'tagma'`, `toolCatalog:'turn'`. That is the Tagma agent on the OpenCode loop; the model is picked in the ordinary picker under OpenCode, the thread row and chat are the same as native, with no technical ACP caption. A separate `harness:opencode` launches the bundled OpenCode V2 as a terminal CLI with its own tools and Tagma integration. Only that road is offered in "CLI agents", with the OpenCode mark and a terminal icon. Hosted and terminal share no session; no transition between them is declared.

The existing ModelCatalogs keep the last-good snapshot, read the default account on login/switch/refresh, and show the failure reason; the adapter never writes a second cache. Quota with no public OpenCode API shows unknown with a reason, never derived from token usage. The catalog never promises access a model the upstream account refused.

## The turn and the tools

The kit calls `open_hosted_turn` and `read_hosted_tools` before the prompt. The runner freezes the run system and admitted schemas for the turn. The plugin in `session.context` serves only Tagma's system, then turn context/guidance and words. Old system and ambient instructions never pile up next to it. Title/maintenance requests never get the primary prompt by accident.

`tool.transform` drops builtins and adds exactly the Tagma descriptor set with original names and JSON Schema. `options.codemode:false` keeps direct tools; `session.context.tools` also excludes the generated `execute` and everything outside the catalog. The plugin never reads/writes the checkout and never launches a shell. Before the prompt, the runner hands the frozen system/catalog to the plugin through one declared OpenCode RPC `tagma.prepare`; the plugin reloads the registry with the public reload. `execute(input, context)` POSTs `{sessionID,messageID,id,name,input}` with the original `context.id` to one loopback HTTP endpoint of the runner, declared in the plugin options with the process secret; the boundary decodes the request and calls the shared Relay → `call_hosted_tool`. The answer carries content/failed; a cancel outcome is never masked. That is the only IPC callback, not a second executor: law, review approval, authorship, and the action order belong to the native door. There is no second permission loop.

The whole catalog goes to the turn through the existing `toolCatalog:'turn'` capability. The next turn applies a new snapshot through the public reload; mid-run deferred exposure is not claimed. Rules check on every execution regardless of the earlier offered schema.

Text, thoughts, tool in/end, phase, spend, and the turn end translate into the kit's neutral Output. `_tagma/said` lands after all calls of the message, on the `session.step.streamed` fact, before the first tool result returns. The callback waits for the seal, while the SDK stream reads another fiber; the source and the offline probe exclude deadlock. Shared Handed/Output tell a Tagma-executed callback from a vendor-dropped one before the relay apart, and never spend an id on partial input.

Spend comes from completed-request token events; the turn-total spend never counts it twice. Cost shows only on a measured basis. No promised cache lifetime — warmth is unknown, automatic recap off. Words mid-turn wait for the turn's end: the first delivery has no second inbox over Tagma. Cancel calls `session.interrupt`, waits for the actual end, and answers cancelled; an unclear failure never becomes an empty successful result.

Fork and rewind use the existing hosted road of a new session from the Tagma journal with image bytes in their places. File reverts/snapshots of OpenCode are never called in a shared checkout. Compaction is foreign with a journal retelling on another picked model and a vendor-session reset; its own auto-compaction is off. Side question and own-compaction are never declared without a full contract. Capabilities: every-call law, recorded authorship, full feed, history through the journal, continue, after-turn input; usage/vision only on confirmed values.

## Acceptance and checks

1. A choice of an OpenCode model and a pinned account gives birth to an ordinary Tagma thread; messages, thoughts, calls/diff, and the turn end render in the existing feed.
2. Every tool executes on the native door: the law before the side effect, approval in review, recorded authorship; on the upstream wire — only Tagma's tools and system.
3. Several calls of one message keep real ids and the seal before results; cancel on an unfinished tool never double-executes or starts a new prompt with no operator words.
4. Two threads of one profile run apart; launching the second never continues the first; deleting one never deletes credentials. A finished session loads after the process closed; an unfinished one starts a new session from the Tagma journal with no autonomous recovery.
5. A model/variant/catalog switch applies on the next turn; an account switch recreates the process with the existing landing owner. Fork/rewind/foreign compaction get fresh history, pictures included.
6. Service records stay in account storage and thread scratch; no checkout snapshots/reverts. The private subprocess closes with the runner. The built install works with the official CLI, importing neither .external nor user node_modules.

The implementer proves the mechanism with a real OpenCode against a local fake upstream API: catalog/system, callback identity and batch/seal, refusal/cancel, load, two threads of one profile, and account lifetime. That never proves a paid request or enterprise policies. Minimal tests guard the public SDK boundary, hostedAgent→vendor port, and catalog/account parsing; `bun run typecheck` of the touched packages, owner tests with fan-out ≤3, rules/format on submit_work. After the checks — one independent delivery review. Live login/a paid request is checked only with an allowed account available; the missing is marked unproven, and the operator's glance never becomes a completion criterion.
