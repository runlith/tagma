---
id: 01a10ca3-86ee-7e79-a06f-2cabbd0729aa
title: "Thread pages: a header button with a list of pages published by the thread and its team"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/artifacts
---
The operator finds pages published into a thread with one click from the thread header, without scrolling the feed or asking the agent.

## What the operator sees

- In the thread header, among the tools on the right, a "Pages" button with an icon and page count. While the thread and its team hold no page, there is no button.
- The click opens a popover with a list, newest publication on top. A row is a page, not a version: title, one-line description, publish age, and `v<version count>`. Republishing the same file (a rework) updates the same row.
- A row click opens the page's current version the same way a feed link does. A button in the row copies the link.
- A page published by an agent launched from the thread (a child) stands in the same list with its name. If the thread itself holds a page, no name.
- A dot on the button and row marks a publication that happened after the operator last opened the list in this window. Opening the list clears it. Pages from before the thread opened never count as new.
- Past the snapshot (newest 50) the list states how many old pages are hidden.

## Device

- **The pages shelf** (`apps/tagma/server/src/artifacts`) remembers which thread published: `publish` takes `thread`, and the shelf keeps one file per thread with its page ids. The file is written on the first page publication from a thread. Order of publications and versions stay as they were.
- `ArtifactStore.pages(threads)` answers with the threads' pages: the current record of each page and the thread that published it first in the request. Cost grows with the team's page count, not the whole shelf.
- The `artifacts.thread` feed (`{ projectId, threads }`) serves a snapshot at once and a new snapshot after every publication from any requested thread. The snapshot is bounded by newest pages and carries `total`.
- `publish_artifact` passes the shelf the calling thread from thread context, the same for a native agent and a foreign harness over MCP.
- **App:** a thread-tier service subscribes to the feed with the thread id and all its descendants from the thread list; the descendant set changes — the subscription reopens. The button stands in header `tools` in `ChatShell` next to the terminal and changes toggles.

## Verification

- Shelf integration test: publications from two threads, `pages` for one and for both return the right pages, republication never duplicates a row, the thread that published first in the request wins; `follow` serves a new snapshot on a team publication and stays silent on one outside the team.
- Server and app typecheck pass; the button appears after publication with no reload.
