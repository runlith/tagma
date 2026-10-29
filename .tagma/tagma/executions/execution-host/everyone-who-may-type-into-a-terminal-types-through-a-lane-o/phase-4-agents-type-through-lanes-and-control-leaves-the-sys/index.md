---
id: 01a0cf56-2840-7e57-a738-3a9fafbf1202
title: "Phase 4: agents type through lanes and control leaves the system — no controller, no control generation, no take, no release"
ord: 12
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/executions/src/protocol/control.ts
---
## 1 Outcome

Nothing in the system knows control:
- no controller in a custody state;
- no control generation on an input act, a receipt, a grant, a view or a stored row;
- no take or release act;
- no binding kind, because a lane is the only binding;
- no `control_terminal` operation and no floor for it.

Every writer types through a lane. Custody moves only by a transfer, which the holder's own principal presents.

## 2 Problem

After phases 1–3 only agents still type through control. Keeping control for them means:
- two ways to type, forever;
- a generation that fences nobody else;
- every reader of the vocabulary learning a concept that decides nothing the product relies on.

## 3 What holds now

**How agents type:**
- `write_terminal`, `interrupt_terminal` and `resize_terminal` take `binding`, `generation` and `sequence` (`protocol/operations/terminals.ts`), and ride a grant minted by a take (`control_terminal`).
- The trust ask's `Input` subject is keyed by binding and generation (`terminalSubjects.ts`), under the floor `terminal-take-control` (`harness/capabilities/terminals.ts`).
- `terminalPolicy` answers `Input` eligible for every actor. Until phase 1, the host enforced that a writer holds the terminal.

**Starts and stdin:**
- An interactive start installs its starter's control [[18e1a478]].
- A held pipes start hands its starter a stdin handle [[643f44d2]]. `Terminals.pipeInput` sends `End` through it, and a lane admits no `End`.
- The managed spawner finds its binding through `custody.controller` [[41dfaa19]], and the managed world's port refuses `openBinding` (`managedWorld.ts`, `TerminalExecutions.openBinding`).
- The capture instrument's `Keyboard` takes custody and sends `End` [[1e016408]].

**Transfer:**
- `transfer_terminal` presents a binding nobody opened (`transfer:<operationId>`), and a real host refuses it. The whole-path suite pins that refusal.
- Only `attach`'s transfer works, because it opens the holder's scope first [[efa0424d]].
- A custody request is authorized through a binding scope (`wire.ts` `Custody` carries `scope`).

**What stores and carries control:**
- the host store's custody columns (`controller_principal` and its kin, and `generation`, `NOT NULL`);
- custody receipts inside the host's stored operation receipts (JSON);
- the server's projection `generation` (`NOT NULL`);
- `terminal_operation.mutation`, an enum holding `'control'` and `'release'`.

**What carries a generation between the app and the server:**
- `TerminalInputWrite.generation` and `TerminalInputReceipt.generation`;
- `TerminalAttachAnswer.generation`;
- the generation in HTTP input;
- `TerminalView.generation`;
- `occupancyOf(controller)`.

**The input frontier** a custody receipt reports counts the controller lane's sequence (`frontierOf`).

## 4 Target model

- **An agent's run opens a lane into an execution on its first act there.** The server numbers the lane and reuses it for the run, and the run's end ends it.
- **The agent names each act by an operation key, never by a sequence.** A lost answer is read back under that key, and the server maps the key to the lane's sequence, so rule [[274e6874]] holds on the server's side.
- **Starts:** an interactive start opens a lane for its starter, and when a run starts it, that lane is the run's lane.
- **Stdin:** a stdin handle is a lane, and a lane admits `End`.
- **Custody acts carry the acting principal, and no binding.** The host admits a transfer when that principal is the holder. It already trusts its custodian for every principal it names, and the custody revision guards concurrency.
- **What a transfer reports:** the execution-wide count of accepted bytes, which never resets [[7be771fe]]. It reports no lane's sequence.
- **Who may type:** a thread's lane opens only into an execution the thread holds, checked at the open and on every act. The operator's lanes stay as in phase 1.

## 5 Parts and owners

### 4a — agents onto lanes ([[ce024255]])

- **Host:** a lane admits `End`. This is a change of admission, not of the wire.
- **`packages/executions`:** the managed spawner opens a lane at accept and presents it.
- **Server:**
  - `operations/terminals.ts`, `protocol/operations/terminals.ts`: the typing operations drop `binding` and `generation`, and take an operation key instead of a sequence. The server holds the run's lane.
  - `terminalSubjects.ts`: the trust ask's subject is keyed by execution and run, so a silent reopen never asks again.
  - `terminalPolicy.ts` and `TerminalAccess`: `Input` from a thread is eligible only for an execution the thread holds.
  - `Terminals.ts`: the accept road opens the starter's lane.
  - `pipeInput`: it uses a lane.
  - `managedWorld.ts` and `TerminalExecutions.openBinding`: the managed world's port opens lanes.
  - `transfer_terminal`: it presents the holder's scope, opened and closed like `attach`'s.
- **Retired:** `control_terminal`, its floor `terminal-take-control` and its line in `api/operations.ts`. Its operation id is gone and never aliased.
- **`packages/llm/src/capture`:** `Keyboard` types and ends through a lane.
- **Saved approvals:** any standing approval of the take or release subjects is withdrawn with its reason, because no act can match it again.

### 4b — control removed ([[e5a549ef]])

4b is one change across every package, because the vocabulary is shared and the wire moves: a change to the vocabulary alone leaves the server and the capture instrument unable to typecheck.

- **`packages/executions/src/protocol`** loses:
  - `Controller` and `CustodyState.controller`;
  - `ControlGeneration` and every field carrying it, on input requests and outcomes, receipts and custody receipts;
  - the `Take` and `Release` acts and `BindingKind`.
  
  In the custody request, the binding scope becomes the acting principal.
- **The host** loses `ExecutionCustody.admits` and `decide` over controllers, and the generation lane in `ExecutionInput`. `host.controlReceipts` is renamed for what it counts. It is part of the reserved policy, so the rename makes a replacement due, and this release has one anyway.
- **The host store** drops the controller columns and the custody `generation`. Its stored operation receipts are read with the old shape, only to discharge them.
- **The server:**
  - `TerminalGrants` loses its take arm and the generation a grant pins;
  - the policy loses its Take and Release subjects;
  - `occupancyOf` goes;
  - the projection drops `generation`;
  - `terminal_operation.mutation` keeps `'control'` and `'release'` readable in old rows, and no new row writes them.
- **The app and server contracts** lose the generation fields listed in 3.
- **The take road of [[22097468]]** goes whole: `attach`, the road value and its old-host code, the pane's take, watch birth and control resize, `TerminalGrids`' page publish, and the `controlled` and `watching` states with the surface they drive.
- **The rule** [[39f511b4]] becomes "A host admits a lane's input — bytes, the interrupt, the grid and the end of input — into the one execution the lane first typed into, and ends the lane when that execution changes hands; custody acts are the holder's own".

## 6 Rejected

- **4b split into one change per package.** The first change could not typecheck, because the server and the capture instrument import every removed type.
- **A binding kind kept for custody acts.** The host trusts its custodian for principals, so a binding adds nothing to a transfer, and the revision already guards concurrency.
- **The agent keeps numbering its own acts.** Silent reopens renumber a lane under the agent. An operation key is how every other operation recovers a lost answer.

## 7 Acceptance

**4a:**
- An agent in a native thread and one in a foreign CLI each start a terminal, type into it, interrupt it and resize it, with no take anywhere on the road.
- A lost answer is read back by its operation key.
- A reopen asks nothing again.
- A thread's lane into a terminal it does not hold refuses.
- A second run of the same thread types through a lane of its own.
- A held pipes start's stdin is written and ended through its lane.
- `transfer_terminal` moves custody on a real host, and the whole-path suite pins the transfer instead of the refusal.
- The capture instrument still drives its clients.
- The catalog carries no `control_terminal`.

**4b:**
- No shipped source declares or reads `Controller`, `ControlGeneration`, `CustodyState.controller`, a `Take` or `Release` custody act, `BindingKind`, `occupancyOf`, `control_terminal` or `terminal-take-control`. Typecheck proves it.
- The migrations run over stores holding rows written before them.
- The host conformance suite, the server's terminal suites and the capture instrument's suite pass.

## 8 What stands

- **Dies:**
  - the control claims under [[fcb35f72]]: [[b705150b]], [[ae6f2b14]], [[bf01ae08]], [[52df18fc]], [[a6a5f309]];
  - [[9e45925c]].
- **Absorbed**, rewritten over lanes or the principal:
  - [[18e1a478]], [[41dfaa19]], [[643f44d2]], [[1e016408]], [[0f46b45c]];
  - [[37677b13]]: its floor goes, and the typing ask stays;
  - [[2a2ba6e4]], [[6ee72bd7]], [[4ae59e6f]], [[91bfa09e]], [[efa0424d]].
- **Revised:** the bodies of the areas [[fcb35f72]] and [[de5cd9ca]] ("the sequence one controller generation counts"), and rule [[39f511b4]].
- **Survives:** [[95f23a71]], [[b48299b7]], [[91c5fcd3]], [[274e6874]].
- **Tasks:** whichever of [[26641770]] and [[b8f0f683]] is still open when 4b lands is closed, naming 4b's commit.

## 9 Order

- **4a comes after phase 1.** Its host part rides a host release, and its server, executions and capture parts land with that release, because they send `End` through lanes.
- **4b comes after 4a and after phases 2 and 3,** as one change.

## 10 Contracts

**Operations (4a):**
- `control_terminal` is removed.
- The typing operations take the execution, the act and an operation key, with no binding, generation or sequence.
- `read_terminal` loses the control generation and the keyboard occupancy, and keeps the lanes phase 1 added.
- Foreign CLIs read the catalog when they connect.

**Host wire (4b):**
- The custody state, input requests and outcomes, receipts and custody receipts lose their control fields.
- The custody request's scope becomes the principal.
- The act union loses `Take` and `Release`.
- `WIRE_VERSION` rises by one over whatever stands when 4b lands, and 4b's commit says so.

**App and server (4b):** the fields listed in 3 lose their generation.

## 11 Stored data

- **4a:** saved take and release approvals are withdrawn with their reason. Nothing is rewritten.
- **4b, host store:** the controller columns and the custody `generation` go. Stored operation receipts are decoded with the old shape to discharge them.
- **4b, server store:** the projection `generation` goes. `terminal_operation.mutation`'s old values stay readable.
- **Rollback:** the migrations are forward-only. An older build selects the dropped `NOT NULL` columns and cannot read the store, so 4b is rolled forward, never back.

## 12 Who may do what

- **What a thread may type into:** only an execution it holds. The server checks that at the lane's open and on every act (`terminalPolicy`, `TerminalAccess`), because after phase 1 the host no longer compares a lane's principal with the holder.
- **Unchanged:** the reach-any ask for signal, stop and transfer.
- **Who may transfer:** the holder's principal. The host checks it against the custody state it holds.
- **If the server's check is wrong:** as in [[22097468]], a writer types into one execution until its lane ends.

## 13 Long-lived things

- **An agent's lane:** opened at its run's first act on an execution, and ended by any of:
  - the run's end;
  - a transfer;
  - the execution's end;
  - the custodian epoch's end.
- **Races:**
  - A run ending mid-write has its remaining acts refused while the run is already ending.
  - After a transfer, the server reopens an agent's lane only if the agent still holds the terminal.

## 14 Bounded resources

- One lane per run per terminal it types into, within the ceilings of [[22097468]].
- The server's grant count loses the take road.

## 15 Rollout

- **4a** changes the host's admission, so it is a host release with its server and executions parts. It lands through a restart while no execution is live, and may share a replacement with a release of [[8cb4e34f]] ready at the same moment.
- **4b** moves the wire.
  - It lands only through a restart while no execution is live, and the commit says so.
  - Work that never ends keeps the host from being idle, and the answer is the one in [[22097468]] section 15.
  - A release raises the wire at most once.
- **Until [[fb5c1b45]]**, this is work that has to wait for running work to end.

## 16 Failures

- **An agent's lane refused mid-run:** it is reopened once, as a pane's is [[22097468]], and only for a terminal the agent still holds.
- **A lost answer:** read back under the act's operation key.
- **A 4b restart that finds live work:** the host is kept, and it is the operator's to replace. Nothing is ended silently.

## 17 Observability

- Typecheck over the removed symbols is the check that control is gone.
- The live grant count by road loses the take road.
- The lanes on `read_terminal` show every writer.
