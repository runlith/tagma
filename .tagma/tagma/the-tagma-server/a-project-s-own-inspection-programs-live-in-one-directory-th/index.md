---
id: 01a0da9e-879c-73fc-8ddc-d74a833122ed
title: A project's own inspection programs live in one directory the project declares, each self-contained in any language, with no SDK
ord: 46
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
The operator's word, 2026-09-25. A project's own inspection programs have one declared home in the project's repository. Each program is self-contained, in any language, and speaks the program contract with no SDK.

## 1. Observable outcome

- **A project setting `enforcement.programs`** names one directory of the repository, relative to its root. There is no default: a project with none declared has no project programs.
- **`read_inspections`** answers that directory. The `rules` agent ([[26598301]]) writes new programs there and nowhere else.
- **Nothing refuses a program elsewhere.** An off-the-shelf SARIF tool runs from wherever the project installed it. The directory is where the project's own programs are written and found, not a gate.
- **A program is self-contained.** It reads the contract JSON on stdin and prints violations or SARIF on stdout. Code several of a project's programs share lives as a module in the same directory.
- **Tagma ships no SDK.** `read_inspections` answers the contract's JSON Schema, which is enough for every language.

## 2. Problem, with evidence

- runlith's layer runner stands in `scripts/testLayer.ts` among unrelated scripts. Nothing marks it as a Tagma inspection.
- The planned SDK would be a versioned package to ship, install and maintain in order to save about 10–20 lines per program: parsing the input and printing the output. For a `local` reach the engine already hands a program the texts of the changed files.

## 3. What holds now

- Command inspections are built ([[50467aad]]) and triggered by the operation door ([[b9bdfa95]]).
- The contract is served by `read_inspections`.
- `scripts/testLayer.ts` speaks contract 1, and the tests thread owns it.

## 4. Target model

- **The setting** lives in project scope, is writable by an agent under the thread's mode, and is read once per enforcement.
- **The directory:**
  - it is tracked, so programs land with the code they judge and are reviewed like it;
  - it is never `.tagma` or anything under `~/.tagma`, which belong to the server;
  - the repository chooses its name.
- **Packs** (rules plus programs shipped by Tagma) wait until a program repeats across projects. The first candidate is bun's test layers. Out of this decision.
- **For runlith:**
  - the directory is `checks/` at the repository root;
  - the tests thread moves `scripts/testLayer.ts` there;
  - the preload guard `test/layers.ts` stays where it is, because it is runlith's test runtime, not an inspection.

## 5. Owners and boundaries

- `enforcement/` owns the reading of the setting in `read_inspections`.
- `protocol/settings.ts` owns the key.
- The `rules` agent's identity names the directory's role, but not its name.
- The tests thread owns the move of runlith's runner.

## 6. Rejected alternatives

- **An SDK as a public npm package.** It is a dependency to version for little saved.
- **An SDK generated into an ignored directory.** A fresh clone or a CI run without Tagma cannot load the program.
- **No declared directory.** Programs scatter, and the setup agent has nowhere to look.

## 7. Acceptance criteria

- `read_inspections` answers the directory, or answers that none is declared.
- The `rules` agent, asked for a check no builtin covers, writes its program under the declared directory. With none declared, it proposes one first.
- In runlith the layer runner stands under `checks/`, and its contract test passes from there.

## 8. What becomes of each claim and task it touches

- The claims over command inspections gain the directory.
- Idea [[2b4bf576]] (where a program's code is read from) is untouched.

## 9. Order of building

The setting, `read_inspections` and the `rules` agent's prompt first. Then the runlith directory, with the move done by the tests thread.

## Spec list

- 10 Contract: additive. There is one new setting.
- 12 Who may do what: writing the setting follows the settings permission floor.
- out: stored data beyond one setting, long-lived things, bounded resources and failures.
