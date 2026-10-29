---
id: 01a0e532-cbc2-77b1-b2a0-aea561313d88
title: "enforcement N: narrowed"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e519-2c8e-7307-95c7-b14b4134178c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-c83e-75dc-a3c4-533ae1411479
  - kind: waits-on
    to: 01a0e532-ca7c-7f96-97dd-247ba9fd89de
  - kind: waits-on
    to: 01a0e532-cb8a-7bef-9a85-b3ffc595c5f9
  - kind: waits-on
    to: 01a0e532-cbb8-77b2-b7ee-c75c06488be1
  - kind: waits-on
    to: 01a0e532-cbfc-7817-83e6-7d22191594cc
  - kind: waits-on
    to: 01a0e532-cc21-7162-9c3e-d9aee2b6e4ec
  - kind: waits-on
    to: 01a0e532-cc6c-73df-a111-c28429ce4645
  - kind: waits-on
    to: 01a0e532-ccc1-799b-82bd-bde34047bdcd
  - kind: waits-on
    to: 01a0e532-cd48-7c09-999e-8e0c98746485
  - kind: waits-on
    to: 01a0e532-cd6e-7a04-85b9-0ab5dd5ad950
  - kind: waits-on
    to: 01a0e532-cf0f-7514-a91c-221fa544b85f
  - kind: waits-on
    to: 01a0e532-cf39-790b-91f0-e6587139e341
---
§7.2.2 milestone `N` of the `enforcement` card ([[f7e0b9dd]]), with its vocabulary amendment [[08edfbc5]].

Progress: swallowed failure sites and bounded remeasurement retries landed. The `gateMemoryAt.remember` site `f839a597` is now a declared best-effort allowance: the gate hint already stands in memory for the process and its failure is logged with its path, and neither a judgement nor an enforcement write may fail for the hint's persistence — so no conditional refusal exists and the debt retires. Entries narrowed to `contract/`, `enforcement.ts`, `cli.ts`, `cli/port.ts` (the three files to composition alone) and `testing/`; the 15 remaining `composition -> enforcement private` crossings stand as debt on composition N ([[c3975054]]), which binds enforcement through its manifest. Incoming worktrees, threads, native-harness and invocation M2 maps are closed and import only contract; source relocation and verification follow the merge into main, as tracked by [[4a9013bf]]. The independent performance work and its explicitly blocked shortcuts stand at [[4e4b72ad]].