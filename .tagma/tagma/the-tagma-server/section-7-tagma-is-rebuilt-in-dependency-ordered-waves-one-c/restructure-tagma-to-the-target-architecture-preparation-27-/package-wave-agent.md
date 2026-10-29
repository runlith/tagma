---
id: 01a0e569-e6fa-7f7e-af9e-8c34052dc52d
title: "Package wave: agent"
ord: 62
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e868-6800-76dc-845f-c105fc11f74a",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-f876-7433-b54b-0ba8e4a0488f
---
The `agent` card of section 7 part 2 ([[e4a0488f]]), with its vocabulary amendment [[1deb33b8]]. Owns this package's `modules` and `names` debt.

The debt includes five `@runlith/agent -> @runlith/llm private` fingerprints covering six imports. Each is a test that loads a `@runlith/llm/profiles/*` value through llm's `profiles` port, which is closed to agent's values, tests included:
- `agent/DevinRunner.test.ts` (devin)
- `agent/ModelRequests.test.ts` (stepfun)
- `agent/agentSkillRequests.test.ts`
- `thread/compaction/ThreadCompaction.itest.ts` (anthropic)
- `thread/compaction/ThreadCompactionSummarizer.itest.ts`

To remove them, each test gets its profile from llm's `testing` entry or from a fixture of its own. Also in this wave: the kernel's working verdict (`ThreadSnapshots.state`, claim [[c3b8aee9]]) is decided by whether the run is open — `working` while it is open, `awaiting` while it is parked on a question, `idle` only when it ends — never by how old the heartbeat is, the same verdict the thread list took in main at `cd29969fd0` ([[9b58a025]]). A heartbeat that waits on the store writer under load must never make an open run read as ended. A unit test pins it: an open run whose last beat is older than the grace still reads working.

Its order and waits-on edges follow section 6 ([[be799808]]) and are added with the package groups' schedule.

## P2b input: what other waves deferred to the kernel's P2b

The P2b lifecycle and receipt rebuild is not this wave's work. These are the parts each wave left for it, collected so P2b starts from one list.

- **From `llm` ([[0d701139]], wave-llm):**
  - scoped model-client disposal;
  - one retry budget per logical call;
  - attempt receipts across stream, text, object and compaction calls;
  - versioned native receipts (`message.native`), with carried old-form decoders;
  - the migration of `ModelCalls` onto the new model-call contract.
- **From `agent-tools` ([[dad05c72]], commit `58ba6a361e`):**
  - tools adopt the kernel's effect-evidence and recovery contract;
  - bounded, durable custody of background and recorded work, promised only where the world actually offers it.
- **From `mcp` ([[e8918b55]], commit `7e60e8e9c6`):** kernel A7 effect-evidence alignment for MCP tool calls. The current kernel tool contract has no effect-evidence carrier. Served failures stay distinct from transport failures, and no automatic retry was added.
- **From this wave:**
  - `CollaborationVoice`'s product words (`branchBirth` naming `read_changes` and `submit_work`, and the voice's tool names) become input from the product's collaboration configuration (card 8(a), P2b "product wording becomes input").
  - `ThreadDirectoryActiveRun.heartbeatAt` (`thread/storage/directory.ts`) has had no production reader since the working verdict stopped reading beat age. It goes with `ThreadDirectoryStore` when P2b dissolves that store into `Threads.list`. Tagma's directory store and the storage-port conformance still select it.