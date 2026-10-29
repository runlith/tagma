---
id: 01a0d5b9-9b63-7a8b-9893-9140f1f839ad
title: Checkout lines changed by a shell loop are never held, so submit_work cannot land them and they must be rewritten through edit twice
ord: 132
tags: ["reflection"]
fields:
  {
    "actual": "submit_work answered \"nothing to commit — paths named no file this session holds\". The first commit had already deleted test/noResidue.ts, which those 40 bunfigs still named at HEAD, so HEAD was broken. A write of identical content attributed nothing either. The only way through was an edit to an intermediate form and an edit back, 80 calls.",
    "command": "bash: a for-loop running `perl -0pi` over 40 bunfig.toml files (the shell allowed it: a variable path); then submit_work with those paths, with and without whole:true",
    "expected": "The loop's lines are attributed to this session, or submit_work can take an observed path the session itself moved, so the change lands in the same commit as the rest of the work."
  }
---
Filed from project `runlith`.

The refusal is honest to the record: shell observations prove no author. But the door that lets the loop run doesn't say that its lines won't be committable. The cost was about 80 tool calls, and a window in which HEAD did not build. Either the shell's answer should say that the moved paths are unattributed and name the way to adopt them, or there should be an operation to adopt one's own observed paths.