---
id: 01a11639-a8c1-728b-8ceb-461a09b34496
title: Threads archive on the operator's word or as expendable children; an archived thread does not return to the live list; detach and reattach return it from the archive themselves
ord: 22
tags: ["task"]
fields:
  {
    "holder": "tagma:01a115c7-117e-79fb-9fe1-f2b10ab691c4",
    "status": "done"
  }
---
The agent archived children after every report under an unconditional prompt rule, including ones the operator needed; an archived child returned to the sidebar, and detach refused with "unarchive it first".

What to do: the rule in `threads/doctrine/threadsAsEvidence.ts` and `ARCHIVE_GRAMMAR` (`threads/contract/wire/operations/catalog.ts`) — archive on the operator's word or an expendable mechanical child; `announce` in `threads/list/threadList.ts` broadcasts an archived thread as `removed`; detach and reattach of an archived thread return it from the archive and run (`threads/collaboration/detachment.ts`).

Done when the list and detach typechecks and tests are green, the contracts (an archived thread does not appear in the feed after a new event; detaching an archived one succeeds) are covered, the commit is landed.
