---
id: 01a12ca6-fabd-7fc4-8faf-ddd89a77da8d
title: check_rules loses the inner write-tree again on terminal-stale-authority without an execution address
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "refused[git-unavailable]: git write-tree ended and its console could not be read: terminal-stale-authority. The change tree is not built; no execution ref issued, though unblock asks to reread the command.",
    "command": "check_rules({over:\"change\",limit:50})",
    "expected": "Check builds the change tree and returns a verdict; on losing its inner git it names the execution to read the fresh state."
  }
---
Filed from project `runlith`.

This is the same Observe/Await chain after the rootUse cleanup, fixed by commit e3d3ce1d92: `CommandAdmission.prepareManaged` keeps a stable `viewOf(origin)`, and `admittedWatch` names execution/incarnation on console refusal. The operator's running server was built before that fix and does not carry it yet; the repeated refusal does not prove the new implementation defective.
