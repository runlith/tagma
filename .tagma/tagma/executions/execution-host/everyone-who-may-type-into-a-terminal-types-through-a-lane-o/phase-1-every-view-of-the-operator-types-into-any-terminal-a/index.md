---
id: 01a0cf56-281d-7ffa-a766-934722097468
title: "Phase 1: every view of the operator types into any terminal, and nothing on screen speaks of a keyboard"
ord: 9
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/Input.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/PaneHost.svelte
---
## 1 Outcome

Every view the operator has of any terminal types as soon as the operator types into it:
- a pane on the terminals page;
- a harness thread's terminal, on its page or in the panel;
- one terminal open in two windows.

This holds for terminals the operator holds and terminals an agent holds, and typing means keys, paste, interrupt and a dropped path. No surface shows a bar, a button, a state or a sentence about a keyboard or control.

Every view measures its own box. For each terminal, the server applies the box of the view the operator last typed into, in any window, and a terminal with one view takes that view's box; every view of it, in every window, draws at the grid applied. Hovering, focusing and an agent's typing choose nothing. Typing never moves custody. Agents keep typing through the control they hold until [[afbf1202]].

**Known limit until [[da58f62e]]:** a replay, and bytes written before a view learned a new grid, are laid out at whatever size the engine had.

**Known limit while the host predates this phase:** until the replacement that lands this phase's host part, terminals behave exactly as before it (section 15).

## 2 Problem

The operator meets three things:
- "Control is in another view";
- "Type here to take the keyboard";
- "Take the keyboard" on an agent's terminal, which moves its custody [[04ea7e14]].

Each is the right to type being control: a control binding types only as the standing controller, and every take fences the controller before it (the control-fence claim, deleted by phase 4).

## 3 What holds now

**The host:**
- **Admission** (`ExecutionCustody.admits`): a control binding types only as the standing controller at the standing generation. An inject binding types `Write` and `Interrupt`, never `Resize` or `End`, and only while its principal is the holder.
- **Bindings** (`ControlBindings.open`): a binding is admitted for whatever principal the custodian connection names. The check covers the connection and the epoch, never who the principal is. The bindings table is host-wide, while admission is gated per execution (`Execution.admitInput`).
- **`CloseBinding`** authorizes the binding first, so a binding the host already forgot answers a refusal.
- **Custody acts:** `ExecutionInput.enterGeneration` runs on every custody act and keeps only the holder's inject lanes.
- **Resizes:** the reserved-geometry bound already applies to every one (`Execution.admitInput`).
- **Input receipts:** an execution keeps 32 for all its lanes together, retaining the bytes themselves, and evicts the oldest across lanes. Its reserve charges `input.receipts × input.chunkBytes` (512 KiB), as [[f32bb084]] requires. `host.controlReceipts` is something else: the slot budget for durable custody writes.
- **Refusals:** the wire's `Refusal` is a closed union of 16 tags, and the wire test pins its fingerprint, so a new tag raises `WIRE_VERSION`. `refusalOf` has no arm for `BindingUnknown`, `BindingInvalidated` or `PrincipalMismatch`; they reach the server as `HostConflict` with the bare tag.

**The server:**
- **Grant checks:** every input re-checks a grant (`TerminalGrants.evidence`, [[0f46b45c]]). It answers `no-grant` or `stale`. `stale` covers:
  - a revocation whose fence is pending;
  - a different run;
  - a different target;
  - a different generation;
  - a republished permission revision.

  Every revocation closes its binding at the host. A close that the host refuses leaves the fence pending, and nothing retries it.
- **Ceilings:** 512 grants on the server, 4096 bindings on the host. `Terminals.openBinding` reports a host ceiling as `no-binding`.
- **Harness words** type through an inject lane (`HarnessLanes.open`, [[6ee72bd7]]). The lane's memory of named acts keeps a retried screen answer from typing twice [[836ea3a3]]. Conflicts on it are deliberate [[e416b589]], and it never subscribes to receipts.
- **`attach`** opens a control binding for the take and one under the displaced holder for the transfer. On an uncertain or refused answer it returns before closing anything. It is the only road that gives a pane a generation to type under (`TerminalInput.takeControl` installs the one `Attached` carries); the custody door's Take refuses a non-holder (`NotHolder`).
- **`Terminals.openBinding`** opens the host binding before it settles the grant, and nothing closes that binding when the grant refuses at its ceiling.
- **Which host stands:** a failed offer (a checkout producer failure or its 20 s timeout, a closure copy or verify failure) answers `Standing` with the bundle already in place, so adoption reads `Same`; `Unread`, `Unmeasured` and a `Deferred` standing carry no comparison with this build. None of them tells this server that the host is its own.
- **Sentences that name control or the keyboard:**
  - server-side: `TerminalGrants`; the socket gate (`terminalChannel.ts`); the ways out in `terminalRefusal.ts`; `Terminals.ts` (a refused binding open, `attachRefusal`); `operations/terminals.ts` (the write body's "take control again", which the pane's HTTP paste road reaches); `HarnessLanes`; `harnessKeyboard.ts`; `HarnessPermissions.ts` (code `no-keyboard`); the host's `custodySentence`;
  - in the app: `ProcessLine.svelte`.
- **Unproduced:** the revocation cause `view-closed` is declared, and nothing produces it.

**The app:**
- **The pane** takes control at attach (`TerminalInput.takeControl`) and pipelines up to 32 unanswered socket acts. A paste goes alone, through the HTTP door. On a conflict or a refusal the keyboard closes [[4c7866cb]].
- **Tabs:** every tab's panes are mounted [[dc4c2ea2]]. A tab opens an agent's terminal watching [[74f1ee3a]], and every other pane takes control at bind (`TerminalPane.subscribe`), so every bound pane resizes its pty today.
- **Grid:** each attached pane decides its own terminal's grid (the per-pane grid claim, deleted by phase 4). The grid is published per page (`TerminalGrids`, deleted by phase 2), and a view without control fits nothing [[7fab8e4d]]. `TerminalFit.carries` never re-sends a grid it already forwarded.
- **Focus-follows-mouse** can move the keyboard on hover [[2d3b72da]].

**The wire and the host's rollout:**
- The wire is version 24.
- A restart that meets a changed bundle on the same wire adopts the host with a replacement due. The replacement is applied when idle, retried every 30 s for up to 24 hours (`terminalsLayer.ts`, [[447793c9]]).

## 4 Target model

- **The inject binding becomes a lane.**
  - It is bound, atomically, to the execution of its first act.
  - It admits bytes, the interrupt and the grid there, and its principal is no longer compared with the holder.
  - It keeps its own receipts inside the execution's reserve.
  - A transfer ends every lane into the execution.
- **A view opens its lane when the operator first focuses or types into it.** It keeps the lane until it ends. The server decides at the open, and the grant on every act.
- **The grid is decided per terminal, by the server.** Every view reports its box. The server sees every view and every lane's typing across windows, so it applies the box of the view last typed into, or of the only view, through one grid lane of its own per execution, and tells every view the grid it applied.
- **Until the host predating this phase is replaced, today's road stays, whole.** The lane road stands only while the standing host itself declares that it admits lanes; in every other case the road is today's. The pane learns the road before it binds.

## 5 Parts and owners

### Host — `packages/execution-host` ([[930e0cfb]])

- **`ControlBindings.authorize`** records a lane's execution at its first act in the same atomic step that checks it, and refuses the lane at any other execution.
- **`ExecutionCustody.admits`**, for an inject binding: it admits `Write`, `Interrupt` and `Resize`, and no longer compares the principal with the holder.
- **Transfer:** on a transfer, `enterGeneration`'s successor ends every lane into the execution. Take and release keep lanes.
- **`CloseBinding`** of a binding the host no longer holds answers `Unbound`. That way the server's revocation of an ended lane completes, and no fence stays pending.
- **Input receipts** are retained per lane, up to the pane's window of 32 each (a host constant, never a policy field: the capability profile rides the wire), and within the execution's total `input.receipts`, which rises from 32 to 128.
  - 128 is four typing lanes at once — two operator views, the harness lane and one agent — beside the server's grid lane, whose resizes are rare.
  - Past 128, the least recently active lane's oldest receipts go first.
  - The execution's reserve charges the new total ([[f32bb084]]): 2 MiB instead of 512 KiB, beside the 224 MiB of parser cells a pty already reserves.
  - `host.controlReceipts` is untouched.
- **The host declares that it admits lanes** in a figure its own code answers (Server, which road stands): the capability profile's `version` rises to 2.
- **No new refusal tag.** The wire keeps its version. A lane refusal travels as today, and the pane handles every one alike (Pane below).
- **Rule [[39f511b4]]** is revised in the same change. Accepting this decision accepts its new text: "A host admits a lane's input — bytes, the interrupt and the grid — into the one execution the lane first typed into, ends the lane when that execution changes hands, and never lets it take, transfer or release". The comment blocks above `admits` and `enterGeneration` go in the same change.
- **Coordination:** [[26641770]] and [[b8f0f683]] stand with another session, and this part does not touch `refusalOf`. `host.ts` is shared with [[8cb4e34f]], by region.

### Server ([[52d67932]])

- **Which road stands.** The lane road stands only while the standing host says it admits lanes: the host's own code declares it in a figure it answers today — the capability profile's `version`, rising from 1 to 2, whose schema already takes any integer from 1, so the wire's fingerprint does not move. The builder confirms that the host, not the profile the server supplies, sets that figure; if the server's figure reaches the host unchecked, the host part declares it in another figure its own code answers. A host that does not declare it — the host from before this phase, a failed offer, an unread standing — is today's road, and the restart says so. Bundle identity decides nothing here, because every later host release makes the standing host "not this build's" while it still admits lanes.
  - The road is one server-wide value. The terminal socket answers it at open and sends it again when it changes, and the lane doors refuse with an old-host code of their own while it is today's.
  - Once the replacement lands, every live execution has ended with the old host, so every pane after it is new and takes lanes.
- **The grid, decided here** (`ExecutionGrids`, a new owner beside `TerminalLanes` in `apps/tagma/server/src/terminals`):
  - every view reports its box per execution over the terminal socket, under a view id the pane mints, without any lane or grant; a view's report goes with its socket or its unmount;
  - **the lane knows its view.** The lane door's open takes the view id, and `TerminalLanes` keeps it by binding. `Terminals.input`, where the socket's writes and the HTTP door's pastes and dropped paths meet, tells `ExecutionGrids` of every operator act it admitted on a door lane, by binding;
  - the decider of an execution is the view whose lane admitted the latest operator act into it, while that view still reports; otherwise, the only view reporting; otherwise, the grid stands;
  - when the decider's box differs from the applied grid, the server resizes through its grid lane — one inject lane per execution under the operator's principal, opened with `executions.openBinding` and written with `executions.input` directly, as `pipeInput` does, because it carries no grant; opened at the first resize, reopened once after a transfer ended it, closed with the last view or the execution's end;
  - **an agent's resize stands.** A grid an agent's `resize_terminal` applied is not undone by box reports alone: the decider's box is applied again only after the next operator act admitted into that execution, or the next change of the decider's own box;
  - the server sends every view of the execution the grid it applied, whoever applied it, with the decider's view id;
  - reports are coalesced per execution, so a divider drag resizes the pty at most as often as the pane sends today [[f58668dd]].
- **`TerminalLanes`, a new owner in `apps/tagma/server/src/terminals`,** holds the lanes the door opened: their grants, executions and receipt subscribers.
  - The socket's `terminal.input.receipts` reports each subscribe and release to it.
  - Harness lanes are not its to hold.
- **Two doors beside `attach`,** under `/api/terminals/:execution/:incarnation/`:
  - open answers `{ binding, generation }`, opened with `Terminals.openBinding` of the inject kind under the operator's principal, with a grant that names the operator;
  - close takes `{ binding }`.
- **Who may open a lane:** the operator, into any terminal of the project [[f8029d37]]. A thread is refused until [[afbf1202]].
- **When a lane ends:**
  - on its close;
  - on its grace, which arms at the open and again at its last subscriber's release; a lane with no subscriber when it runs out is revoked with `view-closed`, and the driver lands in the same change (rule [[a00f91b0]]). The grace outlasts one reconnect of the page's retry loop, whose connect deadline is 10 s, and the builder names the figure beside that derivation;
  - on a transfer;
  - on the execution's end;
  - on the server's restart.
- **`Terminals.openBinding`** reports a host binding ceiling as `capacity`, and closes the host binding it opened whenever the grant that should settle it refuses, so a refused open leaves nothing on the host.
- **Take over** is a new door beside `attach`: `attach`'s transfer half alone, to the operator, with no take. It closes the binding it opened under the displaced holder whatever the answer, in a finalizer, and answers the new custody revision. `attach` itself stays exactly as today for the take road until [[afbf1202]] removes it.
- **The harness lane** keeps its memory of named acts across a reopen.
  - An act spent before a reopen is never presented again, and its fate stands as doubt [[fc45c5cb]].
  - It reopens only on a refusal of the lane itself, read from the cause inside `ThreadCallBroke`, never on the deliberate conflict [[e416b589]].
  - A spent act's sequence is never presented on the new lane, where it would be admitted again at that lane's `next`.
- **Every sentence and way out in §3's list** is rewritten to say what happened to the typing, never control or a keyboard. `HarnessPermissions`' and `HarnessLanes`' `no-keyboard` becomes a code about typing.

### Pane — `TerminalInput` ([[52c27ff4]])

- **The road is known before the pane binds.** The pane reads the road the socket answered before `TerminalTabs.land` and `TerminalPane.bind` act.
  - On today's road everything is today's: the watch birth, the take at bind, `attach`, the control resize, the surface.
  - On the lane road a pane is born neither watching nor taking. It opens its lane when the operator first focuses or types into it, and retains what is typed before the open answers, bounded as today.
  - A change to the lane road touches only panes born after it; the replacement that makes it has ended the executions they were bound to.
- **A lane-born pane that meets today's road** — the road answered on reconnect, or a lane door's old-host code — is reborn on it, as a pane born there would be: watching an agent-held terminal, taking an operator-held one. It never stops, and never takes an agent's terminal. This happens only when the standing host stops admitting lanes, such as a host rolled back.
- **On transport** ([[d65d5a7b]]): the window parks and is re-sent in order [[565f7ec2]].
- **On any refusal of the lane itself** — every `terminal-host-refused-…` code but the two below, `no-grant`, `stale`, `InputConflict` — it reopens the lane once, silently, and never tells the causes apart by text. `ControlLost` and `UnsupportedCapability` are not refusals of the lane: the first reads as the execution ending, the second as today.
  - Acts the gate took nothing for go again in order.
  - Unanswered acts, acts answered `InputReceiptExpired`, and whatever was typed behind them are settled as lost and said once [[cb1a859c]].
  - A fresh lane refused before it admitted anything says the server's sentence and stops. The next keystroke opens a lane again.
- **On `capacity`:** it says the server's sentence and stops.
- **On `InputEnded`, pressure, oversize or an unsupported act:** as today [[a11326c6]].
- **What goes from the lane road:** take, release, the custody revision, `RefusalAnswer`, `onControl` and `controlled`. The take road keeps them until [[afbf1202]] 4b removes it.
- **What stays:**
  - a pane's end closes its lane, and a remount keeps it [[9e33daef]];
  - restarting an ended shell opens a lane for the new one [[5dd271e8]];
  - Take over is its own act, and a lost answer is read back under its key [[3f793fbc]].

### Grid ([[893509b3]])

On the lane road only; today's road keeps today's grid whole.

- **Measuring is not resizing.** `TerminalFit` measures the view's box on every fit, with no gate, and reports it (Server, the grid). The engine is resized only to a grid the server applied, so a view never draws at a size the pty does not have.
- **The decider's own engine** resizes at once to its box when the server last named it decider, so the view being typed into refits without a round trip; the server's answer then confirms or corrects it.
- **Every other view,** on any page or window, follows the server's grid; `TerminalGrids`' page publish goes from this road.
- **Typing, not focus, makes a decider,** and the server sees the typing, so focus-follows-mouse [[2d3b72da]], a hover and a lane opened by focus move no grid. Typing into another window's view makes it decider and applies its latest box, past anything `carries` would have held back.
- **What moves to the server:** the last-resort forward (the last-resort forward claim, deleted by phase 4) and the settled grid kept for the next birth [[8bb0da65]] become the server's applied grid.

### Surface ([[3320f75c]])

- **What goes from the lane road:**
  - the "Control is in another view." bar;
  - the "Watching — held by …" bar and its button;
  - `noteProblem`'s "Type here to take the keyboard";
  - `ThreadTerminal`'s `controlElsewhere` state;
  - `TerminalTabs.land`'s watch birth;
  - `ProcessLine.svelte`'s "with the keyboard".
- **What stands:**
  - an agent's terminal names its holder as a quiet fact in its title bar;
  - Take over stands in the pane menu, only where the operator does not hold the terminal, and the agent is told at its next turn.
- **The take road**, used only while the host predates this phase, keeps today's surface, and with it the `controlled` and `watching` states that drive it (`TerminalPaneHost.svelte`, `ThreadTerminal.svelte.ts`). They are removed with the take road in [[afbf1202]], not here.

## 6 Rejected

- **The operator's lane opened under the holder's principal.** The host would name the agent as the writer.
- **The execution named at `OpenBinding`, or a new refusal tag per binding refusal.** Either changes the wire, and a wire change with live work leaves terminals refusing until the host is replaced by hand [[4473e762]]. The pane does not need to tell those refusals apart.
- **A lane bound to no execution.** Binding it costs nothing, and it keeps a server defect from reaching a second execution.
- **Lanes ended by take and release.** Every agent take would drop the operator's views, although the holder did not change.
- **A per-page election, or focus gating the fit.** An election makes two windows two deciders. Gating the fit on focus stops every unfocused terminal from fitting its pane.
- **Each decider resizing through its own lane.** Most deciders hold no lane — a terminal shown once, the panel's harness terminal while the operator types in the composer, the unfocused side of a split — and opening one at the first fit is the lanes-at-mount cost below. The server sees every view and every act, so it decides across windows too, and one grid lane per execution costs one binding.
- **`attach` changed in place into Take over.** The take road needs today's `attach` until the old host is gone; a new door leaves it whole.
- **Reading the road from a replacement being due.** A failed offer, an unread or unmeasured standing and a deferred one all look like the server's own host by that test, and the lane road would then meet a host that refuses it.
- **Reading the road from the bundle's identity.** Every later host release, and a replacement deferred over live work, would turn a host that admits lanes into "not ours", and switch open pages back to today's road with nothing ended.
- **Lanes opened at mount.** Every mounted pane of every tab would hold one, and about 25 reloads of a 20-terminal page within one grace would reach the 512 grants.
- **Receipts charged to `host.controlReceipts`.** That budget holds custody writes in flight; long-lived input receipts would starve every take and transfer.
- **Landing only through an idle restart, with no old road kept.** A restart with live work would run the new pane against the old host, whose refusals nothing could tell from real ones.

## 7 Acceptance

**Host suite:**
- a lane types into and resizes the execution of its first act, and is refused at another, even when its first two acts race at two executions;
- a lane of a principal that is not the holder types;
- a transfer ends every lane into the execution, and the server's revocation of them completes as fenced;
- a take leaves lanes typing;
- four lanes with 32 acts each in flight, re-sent after a dropped connection, get their receipts;
- custody acts through a lane refuse, and no generation advances;
- the harness lane still delivers words.

**Against a running floor:**
- two views of one terminal type interleaved, and neither is refused for the other;
- an agent-held terminal takes the operator's typing, and its holder and revision are unchanged;
- a page closed without closing its lanes, and a lane opened and never subscribed, are both revoked within the grace;
- after the grace, twenty reloads leave the live grants and host bindings where one page leaves them;
- Take over leaves no binding or grant behind but the operator's lanes, and also when its answer is uncertain;
- a screen answer retried across a harness lane's reopen is typed once;
- a lane open refused at the grant ceiling leaves the host's binding count where it was;
- with the standing host from before this phase, and after a failed offer, the socket answers today's road, the lane doors answer the old-host code, and a pane types, resizes and watches by today's road;
- two views reporting different boxes: the pty takes the box of the one whose lane typed last, both views receive that grid, and a view that only focused changes nothing;
- one view reporting, never typed into: its box resizes the pty;
- a paste through the HTTP door makes its view the decider, as a keystroke does;
- an agent's `resize_terminal` stands while a view watches, until the operator types or the view's box changes;
- a restart onto a later release, with the lane host deferred over live work, keeps the lane road, and open panes type on;
- a lane-born pane whose host stops admitting lanes is reborn on today's road and types, and an agent-held terminal stays with its agent.

**Live, on a build of the working tree:**
- two windows type alternately into one Claude Code thread;
- a tab hidden for ten minutes types on return;
- typing into the other of two windows resizes the pty to it, the first window then draws at that grid, and hovering does not;
- a split refits both terminals, a divider drag refits both sides, and resizing the window refits every visible terminal;
- the panel's harness terminal fits while the operator types in the composer;
- opening an agent's terminal from its row types at once;
- Take over moves the holder, and the agent is told;
- no terminal or harness-terminal surface, and no sentence the server sends one, names a keyboard or control.

## 8 What stands

- **Dies**, replaced by claims written from the built code: [[87f3985a]], [[4c7866cb]], [[5ac73068]], (the per-pane grid claim, deleted by phase 4), [[74f1ee3a]].
- **Absorbed**, rewritten over the lane or the decider:
  - [[cb1a859c]], [[f6334f7e]], [[9e33daef]], [[5dd271e8]];
  - [[31d65661]], which loses its clause about a view that only draws;
  - (the last-resort forward claim, deleted by phase 4), [[8bb0da65]], the page publish claim (deleted by phase 2), [[7fab8e4d]], [[9dec572a]];
  - [[565f7ec2]] and [[d65d5a7b]], whose bodies say a refused lane closes where it now reopens;
  - [[3f793fbc]] and [[04ea7e14]], which become Take over;
  - [[0798a06c]], which loses `controlElsewhere`;
  - [[4ae59e6f]], because lanes now end on a transfer;
  - [[836ea3a3]], because its memory now crosses a reopen.
- **Revised:** rule [[39f511b4]], and the body of rule [[868d8c63]] ("the keyboard decides which box sizes the shell" becomes the decider).
- **Stands:**
  - [[f32bb084]], with the receipts in the reserve;
  - every other claim under [[fe4e48f2]], [[694602e9]] and [[2739a187]]. "The keyboard" in the titles under [[694602e9]] is the page's DOM focus;
  - [[6ee72bd7]], (a harness-lane claim, deleted by phase 4), and (the inject-generation claim, deleted by phase 4) until phase 4.
- **Tasks:** [[26641770]] and [[b8f0f683]] stand with their holder. The four open tasks under [[2c8c1d90]] and its comments-standing finding are untouched.

## 9 Order

The host and server parts are built side by side. The pane, the grid and the surface follow in that order, by one owner, because they share `TerminalInput.ts` and `TerminalPane.svelte.ts`. All five land as one release (section 15).

## 10 Contracts

- **Host wire:** no frame changes, no new refusal tag, and the version does not move.
- **Server HTTP:**
  - the lane doors, as in section 5;
  - the Take over door, answering the custody revision; `attach` is unchanged;
  - the old-host code and `capacity` travel through the one refusal vocabulary [[bdd85dc6]].
- **Terminal socket:** it answers the road at open and on change; it takes a view's box report and its withdrawal; it sends the grid applied to every view of an execution, with the decider's view id.
- **The lane door's open** takes the view id.
- **Host capability:** the profile's `version` 2 means the host admits lanes; its schema already admits it, and the wire's fingerprint does not move.
- **Operations:**
  - the catalog is unchanged;
  - `read_terminal` gains the lanes open into an execution, by writer;
  - its `occupancy` keeps meaning whether a controller stands, which operator views no longer create, so it reads `open` beside lanes that type. It goes in phase 4.
- **Compatibility:** the app is served by the server and ships with it.

## 11 Stored data

out: nothing stored changes. Lanes and grants live in memory, and `input.receipts` is part of the execution policy the host reserves by, not a stored row.

## 12 Who may do what

- **Who decides:** the server, at the lane's open and on every act. The host admits what its custodian opened, as it does for every principal.
- **What the host adds:**
  - it keeps a lane to one execution, checked and recorded in one atomic step;
  - it ends lanes on a transfer, and with the custodian's epoch.
- **Lanes that never typed:** a lane that has not typed is bound to no execution. The server's own revocation at a transfer ends it.
- **If the server's check is wrong:** a writer the server should have refused types into one execution until the lane ends. Custody never moves by typing.
- **The grid:** a box report needs only what watching needs. Only an operator act admitted through a lane makes a decider; a box report resizes the pty only as the decider's, and never undoes an agent's resize until an operator act or the decider's own box change.

## 13 Long-lived things

- **A lane's life:** opening, then open, then ended. It ends by:
  - its close;
  - `view-closed`;
  - a transfer;
  - the execution's end;
  - the custodian epoch's end.
- **Races:**
  - the per-execution gate serializes a transfer with typing, so acts after it refuse and the pane reopens;
  - two first acts of one lane at two executions are settled by the atomic check-and-set;
  - an open answered after the pane detached installs nothing [[f6334f7e]].
- **Leaks:**
  - a lane unsubscribed or never subscribed is revoked at the grace;
  - a revocation of a lane the host already ended completes as fenced;
  - Take over closes its binding in a finalizer;
  - a server restart invalidates every binding of the old epoch;
  - a lane open refused at the grant ceiling closes the host binding it opened;
  - a grid lane closes with its execution's last view report, and a view's reports go with its socket.

## 14 Bounded resources

- **Lanes:** one per view the operator has focused or typed into, one per harness session, and one grid lane per execution that has a view. Far fewer than the mounted panes; grid lanes hold no grant.
- **Ceilings:**
  - 512 grants on the server;
  - 4096 bindings on the host;
  - 128 input receipts per execution, charged to its reserve at 2 MiB.
- **At a ceiling:**
  - a grant or binding ceiling answers `capacity`, and nothing is evicted;
  - past the receipts, the least recently active lane loses its oldest first, and its re-sent acts are settled as lost.
- **The reserve's move** makes a replacement due by policy, and this release carries one anyway.

## 15 Rollout

- **An ordinary restart lands the release.**
  - The wire is unchanged, so the standing host is adopted with a replacement due, and the replacement is applied when idle, retried every 30 s for up to 24 hours.
  - Until then, and whenever the standing host does not declare lanes, the socket answers today's road, and every pane takes it with today's surface. A replacement that raises the old bundle again, after a failed offer, keeps today's road rather than believing it landed.
  - Any open shell holds the host from idle. In practice the release lands with every terminal closed, or through `tagma terminal replace-host --now`.
  - The replacement ends every live execution with the old host, so every pane after it is new and takes lanes.
- **Work that never ends** (a dev server under no deadline) keeps the host from being idle. The restart names the work that holds it [[32240cd7]], and the operator ends it or chooses `tagma terminal replace-host --now`, which ends running terminals.
- **Coordinated with [[8cb4e34f]]:**
  - a release raises `WIRE_VERSION` at most once, by one over whatever stands, and says so;
  - a release that raises the wire lands through a restart while no execution is live;
  - two releases ready together may share one replacement. This one may share [[8cb4e34f]]'s stage-1 replacement, whose wire change then decides the road: with a wire raised, the release lands through an idle restart.
- **File split:** custody, bindings and input admission belong to this decision; command admission, deadlines, the stop ladder and process watching belong to [[8cb4e34f]].
- **Shared files.** Each side reads `read_changes` before a wide edit and pings only when a hunk touches the other's region:
  - host: `packages/execution-host/src/host.ts`, `ExecutionRegistry.ts`, `db/schema.ts`, `ExecutionStore.ts`;
  - executions: `packages/executions/src/protocol/wire.ts`, `Executions.ts`, `ExecutionClient.ts`, `executionSpawner.ts`;
  - server: `terminals/Terminals.ts`, `TerminalExecutions.ts`, `terminalsLayer.ts`, `operations/terminals.ts` (its stop doors), `api/terminals.ts` (its stop schema), `harness/worlds/commandWork.ts`;
  - app: `features/terminals/TerminalsRepo.ts`;
  - capture: `packages/llm/src/capture` (`CaptureHost.ts`, `drive.ts` and `Exchange.ts` decode the stop policy [[f86edb6b]] removes).
- **Rollback:**
  - reverting the server and app over either host restores today's road;
  - reverting the host is another replacement;
  - a release shared with [[8cb4e34f]] carries its forward-only migration, and rolls forward only.
- **Until [[fb5c1b45]]**, no host change reaches a running terminal without ending it.

## 16 Failures

- **A dropped connection:** acts park and are re-sent, each lane with its own receipts. The lane stands through the grace. The view's box reports go with the socket, the applied grid stands, and the view reports again on reconnect.
- **A server restart:** a lane refusal, a silent reopen, and typing whose landing nobody could confirm said lost once. No act is asked of the operator.
- **A host replacement:** the execution is gone. The pane's ending belongs to the road that reports a lost record.
- **Two writers at once:** their acts are admitted in gate order, and their bytes may interleave mid-line, as in any shared terminal. This is accepted.
- **A transfer mid-typing:** acts after it refuse, and the lane reopens. Nothing typed under the old holder replays.

## 17 Observability

- The server spans lane open, close and revoke with the cause, beside `Terminals.input.gate` and the host's `admitInput`, and each grid applied with its decider.
- The restart and `read_terminal` say which road stands, and why when it is today's.
- Live grants are counted by road (lane, take, harness), and a count that climbs with no views open is a leak.
- `read_terminal` names the lanes open into an execution.
- The app's keystroke-chain marks [[07d3053e]] carry the lane's binding.
