---
id: 01a1950b-9c81-75b2-8c92-eca2c3902800
title: submit_work runs a checkout-reading gate before writing the formatted form back, so the first landing refuses and an identical retry lands
ord: 179
tags: ["reflection"]
fields:
  {
    "actual": "The pin-compiles program refused inspection-failed \"the checkout differs from the commit being judged in apps/tagma/demo/app/src/runtime.ts\"; the formatted form reached the working file only after the refusal, and the unchanged second call landed 817c01cac0",
    "command": "submit_work checkout=~/runlith/runlith paths=[tagma, apps/tagma/demo/app/src/runtime.ts, …] (runlith project 42, rule 8e15721e pin-compiles at gate)",
    "expected": "The format commands rewrite runtime.ts and the gated program judges a checkout that already holds the formatted form, landing in one call"
  }
---
Filed from project `tagma`. Received by a server up since 2026-11-01T02:51:04.711Z, from cb14a7909.

The rule's program (runlith `checks/pin.ts`, explained in runlith 2708d305) judges the working checkout and refuses while a private workspace file differs from the judged commit. submit_work builds the commit tree through the `format` commands, runs the gate, and writes the rewritten files back into the working tree only afterwards (the refusal said the formatted form "now stands in the working files"). Any commit whose formatter changes a file in a checkout-reading gate's reach therefore costs one refused landing: a full inspection setup run plus a second call. Writing the formatted form into the working files before gated programs run (or handing programs the formatted paths) removes it.