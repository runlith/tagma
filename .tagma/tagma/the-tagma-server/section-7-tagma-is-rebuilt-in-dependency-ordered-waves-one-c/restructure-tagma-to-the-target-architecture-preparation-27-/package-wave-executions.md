---
id: 01a0e569-e6a2-755e-8d2c-583a2ef79a0b
title: "Package wave: executions"
ord: 55
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e9c3-5234-74ec-b21f-4fd941d87513",
    "status": "done"
  }
---
The `executions` card of section 7 part 2 ([[e4a0488f]]), with its vocabulary amendment [[1deb33b8]]. Owns this package's `modules` and `names` debt. Its order and waits-on edges follow section 6 ([[be799808]]) and are added with the package groups' schedule.

Closeout on `restructure`: the 11 subject tags and 27 production protocol files (26 in the card plus D7's `boot.ts`) have direct entries, no root export or workspace dependency. `8be169d2f1` masks five protocol unit files from the vocabulary wildcard with a null test subpath; Bun resolves `wire` and rejects `wire.test`. `executionSpawner.ts` has 699 lines against baseline 696, entirely three added imports; non-import lines are unchanged, so its F4 debt has not grown. Package typecheck exits 0 and all nine unit files pass (92/92). [[70083b67]] §2.4.10/D7 supersedes the card's wire 33/34 acceptance: the carried pair is 34/35, and a host of wire 33 or below receives skew. The v34/v35 corpus and artifact/record unit checks pass; cross-process handshakes and byte-record v1/v2 reads remain unproved until merge-time integration in [[4a9013bf]].

The exported failure folds in `hostArtifacts.ts`, `HostRegistration.ts`, and `RecordFiles.ts` landed with their package, execution-host, CLI and terminal consumers in `35997edb7a`. The record's missing seal, invalid identity and unreadable filesystem/segment reasons retain their evidence; artifact and registration mismatches retain their own reasons and the CLI's `host-mismatched` answer. Both packages typecheck; executions units pass 92/92 and execution-host units pass 312/312. The server typecheck remains red from the executions M2 file move (`./TerminalHostBoot.js`, `./executionPolicy.js`, `./hostRecovery.js`, `./hostReplacement.js` are not yet at their old paths); the diagnostics on our edited paths are those peer-moved imports only. `modules` and `names` over our production paths report zero new and zero unjudged. Integration/system acceptance remains unrun until merge [[4a9013bf]].