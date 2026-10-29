---
id: 01a0f476-04f3-7b7d-8ecc-b27fb2965d21
title: A gate runs only the checker identity its rule adopted, from a prepared environment built from the checker's resolved closure, and fails closed when that environment cannot be prepared
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
Part of [[9140c692]]. It answers idea [[2b4bf576]]: which bytes a gate executes, so that neither an unlanded edit of a checker nor a dependency upgrade can change what a gate refuses without the law accepting it.

## 1. Outcome

- A gate executes only the checker identity the rule's adoption accepted, from a prepared environment built from that identity — never the working tree, never the live `node_modules`.
- A checker whose closure changed in the checkout leaves its rule `pending re-adoption`; the gate keeps running the accepted identity until `enforce_rule` adopts the new one.
- When the accepted environment cannot be prepared, the gate refuses `inspection-failed: checker not prepared`; it never falls back to the installed checker.

## 2. Problem, with evidence

A program with no `needs` runs in the checkout root and reads its own code from the working tree, unlanded edits included (M10, [[2b4bf576]]): a session can loosen its own gate by editing the program without committing it, and a peer's unfinished edit runs under another session's landing. Comparing both sides with a changed checker cannot recover the old norm: a plugin edited to report nothing yields two empty sides and passes.

## 3. What holds now

The program runs on the command road as the caller, in the checkout root, or with `needs: files` in a warm clone of the judged tree readied by the worktree setup (`enforcement/workers/programWorkdirs.ts`). Nothing records which checker bytes a rule was measured with.

## 4. Target model

- **Identity** is the digest of the checker's resolved closure:
  - the repository files it executes or reads as configuration, as blob ids: the import closure the facts kit computes for a JavaScript or TypeScript program or plugin, the descriptor's `pins` globs for any other, a config's `extends` resolved;
  - the transitive slice of packages that closure loads, as `name@version` with the lockfile's integrity, the tool's own package and binary included;
  - the runtime and its version (`bun@1.3.13`).
- **Scope.** Only that slice counts. Pinning the whole lockfile would re-adopt every runner rule about twice a day in runlith (31 lockfile commits in 14 days, M12), while the checkers' own packages did not move in 30 days.
- **Prepared environment.** Built from exactly the identity — blobs from git, packages by integrity, the runtime — and cached by digest in the enforcement store. Every judgement of that rule runs there; the judged tree's files are its immutable input.
- **Divergence.** When the checkout's closure digest differs from the accepted one, the rule reads `pending re-adoption` in every reading; the gate goes on with the accepted environment. `enforce_rule` re-measures with the new identity; a change its logic cannot prove a tightening asks the operator.
- **Unpreparable.** A fresh machine missing an artifact, a package gone from its registry: `inspection-failed: checker not prepared`, until the environment can be built or a new identity is adopted.
- **First phase minimum.** The descriptor's declared `pins`, declared `packages` and `runtime`. A dependency loaded dynamically outside what is declared or computed makes the check unable to promise a reproducible gate: the adapter says so and the check stays at watch.
- **Trust.** The digest identifies bytes; it isolates nothing. Project code keeps running as trusted code with the caller's authority on the execution host ([[50467aad]]).

## 5. Owners and boundaries

`enforcement/` owns computing the identity, preparing and caching environments, and the pending state; the facts kit answers the import closure; each adapter declares how its tool's own identity is read; the execution host runs the process.

## 6. Rejected alternatives

- **Run from the working tree** (today): the gate is loosened by an edit nobody landed.
- **Run every program in a clone of the base**: reading runlith's tree took 5.5–16.9 s under load ([[50467aad]]).
- **Pin the tool's version string only**: a helper in `node_modules` changes behaviour without changing the version.
- **Judge with the newly installed checker and only report the drift**: an edited checker that reports nothing passes on both sides.
- **Pin the whole lockfile**: unrelated upgrades would stop every rule twice a day (M12).

## 7. Acceptance criteria

- An unlanded edit of a pinned plugin and a changed package in `node_modules` do not change the gate's verdict; the rule reads `pending re-adoption`.
- A lockfile change outside the checker's slice leaves the rule accepted.
- With the prepared environment's artifact removed and unrecoverable, a gated landing refuses `inspection-failed` naming the checker.
- A re-adoption whose new checker finds fewer violations asks the operator.

## 8. What becomes of the claims and tasks it touches

- Idea [[2b4bf576]]: closed by the task that builds this, naming its claims.
- Claims of area [[5bc7cd8a]] on where a program runs and on its warm clone are rewritten from the code.

## 9. Order of building

After the policy codec and adoption ([[172759d0]]) and contract 2 ([[d11108eb]]): the declared identity and the prepared environment for programs and the `oxlint` adapter first; the computed import closure next.

## Spec-list questions

This decision answers 1–9.
- 10 Contract: the runner descriptor's `pins`, `packages`, `runtime`; the adoption record's checker digest.
- 11 Stored data: prepared environments are derived and disposable; losing one costs a rebuild.
- 12 Who may do what: adopting a new identity is `enforce_rule`'s act; an unproven change asks the operator. If the identity computation missed a file, that file can change the checker unseen — so an unknown dynamic load keeps the check at watch.
- 13 Long-lived things: an environment lives per digest, leased by each judgement that runs in it, evicted only when no lease holds it.
- 14 Bounded resources: environments take disk under a byte budget the enforcement store derives from the disk's size and free space (rule [[fe83acfa]]); at the budget it evicts unleased environments oldest first, and when none can be evicted the preparation refuses as `inspection-failed` naming the budget — never a partial environment.
- 15 Rollout: v1 program rules run as today until each is re-adopted on a descriptor with an identity.
- 16 Failures: a preparation interrupted by a restart leaves no environment marked ready; the next judgement prepares again.
- 17 Observability: `read_inspections` shows each rule's accepted and current checker digests and its pending state; the judgement span shows preparation time and cache hits.
