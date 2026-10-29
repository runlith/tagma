---
id: 01a0f51b-7238-7f63-9ecf-e6b3f4c84296
title: Enforcement registers the law and enforced behaviour descriptors and preserves the role bindings through their translators
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f4b9-179b-7a55-a58a-c024cd12690c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f476-0506-7364-9447-e291172759d0
---
Register enforcement-owned `core/law` and `core/enforced` behaviour descriptors and their role translators through the module manifest, implementing [[172759d0]] §5 and the shared seam of [[877ba8f0]]. Class: simple.

**Scope:** two static descriptors/translators and the manifest contribution only — a subject-owned descriptor file under `apps/tagma/server/src/enforcement/` (`lawBehaviours.ts`, now in e5f17292a1) plus the `enforcement/enforcement.ts` contribution entry; focused owner tests and source-bound claims. The complex registry/compiled-table consumer belongs to tag-contracts (task [[974b0baf]]). The graph owns `BEHAVIOURS`, `Behaviour` and stable `LAW`/`ENFORCED` IDs beside `LawProjection`. Import those contracts; never register enforcement's descriptors from graph or duplicate the IDs. Existing lifetimes in the manifest belong to law-adoption and are not part of this edit.

**Contract:** `BEHAVIOURS.of(law, enforced)`. `Behaviour = { id, version, slots, words, actions, requires, check?, fromRoles? }`; bindings map slots to fields and meanings to enum words. `core/law` binds `enabled:boolean`; `core/enforced` binds `enforcement:{schema:'lawEnforcement'}` and requires `core/law`. Form-1 translators preserve the existing role field names and answers. Initial semantic versions are 1. The generic registry/compiler is task [[974b0baf]] on the tags side; its consumer is the real TagTable law projection. The lead coordinates that consumer and descriptor-version pinning with law-adoption; do not rewrite the projection schema, record codec or predicate while those owners work.

**Acceptance:** the enforcement manifest supplies exactly these owner descriptors; the real binding/compatibility contract accepts today's role bindings and rejects an incompatible field schema or an enforced binding without law. Existing role-based law answers remain equivalent. No new writable vocabulary format, production adoption, restart or rule loosening. Check typecheck and minimal contract tests (not static field/call-count assertions), within command limits and at most 3 workers. Completion requires the real graph consumer to use these contributions; report registration ready separately if the projection switch is not yet wired.

Read and claim this task before work; read affected owners and reconcile claims after the code. Commit own work with submit_work. No independent review per [[6ccec00a]] (simple work needs no review); completion still requires the consumer-parity integration evidence, so the task stays in_work — neither this task nor the adoption task is ready to finish.
