---
id: 01a136c1-4ec1-7395-bc66-acdb0a20e25b
title: "\"Release self-observation: cheap recording, 'Report a problem' as a file, analysis tools for the developer only, per-channel setting defaults\""
ord: 13
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0fd8b-bf02-7b35-8c99-f0b29bb175ec
  - kind: relates
    to: 01a13666-7072-79da-a7f4-bce12fbc8082
sources:
  - kind: dir
    ref: apps/tagma/server/src/performance
---
The release records about itself only what is cheap and what the user can pass on: when a human writes "slow" or "broken", they press "Report a problem" and hand over one file showing what hung, where and when. Tagma's own analysis tools — record reading, on-demand captures, the `performance` skill — stay with the developer. Channels ([[2fbc8082]]) differ by setting defaults, not by code branches.

## Two kinds of channel differences

- **A setting with a channel default** is everything that may reach the user. The code is one in both channels; the channel sets only the default value, the user and the project override it.
- **The build contents** are everything the user must never have: the code is not in the release, and the pipeline proves it. That is the `"tagma": {"build": "developer"}` mark and the developer's composition, as with the checkout build and reflections.

A thing that may reach the user is a setting; a thing that must never is contents. There is no third way: no `if channel === …` in a module, no hidden flag.

## Channel defaults in settings

- A setting key ([[b824564e]]) declares its default value at its owner and, where channels diverge, the value for the channel: key data, not a code branch. There is no central list of per-channel defaults ([[edea5454]]).
- The settings module resolves the value in order: project → user → channel default → key default. It receives the channel from the channel identity composition gives; it never lists channels itself.
- The settings interface shows where the value comes from: "default for Tagma Dev" or "default".

## What the release writes about itself

- **Always:** event loop stalls with a short CPU profile around them (`LoopStalls`), process readings every few seconds — CPU, memory (`ProcessVitals`, `MetricSnapshots`), server failures with a stack. Storage is the current segment ring with a size ceiling (`packages/performance/src/store`). Where server failures are recorded now and whether they reach that storage, the performer verifies and consolidates into one place.
- **Spans** is the `performance.spans` setting: on in `dev`, off in `stable`. Sampling (`TraceSampler`) is also a setting with a channel default.
- **Repeat recording** switches spans and the CPU profile on for the human-set time (with a ceiling) and switches them off itself; it never changes the setting.
- Nothing leaves the machine.

## Report a problem

- **Where:** the "Help → Report a problem" menu and `tagma report [--since <time>]`; in the window — "Start recording" / "Stop and report".
- **What is in the file:** the release number and channel, the macOS version and Mac model, the `serve.log` tail, performance records for the window (the last hours by default, and for a repeat recording — its window), failures with a stack. One archive, named with the release number and time.
- **What is not in the file:** thread contents, prompts, model answers, project files, tokens and keys. Record entries contain project paths and names, and the report window says so.
- **Before saving**, the window shows the file's contents and size; the human saves the file and sends it themselves — to a messenger, by mail. There is no automatic sending.
- **Analysis at the developer:** the stack is `bun run tagma:stack <release>` against the release maps; records are read the same way as at the developer's (below), over the report file instead of the live storage.
- Taking the CPU profile during recording is the export's own job, not an outward-facing operation.

## Developer only

- The `read_performance`, `capture_performance_profile`, `capture_heap_snapshot` and `capture_memory_reading` operations and the `performance` skill are a developer module with the `developer` mark. Module [[9bb175ec]] splits: recording, storage and export stay in the shared part, on-demand reading and captures move to the developer module, which only the `dev` composition wires in.
- Reading at the developer's can open the user's report file as a record source.
- The release check (the three steps of [[e7b7be7f]]) also names this module among the missing: by mark, not by name.

## What the performer proves

- A release with no setting writes no spans; with `performance.spans: true` it writes; repeat recording writes them only in its own window and switches them off itself.
- A setting value resolves in order project → user → channel → key; `dev` and `stable` on one code yield different defaults.
- `tagma report` in a trial instance of the release assembles the file with the listed contents; it holds no thread contents or tokens (verified by a planted mark in a thread and in a token).
- The report file opens with the developer's reading; its stack is translated by `tagma:stack`.
- The release has no performance reading and capture operations and no `performance` skill: the metafile and the operation registry.
- Measured on one instance: the server's idle CPU and the count of dropped records per hour in `stable` versus `dev` — as a sample on one machine.

## Out of scope

- Automatic report sending and server-side failure collection (Sentry and the like): only by the operator's decision, with its own user consent and the address in the network-call list.
- A report from the window when the server does not answer is in scope: the window then assembles the file from `serve.log` and the storage's last segment ([[1c89545b]]).
