---
id: 01a188e1-c8ab-7dde-911b-e6a59c60187f
title: "Two desktop engine scenarios failed once each: a beforeunload navigation hung, and an agent act was refused as operator input"
ord: 39
tags: ["task"]
fields:
  {
    "holder": "tagma:01a188e1-f692-7cca-af1b-58b0a8bda13d",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a1845c-e541-7522-be69-64776febfab1
sources:
  - kind: file
    ref: apps/tagma/desktop/src/browser/host.ts
  - kind: file
    ref: apps/tagma/desktop/src/browser/page.ts
---
Two failures of the shared engine scenarios on the desktop host were each seen once, and neither recurred in later runs of the same order. Both are unproved and red, not noise: a test fails only on its own fact.

1. `a navigation held by beforeunload waits for the answer…` hung to the 3-minute guard in the combined seed-1 batch (`testbed bun test --no-isolate --randomize --seed=1 ./src/desktop-browser/engine.itest.ts ./src/managed-browser/engine.itest.ts ./src/managed-browser/screencast.itest.ts`, from `apps/tagma/server`), as the first scenario of its group, on a page opened fresh at `/leave`. Electron main left with exit 0 only at teardown, so this was a hang, not a crash. The same order passed four times afterwards, alone and in the batch. Which step stopped is unknown: main's output was not kept in that run.
2. `load conditions slow every renderer…` was refused `operator-input` at its first agent act, right after `a hung out-of-process frame refuses attachment work and unsafe reload…`, in a seed-1 run by the agent on task 3505f7f7 (report `/tmp/runlith-test/reports/run.99003.1793297470527.jsonl`). Only desktop main's `input-event` marks a desktop page operated (`BrowserHost.police` → `operated`, explanation 73cdfd5a), so main counted some input on that page as the operator's. A rerun of the same batch, logging every counted event with its type, counted none.

Instrument that catches them: append Electron main's stdout to a file in `desktopFixture`'s `launchElectron` (`desktop-browser/testing/electron.ts` keeps only the last 8 000 characters, and logs them only on an unexpected exit), and log in `police` each counted event's type, page and the injected command types pending at that moment, plus `will-prevent-unload` and navigation settling in `HeldPage`. Then run the desktop file and the combined batch on seeds 1–3 until one recurs.

Done when each failure's cause is proved by such a trace and fixed at its owner, or the trace shows the scenario's own assumption at fault and the scenario is corrected.
