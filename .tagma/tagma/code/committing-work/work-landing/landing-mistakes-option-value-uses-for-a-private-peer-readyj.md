---
id: 01a194c9-1881-76d3-947a-01034c33def3
title: Landing mistakes Option.value uses for a private peer ReadyJob.value declaration
ord: 175
tags: ["reflection"]
fields:
  {
    "actual": "Refused lines-held on the unexported ReadyJob.value at change-record/lines/walks.ts:82, held by another session, although the selected production edits contain no value reference and do not import ReadyJob.",
    "command": "submit_work({subject:\"fix(change-record): keep submodule writes outside parent git\",tasks:[]})",
    "expected": "Commit this session's eight held paths without carrying unrelated peer declarations."
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-31T23:25:28.662Z, from 3a395b0b3.

The selected change affects Holdings.probeAt and lettersAt, Git path batching and visibility, and their regression tests. The shared inputs.ts imports Walks and Lane, but ReadyJob is a private type returned by WorkLanes.first; this delivery never imports or uses WorkLanes. Existing Option.value uses in a selected test can match the member name conservatively without a receiver-type dependency. The refusal names taking the peer's work or waiting for it; neither is needed by the built change.