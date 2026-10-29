---
id: 01a10323-2fc7-78fa-8d6d-620a6ce62961
title: Checkout snapshots around bash take changes from git's own fsmonitor daemon instead of two full git statuses per command
ord: 5
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a102e4-277f-7c7c-a308-0367911210a1
sources:
  - kind: file
    ref: packages/agent-tools/src/CheckoutBaselines.ts
---
**Question.** Should checkout snapshots around bash take changes from git's own fsmonitor daemon instead of two full `git status` per command?

**Motivation.** After [[911210a1]] (4d1bf9ef4d) the before and after snapshots are one `git --no-optional-locks status --porcelain -z -unormal` each. One call on runlith takes ~76 ms (trace2, 2026-10-03, git 2.50.1 Apple, `checkout.fastStatus` on, 23.5k indexed files, sample on a loaded machine):
- ~40 ms fixed: index read ~5 ms, fsmonitor daemon request ~12 ms, index-vs-HEAD comparison ~10 ms, and small things;
- ~36 ms — walking directories changed since the last ordinary `git status`. The untracked cache persists only a status holding `index.lock`. A snapshot cannot hold it: an 80 ms lock would break agents' parallel `git add` and `git commit`. So this part grows with the number of changed directories until the user or IDE runs an ordinary status.

~150 ms per bash command total. Before [[e334c004]] it was 9 + 4.5 s, so it is unclear whether the remainder shows in real work.

**Option.** Tagma asks the fsmonitor daemon: "what changed since the previous snapshot's token". The answer decides the action:
- nothing changed and HEAD and index are the same — the "before" snapshot equals the previous command's "after", no status needed;
- paths changed — scoped status only for them;
- the daemon answers trivially (token loss or reset) — full status, as now.

This is a reliable change frontier with explicit loss, which could not be built on `fs.watch`: the daemon already has FSEvents and loss accounting. Owners are the `CheckoutBaselines` snapshots and `@runlith/files/working`; the mechanism is described in [[f8242dcd]].

**Against.**
- The built-in daemon's IPC protocol is not documented as public.
- The daemon exists only in git builds for macOS and Windows; on Linux the full status stays.
- Medium work, risk is in foreign-edit observation correctness.

**What decides.** A live measurement after the server restart: what share of agents' bash-command time snapshots take. If the share shows on short commands — take it; if not — close.
