---
id: 01a13666-7072-79da-a7f4-bce12fbc8082
title: "Tagma and Tagma Dev channels: two worlds on one Mac, one runs, one-button switch, integrations through one entry point"
ord: 12
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a13209-1c70-7d0c-87f4-40b2e7b7be7f
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/layout.ts
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/ports.ts
---
Tagma Dev and Tagma are two channels of one product on one Mac: each channel has its own world of data, but only one runs at a time. The operator works in Tagma Dev every day; to check what people get, he switches to Tagma, checks it in a clean world and switches back. Claude Code, Codex and Gemini always talk to whichever channel runs, and neither switching, nor update, nor move touches their settings.

Why one, not both at once: Tagma embeds into what is single per user — home settings of Claude Code, Codex and Gemini, their hooks and MCP, the operator's repos. Two servers over one shared resource need a "who is master" rule on every edge. Products of this kind do the same: Docker Desktop and OrbStack replace each other rather than run together.

## What the operator gets

- **Two apps**: `Tagma Dev.app` (from checkout) and `Tagma.app` (releases), own names, icons and macOS permissions.
- **Two worlds**: each channel its own threads, projects, settings, keys. Tagma's first launch with the operator is the same first launch the user gets.
- **Switching**: opening one channel while the other runs, the operator sees one screen — "Tagma Dev runs now: N agents in work, M terminals" — and one button "Switch". Pressed — the running channel stops with a clean exit, his own comes up. Window closed — nothing changed. In the terminal the same: another channel's command answers who runs and names `tagma switch`.
- **Human commands**: `tagma-dev` and `tagma`, each its channel's.
- **Move** — `tagma transfer --from dev` or the window question on first launch of an empty world: a copy, not a shared base.

A user with a release has one channel standing, and never sees the switch screen.

## Channel — one concept, one owner

Channel is install identity `{id, name, bundleId, data, port, command}` in `installation/contract/wire/channel.ts` (install module [[6cc306ce]]). Composition declares its own: release — `stable`, developer — `dev` (`composition/{release,developer}/channel.ts`). Server, CLI and window take it as `InstalledChannel` or `CHANNEL`; the core never branches by channel ([[6f758080]]), no second place with directory, port, bundle id or command ([[51c66cb6]]).

| | `dev` | `stable` |
|---|---|---|
| app | `Tagma Dev`, `com.runlith.tagma.dev` | `Tagma`, `com.runlith.tagma` |
| data directory | `~/.tagma-dev` | `~/.tagma` |
| plain home | `~/tagma-dev` | `~/tagma` |
| ports (server, artifacts, remote, sandbox) | 5633–5636, window Vite 5632 | 5643–5646, window Vite 5642 |
| command | `tagma-dev` | `tagma` |

Ports differ though one channel runs: bookmarks, page links and remote address each own and never confused. Dev stays on 5633: the operator changes nothing. `TAGMA_DATABASE_PATH`, `TAGMA_INSTALL_ROOT`, `TAGMA_PORT` stay overrides over the channel.

## Each channel — its own world

Store, execution host, rollouts, installs, launcher (`<data>/bin/<command>`), tokens, logs, stealth graphs and Electron data (`userData` = `<data>/desktop`) live in the channel's data directory. Outside it — only the junction (below), harness homes (`~/.claude`, `~/.codex`, `~/.cursor`, `~/.gemini`, `~/.grok`), bun cache and what macOS keeps by bundle id. The server puts `<data>/world` first on its children's PATH, where `tagma` is a link to its own channel's CLI: agents and texts inside Tagma write `tagma`, a human types his channel's command.

## Junction: one active server and one entry point

The account's shared junction is `~/Library/Application Support/Tagma/`. It is one because it connects Tagma with what is single per user; channel data never lives in it.

- **Active-server lock** — `flock` on `active.lock`. The server takes it before opening the store and holds it the whole run; the OS removes it on exit and crash. Beside it `active.json` — `{channel, cli, url, pid}` of the holder, rewritten atomically on taking the lock.
- **Held lock** — the server does not start: typed refusal `channel-active` with the holder's channel, pid and address. The window draws it as the switch screen; `tagma switch` and the button ask the holder to exit cleanly (the same path as exiting the window: host and terminals end, threads stop as on exit), wait for the lock to drop and raise their own server. This is a human act from the window or terminal; agents never stop the operator's server ([[8162ede6]]).
- **Entry point** — `~/Library/Application Support/Tagma/bin/tagma`, POSIX sh. It reads `active.json` and hands the call to the active channel's CLI; without `active.json` or without an executable CLI by it — `hook` exits silently with code 0, the rest prints "Tagma is not running". Each channel installs the file at start if missing or wrong: its content never depends on channel or release.
- **Trial instance** with its own `HOME` has its own junction: lock and entry point live under its `HOME`.

## Integrations written once

Everything Tagma writes into foreign configs names the entry point, not the install:

- **Hooks** at home (`~/.claude/settings.json`, `~/.codex/hooks.json`, `~/.gemini/settings.json` and other harnesses') and in repos (`.claude/settings.json`, `.codex/hooks.json`): `t="$HOME/Library/Application Support/Tagma/bin/tagma"; [ -x "$t" ] || exit 0; exec "$t" hook <verb>` — on a machine where Tagma never started, hooks from a git repo stay silent.
- **MCP**: at home and in repo `.mcp.json` — one `tagma` server, command — the `mcp-serve` entry point.
- **When written.** Home records — at server start after taking the lock, for each installed harness (the same `installForAccount` that now installs them only when a thread starts); repo ones — as now, `tagma setup` and declaration update after build. The write is idempotent: the line is the same, so a repeat changes nothing. Records of old shapes (absolute path into `install/current`, `command -v tagma || …`) are recognized and replaced; foreign records untouched.
- **Switching, update, move** never touch configs: the entry point leads where the running server is.

## Moving data between channels

`tagma transfer --from <channel>`: only into an empty world (no `tagma.sqlite`) and while the source is not running — the active one moves from the inactive. If the source store carries migrations this channel does not know — refusal `source-newer` with their names before copying. Copied: store (`VACUUM INTO`), rollouts, scratch, attachments and graphs — what each owner declared movable (`carried` in its `RELOCATIONS` contribution); installs, execution host and worktrees never move. Source paths in the copy are rewritten to target paths by the same mechanism as on move. The source never changes. An unfinished move is marked `transfer.json`: a server does not start with it, the move repeats. A channel window with an empty world, while another channel has a world, asks "Move data from …" / "Start clean".

## Operator move — done

The operator's world moved from `~/.tagma` to `~/.tagma-dev` and `~/tagma` to `~/tagma-dev` on 2026-10-13. The transition door — old dev place (`standingChannel`, `worldMove`), `tagma:build --move` and a release refusing to stand over a checkout world — is deleted. Path rewriting by `RELOCATIONS` contributions stays: the move uses it.

## What is done and what is being redone

Done by task [[8010753b]] (commits 69344afaae…082c2754ca) and stays: channel identity, directories, ports, commands, `world/tagma`, `tagma transfer` move with path rewriting and the window question.

Redone:

- **Checkout lease goes away** (`tagma.lease`, `checkoutLease`, `checkout-held` refusal and "Open <channel>" button, CLI server choice by lease holder): there is no second server, nobody to share the checkout with. CLI picks the server as: `TAGMA_SERVER_URL`, else `TAGMA_PORT`, else its own channel's port.
- **Hook form `command -v tagma || command -v tagma-dev` in repos and rewriting hooks and MCP on move and build go away**: one entry-point line replaces them.
- **Added**: junction: active-server lock, `active.json`, entry point, `channel-active` refusal, switch screen in the window, `tagma switch`, home-integration install at server start.
- **Manual step** of editing `~/.claude`, `~/.codex`, `~/.gemini` goes away: the running server itself brings them to the entry-point line at start.

Redone by task [[96fb8480]] (commits b0b103b43a, 598db532ca). Without `HOME` the server does not start: the lock has nowhere to stand. Switch after whose execution-host holder never ended refuses `host-stayed` and does not raise its own server. The entry point never calls a CLI by a record whose pid is dead. Harnesses sharing one hooks file (Claude Code and Grok — `.claude/settings.json`) write the same lines into it, so a repeat changes nothing.

## What the implementer proves

- A second channel while the first runs does not start: `channel-active` refusal with the channel and address; after exit or kill -9 of the first it starts.
- `tagma switch` stops the running channel with a clean exit and raises its own; the window screen shows the holder's agent and terminal counts.
- Entry point: with `dev` active, hook and `mcp-serve` reach `dev`; with `stable` active — `stable`; with none active, hook exits 0 silently.
- Server start on a trial `HOME` with home configs of old shapes (absolute path, `command -v`) and foreign records: its own records became the entry-point line, foreign untouched; a repeat start changes nothing.
- Move — `worldTransfer.itest.ts`.
- Tests fit layer budgets; the proof waits for no long runs.

## What the operator does

- To check a release: open Tagma → "Switch" → "Start clean"; back — open Tagma Dev → "Switch".
