---
id: 01a19757-78c8-7c61-ab83-705b4c4cc041
title: "The Muse runner keeps one Muse session as the thread's model loop: a home per account, settings per thread, steer follow-ups owned by the Tagma turn"
ord: 3
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a19560-3243-79c3-b6f8-cebb2a6213d4
sources:
  - kind: file
    ref: packages/adapter-muse/src/runner/cycle.ts
  - kind: file
    ref: packages/adapter-muse/src/runner/feed.ts
  - kind: file
    ref: packages/adapter-muse/src/runner/home.ts
---
The runner keeps Muse's session as the one model loop of a Tagma thread, so its cache and history survive between turns; every choice below protects that or keeps the user's own Muse setup out of the thread.

- **A Muse home per account, settings per thread.** `HOME` and the XDG data, state and cache directories point at a home under Tagma's data directory, which reaches the user's login only (on macOS a `Library/Keychains` link and the CLI's `auth.json`). Without it the user's rules, skills, hooks and settings ride every request and the user's `muse resume` list fills with Tagma sessions. `XDG_CONFIG_HOME` is per thread, because `settings.json` carries that thread's frozen prompt and toolset: one file shared by two threads would hand one thread the other's prompt at its next host start.
- **The host reads prompt and catalog once.** A run whose prompt or tool names differ restarts the host and resumes the same session; anything sent mid-host would not reach the model.
- **A Tagma turn owns the Muse turns its steers open.** Muse drains an accepted steer into the running turn, or, when that turn ends first, runs it as a follow-up turn under the steer's command id. The Tagma turn ends only after every accepted steer was read and every turn it owns completed. Ending at the first `turn/completed` left the follow-up running with no Tagma turn around it: its approval request went unanswered and every later `turn/start` queued behind it in Muse forever. A Muse turn no Tagma turn owns is interrupted for the same reason, and its trailing deltas and approvals are not taken into the next turn. Muse's admission of a steer is not its reading: the steer is answered read only at its steered item, so a word a stop or failure left unread goes back to the core rather than being recorded as heard.
- **A `configError` turn drops the host.** On resume Muse runs a turn it still had queued before the session MCP server is up, records an MCP startup audit fault, and fails every later turn of that host process. The next turn starts a fresh host and resumes; the session itself is sound.
- **Tagma never forks Muse sessions.** Fork and rewind open a fresh session seeded from Tagma's journal: a forked Muse session loses the session MCP config and cannot be resumed on a new host (1.4.10).
- **Session ids and turn ids are UUIDv7.** Muse refuses other session ids, and a v7 Tagma turn id becomes the `turn/start` command id, so Muse's turn id is Tagma's.
- **Every Tagma call is approved at once.** Sessions run `:ask-me` with `promptUnmatched`, so no Muse judge reviews a call; Tagma's door judges it. Only a vendor `web_fetch` goes to the thread's own confirmation.

Muse's compaction keeps its summary inside the session: MSP gives the client no retelling, so the boundary Tagma records carries an empty summary, and Tagma's journal is not folded on it.
