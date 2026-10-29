---
id: 01a0c4f7-9233-7c7f-a071-d63b4ac015f4
title: "Discipline A: architecture cut"
ord: 6
---
The architecture discipline hands each contestant `packages/agent/src/agent/AgentTurn.ts` as it stood at commit `b1f8e9da5` — one 901-line god-function — and asks for the cut.

- **The brief names the problem and the laws, never the shape.** Binding rules ride the brief: an owner is cut by the state it holds, not by its methods; a declaration moves down, never a port upward; shape and behaviour never change in one step — this is a shape-only change. The target decomposition is withheld: naming the cut is the measured skill, per `b72a9594`.
- **Hidden control.** The landed cut — commit `c18b9930f`, 901→307 with five phase owners under `agent/turn/` — enters judging as one more anonymous entry beside the contestants'. Its rank is an observation, not a calibration target: another cut may be better. Judges are not reweighted for disagreeing with the shipped reference.
- **Gates, run by the orchestrator in each tree**: `packages/agent` typecheck clean and its test suite green.
- **Measured**: gates; residual file size; what each new owner holds (state, or merely methods); direction between the new files; whether the report's claims match the diff.
