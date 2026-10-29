---
id: 01a184ca-619d-7561-9456-81ed85b6caee
title: WebKit loses a wheel step that meets a history-prepend rebase write
ord: 10
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18353-fb8c-7866-916b-78b406aa5d8d
  - kind: implements
    to: 01a18327-c7aa-7718-b037-fece2ea21922
sources:
  - kind: file
    ref: packages/chat-ui/src/TranscriptVirtualizer.svelte.ts
---
The stand's WebKit host page-mid-fling scenario fails on one 116 px wheel step at the moment the older page lands, on base cad33548 and on the current tree alike (absolute control run.10514, run.10808, run.11068; evidence in each run's `input-host.json` and `frames-host.json`). The rebase itself is exact: anchor 0, blank 0. Chromium does not lose the step.

Two cases, about equally frequent:
- **(a) Wheel before the write.** The page lands in its own task. Between the last scroll event and that task, WebKit's scrolling thread has already applied the wheel to `scrollTop` (2618 → 2502), but no scroll event has reported it yet. virtual-core builds the rebase target from its cached offset (2618 + 50921 = 53539) and writes it absolutely, erasing the wheel. This is a defect of the write model: a correction is relative by meaning but is written as an absolute position computed from a basis WebKit's async scrolling can outrun.
- **(b) Wheel 1–6 ms after the write.** WebKit dropped it even when the write happened to be a pure delta (run.12419: `scrollBy(+50921)` from a basis equal to `scrollTop`). That is one sample in Playwright's WebKit. Whether real Safari keeps a wheel after a delta write is unknown.

Two `scrollToFn`-only arms failed, so the fix is not there:
- `scrollBy(target − element.scrollTop)` is the absolute write again.
- `scrollBy(target − library basis)` breaks the feed. At mount, the basis is the out-of-range `initialOffset`. Two writes issued before one read-back step twice, because the library re-issues absolute targets idempotently (run.63563, run.65180).

Direction: fix it in the library's write path, through the feed's virtual-core binding. Before computing a correction, ingest the element's live offset as an unreported scroll, so the target includes the wheel. Keep writes absolute and idempotent. That closes (a). Then measure (b) again. Holding corrections during a desktop wheel stream, as iOS does through momentum, was rejected: the held total leaves a wall at the top that a continuous wheel hits before the hold folds.

Scope and proof: close case (a) only. WebKit page-mid-fling runs over seeds 1/2/3 must show that no lost wheel precedes the rebase write; any remaining loss is classified from the event timestamp, native position and write trace. The post-write engine loss is measured separately by [[98c0c0fe]]. Chromium's affected both-branch set stays green. Public binding regressions fail before the fix and pass after: the element scrolls without a scroll event, then a measurement or prepend correction lands at live + delta, including movement between anchor capture and commit; repeated absolute targets remain idempotent.