---
id: 01a16df7-8d85-7ca6-8889-11ff06883e05
title: delete reported five files removed, then two edits vanished and one lost authorship
ord: 18
tags: ["reflection"]
fields:
  {
    "actual": "After the \"5 removed\" success read_changes left two edits at the thread, marked three withdrawn(reverted); git status showed mcpInstall deleted, but read_changes assigned it to nobody/team, while terminalDeclaration and mcpScope are clean again.",
    "command": "delete({args:[\"--\",\"apps/tagma/server/src/cli/terminalDeclaration.itest.ts\",\"apps/tagma/server/src/cli/mcpScope.itest.ts\",\"apps/tagma/server/src/composition/testing/cli/mcpInstall.itest.ts\",\"apps/tagma/server/src/composition/testing/cli/perf.itest.ts\",\"apps/tagma/server/src/composition/testing/cli/threadEvidence.itest.ts\"],workdir:\"/opt/workspaces/runlith\"})",
    "expected": "All five deletions stay the calling thread's edits, unless another writer explicitly restored the files."
  }
---
Filed from project `runlith`.

Thread 01a16dee-df17-75bd-8126-d73fe5acbe83. Its own delete call is the only intended change of those five files in the thread; after it only read-only git status/diff/log and a testbed over two other unit files ran. read_changes(path:mcpInstall) named the deletion an observation of the team of thread 01a16ded-1e3a-73ae-9e16-b62321fe10a1 from team 01a16a94-8d3a-7610-abd9-8503665bc41f. The cause of the two files' restoration is not established; those lines are not deleted again until authorship is clarified. HEAD moved in parallel.
