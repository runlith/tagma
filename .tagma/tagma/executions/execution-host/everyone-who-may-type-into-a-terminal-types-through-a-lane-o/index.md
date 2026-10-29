---
id: 01a0cf4b-e0e9-7112-b3cc-c5f27aec9851
title: Everyone who may type into a terminal types through a lane of their own, and control leaves the system
ord: 61
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
## Outcome

Everyone who may type into a terminal types through a lane of their own, at once and side by side: every view the operator has open, the server writing words into a harness CLI, and an agent working its own terminal. Nobody takes, holds or gives back anything in order to type. The operator never meets the words "keyboard" or "control", a banner saying control is elsewhere, or a button to take it. A dropped connection, a hidden tab or a server restart costs nobody an act they must take.

## The target architecture

- **A lane per writer.** A lane is one writer's ordered, numbered road into one execution. Its numbering means no act is lost or admitted twice, and lanes never fence each other.
- **Whether a writer may type is the server's rule, checked on every act** [[0f46b45c]]. It is never decided by who holds a keyboard. The host already trusts its custodian, the server, for every principal it names: `ControlBindings.open` checks the connection and the epoch, never the principal. The host keeps a lane to one execution and ends it when that execution changes hands.
- **Custody is who answers for the process**: whose thread it ends with, who is told of its ending, and who may stop it or hand it on. It moves only by an explicit transfer, presented by the holder's own principal. The operator's Take over in the pane menu is one such transfer. A transfer ends every lane into the execution, and whoever may still type opens a new one.
- **One grid per execution, kept by the host and carried in its record.** Every view, live or replaying, lays the bytes out at the size they were written at. For each terminal, the view the operator last typed into decides the grid.
- **An agent sees who else typed into its terminal** when it next reads it.
- **Control stops existing**: no controller, no control generation, no take, no release.

Terminal multiplexers settled on this model: in a shared tmux session every attached client types, and none takes anything to do it. tmux also decides the window size by the most recently active client by default. What an agent product adds is custody, the answer to whose work it is, kept apart from typing.

## Why

Today three facts are one: the right to type, who holds the terminal, and who decides its grid. A control binding types only as the standing controller, only the holder's own inject lane types beside it, and every take fences the controller before it (the control-fence claim, deleted by phase 4). The operator met each weld on 2026-09-23:

- two views of one terminal fencing each other: "Control is in another view";
- a hidden tab's dropped socket closing the keyboard: "Type here to take the keyboard";
- typing into an agent's terminal requiring its custody to move [[04ea7e14]].

The operator's terms: agents and the operator share terminals without conflict, the operator never thinks about whose keyboard it is, and the architecture is the best one the product can have rather than a patch over the current one.

## Phases

Each phase lands whole and leaves every road working.

1. [[22097468]]: every view of the operator types, and nothing on screen speaks of a keyboard. This alone ends everything on the operator's screenshots.
2. [[da58f62e]]: the grid is kept by the host and carried in the record.
3. [[21c657bc]]: an agent's reads of its terminal say who else typed into it.
4. [[afbf1202]]: agents type through lanes, and control leaves the system.

Phases 2 and 3 depend on phase 1 alone, in either order. Phase 4 comes last because it removes what phases 1–3 no longer use.

## The spec list ([[8dab19b6]])

Each phase decision answers the whole list for its own change: questions 1–9 in its opening sections and 10–17 in a section of their own. What stands at this level:

- **1 Outcome, 4 Target model, 2 Problem:** above.
- **3 What holds now:** checked against the code in [[22097468]], which changes most of it; each later phase adds what it reads.
- **5 Owners:**
  - the host and its vocabulary (`packages/execution-host`, `packages/executions`): lanes, the grid track, the removal of control;
  - the server (`apps/tagma/server/src/terminals`, `socket/terminalChannel.ts`, `http/handlers/terminals.ts`, `api/terminals.ts`, `operations/terminals.ts`, `harness/HarnessLanes.ts`): who may open a lane, a lane's lifetime, the agent's note and the operations agents type through;
  - the app (`apps/tagma/app/src/lib/features/terminals`, `features/harness/ThreadTerminal.svelte.ts`);
  - the capture instrument (`packages/llm/src/capture`), which takes a keyboard today [[1e016408]].
- **6 Rejected**, for the model as a whole:
  - *A keystroke silently takes control.* Two views typing alternately fence each other on every change of hands, and a key typed under the old generation is refused and lost. This is the current model with the button hidden.
  - *Control kept for the grid alone.* It costs a custody act on every change of focus, and an agent's terminal could never follow the operator's view without displacing the agent.
  - *Agents keep typing through control.* There would be two ways to type forever, and a generation that fences only agents.
  - Each phase lists the alternatives that shaped its own parts.
- **7 Acceptance, 8 What stands, 9 Order:** per phase. The order across phases is above.
- **10–17:** answered per phase. Across all four, one constraint shapes every phase: a host change reaches running terminals only through a host replacement, and a replacement ends them until [[fb5c1b45]] is built. Phases 2 and 4b raise the host's wire, and 4a changes its admission in a way its server part cannot do without, so those three land through a restart while no execution is live. Phase 1 keeps today's road until its own host stands, so an ordinary restart lands it and the host follows at the next idle moment. Host releases are coordinated with [[8cb4e34f]], which changes the same host and wire. A release raises the wire at most once, by one over whatever stands; a release that raises it lands through a restart while no execution is live; and two releases ready at the same moment may share one replacement. [[22097468]], section 15, holds the file split.

## Out

- **How a terminal is drawn** ([[2739a187]]), beyond applying the grid track.
- **Bounded commands** ([[8aa8264c]]): they are piped and take no input. The stdin handle that moves to a lane in phase 4 belongs to held pipes starts.
