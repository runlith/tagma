---
id: 01a19560-3243-79c3-b6f8-cebb2a6213d4
title: "Muse Code subscriptions run Tagma threads through the official CLI: a hosted runner over `muse serve`"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bf8d7d24be1
  - kind: relates
    to: 01a18e33-3513-785d-9824-df6d3c2426a1
  - kind: relates
    to: 01a19543-e28b-72c2-95c9-7181e698aca6
---
## Outcome

A Tagma agent runs on a Muse Code subscription by choosing a Muse Code model in the model menu, exactly as it runs on Claude Code: the thread stays a Tagma thread — its prompt, tools, law, graph, children, journal and feed — and the Muse Code CLI the user installed and signed in to carries the model loop. The work takes everything that brings such a thread to a native one; what stays different is only what the CLI itself makes impossible, named under "Vendor-side limits" with the fact behind each. The Model API key provider `muse` stays as it is.

## Why this road

Since 2026-10-29/30 `api.meta.ai` answers `403 client_attestation_denied` to a key billed to a Muse Code subscription unless the request comes from Muse Code; Meta's subscription page says the subscription "works only through the Muse Code CLI while signed in", and pay-as-you-go keys are unaffected. Meta documents `muse serve` with `@muse-code/sdk` as the way to drive a Muse Code session from one's own program, and T3 Code ships Muse that way. Requests then leave from the CLI under the user's own login: Tagma never holds the subscription credential. Live probes on 2026-11-01 completed eleven subscription turns through `muse serve` with no refusal ([[e698aca6]], whose measurements every choice below rests on; Muse Code 1.4.10, macOS).

## The launch

One `muse serve` host per thread process, one MSP session per ACP session, launched as follows.

- **Its own Muse home.** The host runs with a Muse home Tagma keeps per Muse account under its data directory — `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME` and `XDG_STATE_HOME` inside it — that reaches the user's login and nothing else of theirs: on macOS the login is one Keychain item (`ai.meta.dev.credentials`) reached through a `Library/Keychains` link, plus the CLI's `auth.json` metadata from the user's config. Measured: the user-level rules file (Muse reads `~/.claude/CLAUDE.md`), user skills, user hooks and user settings all leave the request, which shrinks from about 114 KB to 23 KB; changing only `HOME` without the link loses the login. This is what `settingSources: []` and `autoMemoryEnabled: false` give the Claude runner. Sessions live in that home, so the user's own `muse resume` list stays theirs. Off macOS the login is not in a keychain: the official Linux and Windows builds (1.4.14) carry no Secret Service, keyutils or Credential Manager code, stamp `credential_backend: file` in their session records ("off-macOS stamps `file`"), and read the config directory as `$XDG_CONFIG_HOME/muse`, else `$HOME/.config/muse`, with `USERPROFILE` standing in for `HOME` on Windows; so the account home needs only the `auth.json` link and, on Windows, `USERPROFILE` moved beside `HOME`. This is read from the binaries' strings and the bundled docs, never run: a Linux or Windows login was not exercised, and whether Muse's token refresh writes through the link rather than replacing it is not established. A platform whose link cannot be made (Windows without symlink privilege) ends the host start with the typed fault naming the link.
- **Program.** The profile names `muse` as the program its runner drives (`AcpProfile.program`): Muse has no terminal surface, and a hosted profile's argv names Tagma's own command, so the server resolves the vendor binary from this name and hands it to the runner.
- **Settings file, not arguments.** A per-thread config directory (`XDG_CONFIG_HOME`) carries `settings.json` with the launch settings, so two threads with different prompts never share one file; `-c` arguments are not used for them, since `-c` overrides the file and an argument has a size limit on Linux. Measured: a 200 KB `run.system_prompt` from the file reached the model whole; `${VAR}` is not expanded for it.
- **Prompt.** `run.system_prompt` replaces Muse's 45 KB base instructions whole, so the frozen Tagma run prompt is the system prompt, as `systemPrompt: custom` is for Claude. The host reads it once: a run whose prompt differs restarts the host and resumes the session before the first words.
- **Tools.** `run.toolset` is an exact whitelist: `mcp__tagma__*`, plus `web_search` and `web_fetch` when the server decides the run's web is the vendor's (`agents.web`, decided as for Claude). No other built-in reaches the model — no `read_file`, `search`, `bash`, memory, skill, workflow, goal or todo tool — so every read and write passes Tagma's door, and the transport declares `law: 'every-call'`, `touch: 'reads-and-writes'`, `authorship: 'recorded'`. `--disable-shell`/`--disable-write` are not used: they leave the read built-ins and add a developer message saying shell and writes are off. `--trust-workspace` is not used: Tagma delivers the project's instructions itself, and an untrusted workspace keeps the project's `AGENTS.md`, skills and hooks out of the host.
- **Slimming.** `run.reminder_roster: []` removes the reminder child sessions that ran beside each turn (18 model calls became 2) and held `turn/completed` back; `run.workflow_trigger_mode: "off"` removes the workflow tool and its cookbook; `run.context_slimming.meta_context_note_enabled: false` and `run.context_slimming.session_identity_enabled: false` remove those two blocks; `run.context_slimming.skill_catalog_descriptions: "first_sentence"` cuts the bundled skills catalog from 16 KB to 8 KB.
- **Tool channel.** The runner serves the hosted catalog as the session MCP server `tagma` over `streamableHttp` on 127.0.0.1 with a per-runner bearer header. Muse names the tools `mcp__tagma__<name>`, so no Tagma name clashes with a built-in, and the prompt says so as it does for Claude; every `tools/call` carries `_meta.callId` equal to the MSP `toolCall.callId`, which is the relay's call id. Muse lists tools once per host process: neither `tools/list_changed` nor `session/resume` in the same host re-lists them, a new host with `session/resume` does. The profile declares `toolCatalog: 'turn'`, so hosting offers every admitted schema ahead and a skill unblocking a tool needs no list change; a turn whose catalog names differ from the session's restarts the host and resumes before its words.
- **Approvals.** The default profile `:auto-review` lets an LLM judge decide calls; it is never used. Every session runs `permissionProfile: ':ask-me'` with `approvalMode: promptUnmatched`. The runner decides each `approval/request` for a `mcp__tagma__*` tool at once with `allow_once`, since Tagma's door judges that call and asks through the thread's native confirmation; measured, no judge review runs. `web_search` asks nothing; `web_fetch` asks with a `network` subject carrying host and URL under the call's `callId`, and the runner hands it to the ACP client as `session/request_permission`, which the driver judges as the vendor question `webfetch` — the road Claude's `WebFetch` hook takes. `session/fork` resets the mode, so the runner sets it again after every fork.
- **Billing route.** The host environment drops any inherited `META_API_KEY` (Muse prefers it over the login, silently moving the thread to pay-as-you-go) and sets `MUSE_NO_AUTO_UPDATE=1` so the CLI does not replace itself under a live host.

## A turn, as on native

- **Turn id.** A Tagma turn id that is a UUIDv7 is the `turn/start` `commandId`, from which Muse derives the `turnId`; any other id gets a minted one, recorded in the prompt answer's `_meta['tagma/turn']`. Session ids are minted as UUIDv7 too: Muse refuses a v4 session id.
- **Input.** Text and images go as `turn/start` parts in their order; the turn context and step guidance go first, as on every hosted road.
- **Mid-turn words.** `turn/steer` with `expectedTurnId` lands words in the running turn or refuses once that turn ended, so a word is never delivered twice; the profile declares `midTurn: 'steer'`. A steer Muse accepted is always read: drained into the running turn (a `steered` `userMessage` item carrying the steer's `commandId`), or, when the turn ends before draining it, in a follow-up turn Muse opens under the steer's `commandId`. The Tagma turn owns those follow-ups and ends only when every accepted steer was read and every turn it owns completed, or at once after an error or a stop; a Muse turn no Tagma turn owns is interrupted, and its trailing deltas and approvals reach no Tagma turn. The `_tagma/steer` answer reports the word read only when that steered item arrives; a turn ending without it answers `promptRequired`, so the core hands the word back. `turn/unqueue` cannot take back an accepted steer (measured: `missing_run`), so withdrawal answers taken back only for a steer Muse refused, or one a stopped turn never read. `turn/interrupt` cancels every open turn the Tagma turn owns; the turn is over at `turn/completed` with `cancelled`.
- **Model and effort.** Models, context limits and effort tiers come from `model/list` into the live catalog; `session/setModel` and the per-turn `reasoningEffort` apply the menu's choice between and within turns. Resume and fork reset the model to the host default, so the runner re-applies model and effort after each.
- **Reasoning.** Reasoning summaries stream from `item/delta` `summary.n` into thought chunks under the same `reasoningDisplay` setting as native.
- **Phases and retries.** Item starts drive the phase (reasoning, writing, tools, calling); `turn/retryScheduled` and `turn/modelRetryScheduled` become `_tagma/retrying` with the failure family; a compaction item drives `compacting`.
- **Measurement.** `session/tokenUsage` per model completion becomes `usage_update` with `_meta['tagma/measured']` and per-request spend; `session/contextUsage.windowTokens` is the window; `usage/changed` (session and weekly percent, reset times, tier) becomes the account's quota observation.
- **Side questions.** `aside: 'session'`: a side question opens `session/sideChat` on the thread's warm session, pins the thread's model and effort with `session/setModel` and `session/setReasoningEffort` (a side session opens on the host's default model, measured `muse-wonder-1.0-contributor`), runs one turn there, and answers with its text, per-request spend and priced cost; the main session's transcript and turns stay as they were (it only gains `sideChat` marker items). Measured on 1.4.14: three side questions about a word said only in the main turn all answered it. A side turn carries Muse's own default instructions and its own small toolset rather than the thread's, and its inherited history is not cached under the main session's key (17.6k uncached input tokens per side turn in the probe; a later identical prefix did read from cache).
- **Asks.** Titles and other fresh asks run one turn on a memory-only host (`--no-session-log`, empty toolset, the ask's system prompt) in the same Muse home.

## Sessions

- **Fork and rewind.** Both open a fresh session seeded from Tagma's journal, as hosted Cursor does; the profile declares no `_tagma/fork` or `_tagma/rewind`, so the core takes that road. `session/fork` is not used: measured on 1.4.10, a forked session loses the session MCP config (its turn fails `unknown tool mcp__tagma__*`), cannot be resumed on a new host (`missing field recorded_at`), and a cut at an earlier turn with a queued turn refuses `forkBoundaryInvalid`.
- **New session from the journal.** MSP cannot import a transcript, so a thread arriving from another road — a native model, a "last N turns" fork, a restore — gets its history as the hosted kit's neutral blocks (text with role labels, images in place) ahead of the first prompt.
- **Restart.** `session/resume` survives a host restart with history and takes the new MCP config; a turn in flight comes back `cancelled` and a pending approval is gone, both covered by the driver's ordinary run end.
- **Compaction stays Muse's.** Tagma's threshold and manual requests send `session/compact` to the same session between turns; the profile declares `compaction: true` (`session`). Muse has no switch turning its own automatic compaction off, only `context_compaction.soft_threshold`/`hard_threshold` fractions; the runner sets them to 0.97 and 0.99, so Tagma's threshold always compacts first and Muse compacts on its own only next to the window. A step request is refused by the kit: Muse refuses `session/compact` while a run is active (`commandRejected`, reason `run_active`, measured with and without a `turnId`), and only its own threshold compacts mid-turn, at a step boundary. The compaction item becomes `_tagma/compacted` with its sizes. The vendor session is never reset to a fold of Tagma's journal: that would rebuild the whole cache and turn every earlier call into text. `session/compact` takes no instructions and the item carries no summary text, so Tagma's compaction instructions do not reach Muse's summarizer and the feed shows the boundary without a retelling; Tagma's journal keeps the full history, so a move to another model compacts from it as usual.
- **Account.** The Providers screen shows the CLI's state — installed and its version, signed in or not — and signs in by running `muse login` in a Tagma terminal; Tagma holds no Muse credential.

## The prompt cache

The cached prefix of a Muse request is the base instructions, the tool list, the host's session-start developer messages and the history; the runner keeps each stable and changes the prefix only where the change is the point:

- The base prompt changes only between runs whose frozen prompt differs; turn context, step guidance and law go into the user turn, appended, never into the prefix.
- The tool list is the whole admitted catalog from the session's start; it changes only when the admitted tools change or the run's web switches between Tagma's and the vendor's.
- One approval posture for every session, so the host's `security_mode` message never differs between runs.
- A host restart resumes the same session, so the next request repeats the same prefix; nothing is re-sent as text.
- Compaction is the only history rewrite, and it is Muse's own.

## Where the code goes

- `@runlith/adapter-muse`: a second provider `muse-code` (`kind: 'harness'`, `dynamicCatalog` from `model/list`, quota from `usage/changed`) beside the key provider; `harness/acp.ts` with its hosted profile; `runner/` — `sdk.ts` the only file touching `@muse-code/sdk` (pinned exact), adapting it to the runner's own `Channel`; `home.ts` building the Muse home and its settings; `cycle.ts` on the kit's `clientSession`; `run.ts` exporting the `HostedRunner`. The module card gains the relations and entries.
- `@runlith/hosted-runner`: the MCP bridge that serves the hosted catalog and relays calls moves here from `adapter-anthropic/src/runner/bridge.ts`, taking the vendor's call-id reader and served-name prefix as parameters; Claude and Muse share it. `clientSession` gains exact steering, withdrawal, compaction and vendor permission questions for SDKs that confirm them; `clientProfile` takes `midTurn`, `web` and `compaction`.
- `@runlith/mcp`: serving an `McpServer` over streamable HTTP on loopback, beside `serveMcpOverStdio`.
- `apps/tagma/server/src/composition/adapters.ts`: the `muse` builtin gains the `muse-code` harness and its runner.

## Vendor-side limits

- Meta has not said in writing that a subscription covers `muse serve` driven by another application; it works today, and the runner reports a refusal in Meta's own words.
- The host reads its prompt and its tool list once per process: a prompt or catalog change between turns costs a host restart and a resume, and within a turn no new tool schema can appear.
- About 10 KB the host adds to every request has no switch: the bundled skills catalog (8 KB at first-sentence descriptions, while no skill tool is offered), a static memory snapshot (1 KB), workspace identity and security mode (0.7 KB).
- `session/compact` takes no instructions and returns no summary text.
- `usage/read` answers nothing until the host has run a turn, so quota appears after the first turn.
- One login per operating-system user: on macOS the login is one Keychain item, so two Muse homes share it. Several Muse accounts on one machine would need a separate credential store (`TBH_CREDENTIAL_BACKEND` exists, untested); this work ships one account and records what that variable does.
- `@muse-code/sdk` pairs with one CLI release while the CLI updates every few days; the runner refuses an MSP envelope version other than 1 and relies on the stable surface being additive.
- Isolation was measured on macOS only.
- Muse does not defer MCP tools: the whole admitted Tagma catalog rides every request (measured on a trial server: 282 tools, about 164k prompt tokens per request, cached after the first).
- The host adds a workflow-off note (0.5 KB) even with `workflow_trigger_mode: "off"`.
- Muse runs one message's MCP calls one after another, even served with `readOnlyHint: true` and `destructiveHint: false` and with `run.parallel_tool_calls: true`: its session log records `"parallel_profile":{"kind":"ineligible"}` and `tool action serialized: parallel eligibility not proven` for each call, and two 2-second calls of one message ran back to back (1.4.14).
- `session/compact` is refused while a run is active (`run_active`), and automatic compaction has thresholds but no off switch.
- MSP streams no partial tool arguments: a call's `args` arrive whole with `item/started` (upstream sent the 2.7 KB argument in two chunks), so the feed shows a call's input only once complete.
- A side turn runs on Muse's default instructions and its own toolset, with its inherited history uncached.
- The `muse` launcher replaces the CLI itself: every invocation, whatever its arguments (`--version` included), starts a background check when an hour has passed since `.muse-update-checked-at` and downloads the channel's newer binary beside the launcher, unless `MUSE_NO_AUTO_UPDATE=1`. The 1.4.10 to 1.4.14 move (2026-11-01 13:54:22 to 13:54:51) most likely came from Tagma's install discovery, which ran `muse --version` with the server's own environment and so without the variable, when a trial thread was restarted at 13:54:22 (the launcher keeps no log, so no process is proven); the adapter now declares the variable for every spawn of the harness, discovery's probe included. A new binary still arrives whenever any `muse` outside Tagma runs.

## Not proven

- A vendor `web_fetch` asking in review mode was not driven live: the trial server's thread mode moves only over the live thread channel the CLI does not expose. The road is the Claude runner's (`session/request_permission` judged as the vendor question `webfetch`); in trust mode a live `web_fetch` ran.
- A thread moved onto Muse Code from a native model: the trial server holds no native account. A move from another provider is proven live: a thread whose word was said only under Claude Code (haiku) answered it after `set_thread_model` moved it onto Muse Code.
- A side question end to end through Tagma: no operation or CLI verb asks one, and thread titles take a native-prefix road; the aside is proven at the MSP level (three answers from the main conversation) and by the runner's contract test.
- Linux and Windows logins, read from the official builds' strings only.

## Out of scope

Muse Code's TUI as a terminal harness: there Muse runs its own agent, which moves away from a native thread rather than toward it.

## Acceptance

1. With `muse` installed and signed in, the model menu offers the Muse Code models and effort tiers `model/list` returns; a Tagma thread on one completes turns with tool calls and pictures, and a cancelled, a steered, a withdrawn-word and a resumed-after-runner-restart turn each end as on Claude.
2. `muse trace inspect` of a hosted session shows the Tagma prompt as base instructions at full size, only `mcp__tagma__*` tools (plus `web_search`/`web_fetch` under vendor web), no reminder children, no judge reviews, none of the user's rules, skills, hooks or settings, and no host-added context beyond what "Vendor-side limits" names.
3. Every Tagma call is recorded under Muse's `callId`, executes at Tagma's door and asks only through Tagma's confirmation; reads and writes stand in the change record as on native; a vendor `web_fetch` in review mode asks the operator.
4. Fork and rewind continue from the cut turn; a thread moved onto Muse Code from a native model continues with its history.
5. A prompt change between runs and a catalog change between turns reach the next model request.
6. Per-request spend, the window and reasoning summaries land in the thread; the account's quota windows appear after a turn; Tagma's threshold and a manual compaction fold the same Muse session, which answers with its history afterwards.
7. Measured on a live session: the first request after a steer, after a runner restart with resume, and of a turn whose catalog and prompt did not change reports `cachedTokens` covering the earlier prefix.
8. A signed-out CLI ends the turn with an auth refusal naming `muse login`; a `META_API_KEY` in Tagma's environment never reaches the host.
9. The Claude runner's tests pass unchanged after the bridge moves; contract tests drive the Muse cycle on a fake `Channel`, and `sdk.test.ts` the adapter on a fake connection.
10. The feature [[d7d24be1]] and the module card of `@runlith/adapter-muse` say what ships; an explanation records the runner's launch and its reasons.
