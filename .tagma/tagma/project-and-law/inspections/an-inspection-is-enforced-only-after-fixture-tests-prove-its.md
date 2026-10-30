---
id: 01a18d50-5206-7923-a0bd-346e31794f2d
title: An inspection is enforced only after fixture tests prove its findings and a measurement shows its commit cost grows with the change, not with the repository
ord: 61
tags: ["rule"]
sources:
  - kind: file
    ref: tagma.config.ts
  - kind: dir
    ref: checks
  - kind: dir
    ref: apps/tagma/inspection
---
The fixtures must show three things: the inspection finds each violation it targets, it passes clean code, and it handles each edge case its author names. A test asserts each of these. Before enforcing, measure how long a commit takes to judge with and without the inspection, and report both numbers with the enforcement. Every inspection shares one commit's judging time, so the author sets a budget for the new one, as a small share of the measured time, and optimizes it until it fits. An inspection whose cost grows with the repository instead of the change is not enforced: work over the whole repository runs only on remeasure.