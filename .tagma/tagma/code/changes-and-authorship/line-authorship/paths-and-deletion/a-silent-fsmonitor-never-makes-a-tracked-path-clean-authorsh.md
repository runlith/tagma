---
id: 01a16c01-4e4f-711b-a858-de00591ba192
title: "A silent fsmonitor never makes a tracked path clean: authorship reads go without the monitor"
ord: 8
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/holdings/letters.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/retire/driver.ts
  - kind: symbol
    ref: apps/tagma/server/src/change-record/prepared/eligible.ts
    symbol: changedWithin
  - kind: symbol
    ref: packages/git/src/status.ts
    symbol: statusAt
---
Under load, git fsmonitor lags writes by tens of seconds: `git status` stays silent about an edit or deletion already on disk. Holdings counted a path with no status letter as clean — substituting the HEAD text for the working one — and retirement completed a correctly recorded edit as `reverted`, while a landing without `paths` lost it; `submit_work` with explicit `paths` never found such a path among changed ones.

So the reads authorship depends on never trust the monitor:
- `statusAt` with `monitor: false` (`@runlith/git/status`) goes with `core.fsmonitor=false`. Reading named paths costs the same: git stats only the named index records;
- the Holdings probe reads status on named paths without the monitor. After a full tree read, where the monitor saves walking the whole index, it rechecks without the monitor the paths it stayed silent about: tracked ones with recorded lines and ones missing from disk;
- the landing's changed-path selection (`changedWithin`, `standingAmong`) reads status without the monitor.

An unread status is not cleanness either. When the monitor-free confirmation failed or HEAD moved between the two reads, the path's letter is unknown, and the folding compares the real HEAD and working-file texts: the HEAD is substituted with the working text only when the letter is exactly `null`. Retirement completes a line as `reverted` only when the judgement is proven and that record's lines no longer stand in it, or when the working file's digest equals the HEAD digest. A letter left from an earlier judgement never decides this. A staged-move source gets the `deleted` letter on the status line's `oldPath`.

Other readers' full `git status`, such as the checkout line, still gets sped up by the monitor: its mistake only delays display and never changes authorship.
