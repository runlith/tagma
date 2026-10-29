---
id: 01a0da11-f1b8-782f-84d3-3b0bf5ad7a8b
title: A child run settles as completed after a model step with output tokens but no text and no tool call, so the parent gets no answer and no failure
ord: 18
tags: ["reflection"]
fields:
  {
    "actual": "twice the run ended completed right after a tool call and a 179-output-token step that surfaced nothing; the parent got \"no final answer, no last message\" and had to re-dispatch by hand",
    "command": "child regress-01-frame (thread 01a0d989-2e3d-7473-924e-b6510fc95338, muse-spark-1.3-contributor max) working a spawn task and a send_task continuation",
    "expected": "an empty final step (no text, no tool call) is not an answer: the loop asks again or ends the run as a failure naming the empty step"
  }
---
Filed from outside every registered project.

A child agent's run settles as `completed` after a model step that produced output tokens but no visible text and no tool call. The parent receives "ended the run your request opened without sending you its final answer … The run left no last message either", although the child was mid-task and had not answered.

## Sightings (another project, 2026-09-25)

Child `regress-01-frame`, thread `01a0d989-2e3d-7473-924e-b6510fc95338`, model `muse-spark-1.3-contributor`, reasoning `max`, parent `01a0d552-21bb-772b-bc23-f22b95ec5951`.

1. Run `01a0d989-2e7a-7ee8-9f28-098e01329961` (the spawn run): ended `completed`; parent report said no final answer and no last message. The child's report file showed a long "Not verified" list — the work was half done.
2. Run `01a0d9ab-9d9b-787b-bc88-d917cdd51ff5` (after the parent's `send_task` to continue): last entries are `820 tool bash` (a python comparison of splash SVGs), `821 measurement`, `822 step`, `823 step-finished`, `824 measurement` (179 output tokens), `825 step`, `826 step-finished`, `827 run-end`. No message entry and no tool entry after 820; the step at 824 billed 179 output tokens that surfaced nowhere. Status `completed`.
3. The third run (`send_task` again, run `01a0d9bd-3173-712d-863b-c88a56ea9ebc`) finished properly with `send_message final: true`.

## Cost

Two re-dispatches by the parent, each needing a hand read of the child's log to find where it stopped; the child's partial conclusions from both runs survived only because the brief made it write a report file as it went. The same model family already produced an empty assistant message that broke a review thread (`41b68ee4`).

## Why it is Tagma's

A step that answers neither text nor a tool call is not a final answer. The agent loop settles it as a normal completion, so neither the child (no nudge to answer) nor the parent (no failure, only "no last message") can tell a finished child from one the provider cut short.

## What should hold

A run whose last model step yields no visible text and no tool call does not settle as `completed`: the loop asks the model once more for its answer, and if that is empty too, the run ends as a failure that names the empty step (its measurement, output tokens, finish reason), so the parent's report says the child was cut off, not that it chose to say nothing.
