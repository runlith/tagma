---
id: 01a14c14-a11c-7ce8-9d84-6331473f428a
title: A foreign CLI session in a project starts with the same orientation as a native thread, and with the whole project law
ord: 8
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928db50ae262
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-633222b5a1a1
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/guidanceSources.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/hooks/dispatch.ts
  - kind: file
    ref: apps/tagma/server/src/graph/operations/sessionOrientation.ts
---
**Value.** Claude Code or Codex, opened in a project's repository, knows from the first turn what project this is, how it is divided, and which rules bind it — even if Tagma didn't launch it.

**How.** The CLI session-start hook calls `session_start`; a CLI on ACP receives the same text as its first turn.

**Behaviour.**
- The text is the native thread's orientation (root body, global graph reference, map within the project budget, work in progress with the holder), followed by the whole project law: directory guidance, tag prompts, and all prompt rules, globals first. In a private project, the law is preceded by the section of Tagma law found in none of its checkout's files.
- Tagma has no system prompt for the CLI, so the law goes as text, not by reference; the answer is encoded in that CLI's answer form.
- After context compaction or clearing, the CLI sends session start again, and the orientation arrives anew.
- The session-start hook also works for CLIs launched outside Tagma threads.

**Limits.** A CLI Tagma drives over ACP with its own runner doesn't get this orientation: the law reaches it differently. A CLI without Tagma hooks doesn't get it at all. How a CLI handles a long hook answer is the CLI's own call: past 10,000 characters, Claude Code puts the answer in a file and shows the model the path and the start.
