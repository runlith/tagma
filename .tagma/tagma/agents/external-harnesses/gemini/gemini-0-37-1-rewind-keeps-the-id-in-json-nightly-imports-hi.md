---
id: 01a17319-75a7-7026-b6a0-72175b5ca8a7
title: "Gemini 0.37.1: rewind keeps the id in JSON; nightly imports history into a new random id"
ord: 3
tags: ["research"]
fields:
  {
    "source": {
      "name": "Gemini CLI 0.37.1; upstream 9a15c45",
      "ref": "2026-10-25; installed gemini --version/--help; .external/gemini-cli; https://github.com/google-gemini/gemini-cli"
    }
  }
---
Read 2026-10-25: installed `gemini --version` → `0.37.1`, root help and the really imported JS chunks of the Homebrew package; `.external/gemini-cli` at clean HEAD `9a15c45fbfc9f36a9817e0113dbd4fc1138840f0`, commit of 2026-08-16, package `0.56.0-nightly.20260806.g761f604c1`. **These are different versions and different persistence formats.** No model, TUI, or API/server was launched.

## Observation: installed 0.37.1

Interactive resume: `gemini --resume FULL_UUID` (or `-r FULL_UUID`). Without a value/latest — the last session; a number — an index. No whole-fork argv, no point selector, no --session-id, no --session-file in help/parser. For this version no preassigned fork id is offered.

Installed bundle root B: `/opt/homebrew/Cellar/gemini-cli/0.37.1/libexec/lib/node_modules/@google/gemini-cli/bundle`. `B/gemini.js:3–160,14347–14355` imports the chunks named below; `:7533–7552` declares --resume, then list/delete, with no fork/session-file/id; `:14623–14632` sets config.sessionId from the loaded conversation. `B/chunk-MODIYMRW.js:58492–58515` resolves an exact full UUID or a numeric index; latest is picked by startTime, not lastUpdated (`:58523–58547`).

Persistence is **one JSON**, not JSONL: `~/.gemini/tmp/<projectIdentifier>/chats/session-<time>-<first-8-of-id>.json`. projectIdentifier comes from ProjectRegistry in `~/.gemini/projects.json`; it is already a short ID/slug, not necessarily the old project_hash (`B/chunk-5OOT636U.js:41945–41967,42010–42028`). Fields sessionId/projectHash/startTime/lastUpdated/messages; message.id is a UUID. Resume keeps the original filePath/id; write rewrites the whole JSON (`B/chunk-2P3YD5SP.js:252974–253044,253193–253244`).

`/rewind` picks the previous user message; `rewindTo` cuts `messages` **before** the picked message.id, dropping the prompt and the tail, writes the same JSON, and keeps the session ID (`B/chunk-MODIYMRW.js:92513…`, `B/chunk-2P3YD5SP.js:253393–253405`). The picked prompt returns to the composer. The [official rewind docs](https://geminicli.com/docs/cli/rewind/) also describe two Esc and history/files/both choice. `/restore` for file/tool checkpoints is a separate function, not a generic resume-at-message.

Tagged checkpoints `/resume save TAG` and `/resume resume TAG` (also `/chat`) bring back model/UI history but **create no new session ID**: installed `chunk-MODIYMRW.js:88342–88384`, `interactiveCli-25PTL36A.js:42316–42322`. So a tutorial calling this a fork/branch does not prove a new identity. `/resume` browser of auto-sessions, by contrast, explicitly takes the id of the picked kept session (`chunk-MODIYMRW.js:85570–85596`).

Base hooks carry config.sessionId and transcript_path recordingService (`B/chunk-2P3YD5SP.js:324215–324223`); startup-resume raises SessionStart with source=resume (`B/interactiveCli-25PTL36A.js:48347–48348`). The rewind producer raises no separate rewind hook; history change is visible by re-reading the whole JSON, not an append-only tail. The hook moment when switching browsers inside an already running TUI is unmeasured.

## Conclusion: an external copy on 0.37.1

The installed reader accepts `session-*.json` with sessionId/messages/startTime/lastUpdated and substantive user/assistant content; it deduplicates by id (`B/chunk-MODIYMRW.js:58386–58405,58456–58460`). So **by the reader** a valid copy with a new UUID and an array prefix looks fit for `gemini --resume NEW_UUID`. TUI acceptance, tool-result/compaction consistency, and the exact model context are unverified. A plain copy with the same id is no fork; byte truncation makes the JSON invalid. cachedConversation can overwrite an external edit of the active file.

## Observation: only the 0.56 nightly checkout

`packages/cli/src/config.ts:243–249,421–443` declares mutually exclusive --resume/--session-id/--session-file. `gemini --session-id Y` creates an **empty** session with the picked id; a collision is forbidden (`gemini.tsx:294–303`). `gemini --session-file PATH` imports a record into a **new random id**, filtering user/gemini history with content, writing a new JSONL (`gemini.tsx:220–283`). This is a whole/prefix import, not a point flag; it cannot be combined with a set id.

In that checkout `core/services/chatRecordingTypes.ts:44–139` and `chatRecordingService.ts:133–273,931–950` use JSONL with message updates, `$set`, and `$rewindTo:messageId`; rewind appends a marker instead of deleting the physical tail. The legacy JSON fallback stays. This semantics cannot be carried over to the installed 0.37.1 or treated as proof that any JSONL prefix is the active history after later updates.

## Open probes

After separate permission and with working auth: `gemini --resume X` in a separate HOME/project, `/rewind` history-only to the second prompt, compare id/path/JSON/hooks and resume after exit; `/resume save TAG` then `/resume resume TAG`, compare ids. For a closed fixture make a valid JSON prefix with a new UUID/filename, `gemini --resume Y`, and check not only the listing but the restored history and the next hook; separately the tool-call bounds. The nightly import is checked only on the matching argv `gemini --session-file PREFIX_FILE`; the installed 0.37.1 offers no such argv. All probes stayed unrun.
