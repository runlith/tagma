---
id: 01a13fab-eec0-7cca-a697-3afee88c8014
title: "A child run awaits a question by default: Approvers picks the addressee"
ord: 1
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a13f63-559c-7cb3-89b6-c446472a019b
sources:
  - kind: file
    ref: packages/agent/src/thread/run/scheduler/openings.ts
---
A parentThreadId does not mean unattended: a child thread has a question route to its parent or the operator. Without an explicit approval the scheduler opens an interactive run; availability of waiting for a special launch is set by its approval, while the choice of addressee and the right to answer stay with Approvers and Questions. Otherwise a tool asking for a required confirmation would refuse with no-approver before routing was ever tried.
