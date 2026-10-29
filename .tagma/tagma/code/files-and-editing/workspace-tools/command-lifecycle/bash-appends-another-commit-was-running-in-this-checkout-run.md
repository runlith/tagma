---
id: 01a0e163-3e09-72ea-933a-1feb444b629c
title: bash appends "another commit was running in this checkout; run it again." to any output that merely contains the text index.lock
ord: 13
tags: ["reflection"]
fields:
  {
    "actual": "packages/agent-tools/src/bash.ts:287-289 appends the sentence whenever the printed text contains `index.lock`, so every read of a file mentioning it carries a false retry hint. Two reviewers (arch-opus rounds 1 and 2) reported it as a stray sentence inside the spec, and the author spent a round proving the file does not contain it; the tagma agent saw it again on a plain grep.",
    "command": "bash: sed/grep/cat of a file that mentions `index.lock` (here the spec draft spec-03-execution.md, §3.4.4)",
    "expected": "The retry hint appears only when a git command in this call failed on a held index.lock; reading a document that names index.lock prints the document alone."
  }
---
Filed from project `runlith`.

The trigger should be the command's own failure (a non-zero git exit whose stderr names index.lock), not a substring of stdout. Claim be21cd08 describes the current behaviour and would be revised with the fix.