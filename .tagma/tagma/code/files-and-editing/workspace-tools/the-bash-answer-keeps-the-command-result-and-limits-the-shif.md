---
id: 01a12d36-21ec-7231-9683-75c20f274db0
title: The bash answer keeps the command result and limits the shifted-paths summary
ord: 45
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c86-94f8-75d1-a0c3-27f858a6f9e9",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0e88b-a497-725f-91f3-9a270e9619cf
sources:
  - kind: file
    ref: packages/agent-tools/src/bash/answers.ts
---
Fix the [[0e9619cf|observation-displaced result]] and the [[319a5f70|expensive footer]] at the `bash/answers.ts` producer; the command output stays in the envelope, the summary reports numbers without pathname lists. Authorship, durable journal, write queue, and eligibility do not change. Leave the operator's server alone.

Cause confirmed via finishedAnswer: a moved/verdicts list over 50 KiB fully displaces stdout/stderr from the shared OutputTail. In the taken group each next path copied the previous array, giving O(N²). Three overlap/taken/unread contracts were red on stdout, green after the fix; a fourth unread-diagnostics one also went red→green. 23 unit checks in total, 2 real-process exit contracts and oversized-output, 6 commands/queue contracts passed. The summary counts existing verdicts in one pass, O(N) time / O(1) extra memory; the footer line count and path-name weight do not grow with the corpus. `read_changes` is a separate read of retained paths and causes, which the command answer does not invoke. At this delivery's time the landing directive required an exact file in paths with whole:true; the operator's later decision in the [[9ef0708c|catalog-choice task]] extends it to the containing directory.

A narrow in-process measurement on one machine: 3 warmups and 10 hand measurements, 425 and 5000 paths with repeatable filename length. Median for 425 overlap 1.163→0.038 ms, for 425 taken 1.106→0.029 ms; for 5000 taken 36.776→0.054 ms (max 60.60→0.056 ms). A 51200-byte answer without stdout became 336–434 bytes with stdout. This is projection cost, not the server's end-to-end speed.

Completion check: the current queue/commands contracts prove append/settle do not await hunk writes; the settled-window durable update stays awaited. In the currently installed process (instance18f11463-6268-44e9-8f3d-0423fa4505b9, retained read since 20:00 UTC 11 October) the ShellRun.finish620251055c4ac103 span took 712.85 ms, CheckoutBaselines.measure705.17 ms; this is another build, not a before/after and no proof of the historical minutes' cause. Our own no-write bash bench on a temp fixture (400 committed, 60 dirty, 20 untracked; 3 warmups, 20 measurements) gave median 80.25 ms, p90 84.43 ms; this is one sample with a testing port, not the installed durable journal. The historical 3–4 minute delays were not reproduced.

[[d21aa825|Quoted inline code]] already covers bb38059820052c79e61077e005a823ac9be7ca39: the exact command from the reflection was run through the public shellShown, probes only `/repo/op` and `/repo/read_block`, inline code/JSON/prose never become pathnames; the existing contract is green. The reflection is answered by this commit.

[[87d5028d|Nobody's-paths directory]] was the same boundary as the [[a5ecf3a0|generator-directory skip]]: the decision in commit 126b3adfe8aba98e7a051c315593afa97503a6ec accepted CommandChanges.unattributed only for an exact file in paths. This delivery kept choosing its own held paths by directory and clarified the footer; the operator later tasked [[9ef0708c|accepting retained nobody paths by directory]] on the same terms as an exact file.

The last batched `bun run typecheck` passed fully, including its dependencies, then 4 final answers.test.ts contracts and diff --check passed too. oxfmt --threads=3 applied, diff read. An early run caught a neighbouring unfinished adapter-anthropic rebuild, and the next one its own undefined-index in a new test; neither error is in the last run.

One independent round: Sol xhigh and two Muse xhigh lenses. The lead reviewer's P2 confirmed along ShellRun → CommandRun.measured → CommandDeliveries → CommandOutputReader: one unread counter lost the last available path name, which `read_changes` will not restore. Fixed at the producer: measurement keeps the full unread list for `read_output`; the managed answer shows one path and the execution/incarnation address, local diagnostics go before stdout and do not displace the process result. A new contract proves both pathnames in the stored observation and pathname/address/stdout in the short answer; the exit-verdict format and shared envelope are preserved. This is diagnostic-data restoration, not authorship extension. The invariant is recorded in the [[a60f186f|bash diagnostics explanation]].

Two low output/eligibility remarks resolved: the exact quoted-inline example was a one-off probe, the standing green contract is general and sufficient for the same operand role; no separate test case with tagma is claimed. Checking only the footer number sum would be the `moved − verdicts − unread + verdicts + unread` identity and would catch neither a wrong name nor a duplicate verdict, so no such test was added; the producer chain and exact eligibility are verified by reading. The boundary is described in the [[4c940a20|nobody-file choice explanation]]. No second review round.

Delivered: 53f56d34fd00771371ece81abc85fa500e1e3606 (limited summary) and cbeb769ef481beecf68e6691457f9fa5a5838d7f (diagnostics per P2).
