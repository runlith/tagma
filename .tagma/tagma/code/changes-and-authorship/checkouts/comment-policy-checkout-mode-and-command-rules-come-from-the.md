---
id: 01a12759-daf0-753f-9905-a6752d0b78de
title: Comment policy, checkout mode, and command rules come from the resource project; rename/delete are judged by the directory record, a resource outside checkouts by the thread home, and comment policy has no force there
ord: 7
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1273c-99cc-734f-a6ae-b0edd1e7ac82
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/commands/access.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/governing.ts
---
An agent edits files and runs commands in checkouts of any project on the machine, and policy belongs to the place, not to the thread's home. `governingProject` is the single rule for "which project judges this path": the resource's project from `CheckoutPaths.resourceAcross` (write/edit and cwd follow symlinks to the target); `CheckoutPaths.placeAcross` addresses the directory record for rename/delete. For a resource outside every checkout and for an isolated world (a sandbox, whose paths are the guest's namespace) — the home, as before cross-project work. The exception is comment policy (`checkoutSettingAt`): the prose-comment ban protects checkout code, so a file outside every checkout (thread scratch, artifact) is written as given; an isolated world is still judged by its home. Consumers (`worldTools`, `callOwners`, `callLifetimes`, command times) do not derive this themselves.

A thread's command rules live under its home and travel with the thread into another place: the place rule is the machine list + the place project's list + the thread's list (`currentRules(..., home)`). The host side (`CommandAdmission`) decides the same by the launch `cwd`, once at prepare; for a program over a private tree `policyRoot` names the checkout whose rules apply. The decision is kept in the request's `ruled` — the project for rules, the root checkout for program-folder rules, and the physical cwd; the executable launch gets the physical cwd, including for the home's second checkout. A recheck after approval does not redirect the act. Command custody (scope, target, owner) stays the thread's home: `ProgramRoad` runs another project's checker in the home scope with `cwd` at the place.

The home is read as a held value (`HeldSetting`); another project is read as `settings.value` on every act.
