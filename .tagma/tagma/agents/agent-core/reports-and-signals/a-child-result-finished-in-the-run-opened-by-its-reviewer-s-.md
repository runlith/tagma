---
id: 01a16491-db29-7da9-b34b-abb0ba38afe8
title: A child result finished in the run opened by its reviewer's report never reaches the one who gave the task
ord: 18
tags: ["reflection"]
fields:
  {
    "actual": "Only the interim \"waiting for the reviewer's report\" arrived from the run the task opened; the result landed in the child's transcript, the request stayed open, and the parent retrieved it only via read_thread_record",
    "command": "send_task / spawn_agent to a child → the child starts a reviewer and ends its run (\"waiting for the reviewer's report\") → the reviewer's report opens the child's next run, which commits and ends without send_message final",
    "expected": "The task giver receives the child's result: its final answer, or without one — the last message of the run where the work ended"
  }
---
Filed from project `runlith`.

Two cases in one hour, both on claude-code/claude-opus-5-5 and claude-sonnet-5-5:
- approver-parent `01a16425-5b66-764e-b48e-b6618109c47d`: the task opened run `01a16453-235e-71ab-8fca-23512530f7cf`, which ended on "Waiting for the reviewer's report". The result with commit `0222d58c5f` — last message of run `01a16460-e15c-7970-99c6-cafca5c281a5` (at 2445), never delivered to the parent.
- attention-agent `01a1644a-51d2-73d9-a751-0fee4cd9e4aa`: run `01a1644a-522e-7ba8-8c11-33176c51a027` ended on "Reviewer started; waiting for its report". The result with commit `446eddfb49` — at 364 of run `01a16453-7cbe-…`, never delivered to the parent.

Reminding a child that owes an answer before the end of its run produced no final `final` in either case. The pattern is shared: the child starts the reviewer itself per project rule, so the work almost always ends in a different run than the one the task opened.
