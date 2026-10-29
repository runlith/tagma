---
id: 01a10284-da13-7e0c-9742-a432e334c004
title: Bash does not take two full dirty checkout states around every command
ord: 33
tags: ["task"]
fields:
  {
    "holder": "tagma:01a102b4-1363-7f20-878c-3a9dab51a76c",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent-tools/src/CheckoutBaselines.ts
  - kind: file
    ref: packages/agent-tools/src/ShellRun.ts
---
**What.** Bash takes no two full dirty checkout states around every command.

**Why (perf audit 2026-10-03).** `packages/agent-tools/src/ShellRun.ts:258-272,334-367` and `CheckoutBaselines.ts:97-112,276-340`: before and after the measured command — `status --porcelain -z -uall`, reading and hashing each dirty file up to 16 MiB, `rev-parse HEAD`. Cost O(repository status + dirty bytes sum), even when the command wrote nothing; others' dirty files make every command costlier. Measured (instance 57f3a082): `ShellRun.open 91e77864ee21d235` — 9178 ms (checkoutState 7121 ms, commitOf 952 ms), `ShellRun.finish 31d8918a2087c671` — 4543 ms; inside — `fileDigest` up to 0.5 s and `Terminals.stop` 3.5 s (permit.wait 1.47 s).

**Direction.** A producer-owned reliable filesystem-change frontier with explicit loss semantics and full rescan; service git reads without the terminal's full lifecycle. Snapshots cannot be skipped or mtime trusted — observing foreign edits breaks. Agreed with the authorship-projection rework in [[00ddf0e5]].

**Done when.** A command that wrote nothing does not hash dirty files with a still-trustworthy stat entry; a fresh ctime requires sha, as in the change record. Foreign edits during the command are observed as before. Service git bypasses the terminal lifecycle; a clean isolated checkout's snapshot fits in tens of milliseconds. The full metadata frontier via git status stays on both sides; its cost on a working repository is measured separately.
