---
id: 01a196df-4cd3-7ad3-83f3-b4f9920511bf
title: Launch blocks reach list rows from the gate's own class changes
ord: 21
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/agent/src/thread/run/LaunchGate.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/threadList.ts
---
A refusal or lift can change launchability without a committed run change, so the list listens to the gate's own class changes. Subscribers observe the new gate value, and disposing a list releases that subscription.