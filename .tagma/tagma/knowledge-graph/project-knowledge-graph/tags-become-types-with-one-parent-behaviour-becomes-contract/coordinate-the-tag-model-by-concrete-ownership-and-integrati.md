---
id: 01a0f506-735f-7be7-b3c3-749e0f83e781
title: Coordinate the tag model by concrete ownership and integration milestones with the law team
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d3dc-fb48-771a-8da2-f41be7bb5806",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e0cb-0087-794e-be47-9dc36bf40362
  - kind: relates
    to: 01a0f476-04c3-7115-9d3e-ca089140c692
---
Coordinates delivery of [[6bf40362]] with [[9140c692]]. This execution plan follows the operator's order to continue implementation without an artificial wait between phases. The vocabulary's guarded activation is one integration step, not each contributor's last line. No other design promise changes.

## Owners and independently executable work

- **tag-step-1 / Opus xhigh (done [[bbf9ebd0]]):** declaration compiler. Owns `Declaration` and `extends`/`open`, `compiler.ts`, compiler integration in `TagIndex`/`TagTable`, and descendant carrier validation. Its necessary `install.ts` change is only replacing per-tag validation with compilation of the complete candidate. It does not allocate identities, register behaviour owners or activate a new format. Continuation [[a8291517]] validates descendant carriers across parent birth, repair, trash and restore behind tag-step-1.
- **tag-ids / Opus high:** [[ee489b18]], stable type/field identity, aliases, immutable carrier keys, resolver and rename. Owns the resolver and identity metadata, tag lookup and rename semantics; coordinates only the concrete shared `TagIndex`/`blocks/update.ts` regions with compiler. No own catalog-install loop or compiler.
- **tag-catalogs / Sonnet high** (replacement for the unreadable tag-library thread), executor tag-catalogs: [[332acc2b]], catalog profiles and full system-library activation in accepted [[3087c3ed]]. Owns `catalogs/` declarations/registry and profile consumers in briefs, plus graph wire `Catalogs.transfersOf`, the catalogs filler `SYSTEM_TRANSFERS`, and `CATALOGS`/settings registration/profile. It preserves existing identity and provenance when moving view/proposal/reflection. It uses one profile type, not literals duplicated in graph core. Public fixture installation of notes+core is allowed, preserving provenance, carriers and local edits; `was` keeps the permanent identity, `is` names the destination export. tag-ids owns the verified old identity through transfer; tag-installer owns atomic membership/settle/release transfer.
- **tag-contracts / Opus high:** behaviour descriptors, contribution contract and compatibility checking, then [[fe92fe63]]'s role-to-contract migration. Owns registration and behaviour bindings, not a second inheritance compiler. Expansion into a contribution is handed to compiler; manifests declare their own contributions. Enforcement's own descriptors and predicate consumers are wired by the law team, through the same graph-declared contract.
- **tag-installer / Opus high (current piece done):** [[a869340b]], candidate/layer/fork lifecycle. Starts from the compiler API and the agreed adoption guard, never reimplements them. Owns `install.ts` lifecycle and its finding drivers. It consumes alias resolution; only it transfers installed catalog provenance/membership. Text-only candidates skip carrier validation; structural candidates validate the affected closure. Real remainder — automatic refusal keeps open plus previous version, durable four findings, public adoption/default-retention — now with tag-activation (thread 01a0f555-7aac-7873-8bc1-eb51da19fae9), Opus high.
- **tag-territory / Sonnet high:** documentation ownership over directory and file sources, independently of law units. Its source-kind change to `#module` is supplied to tag-library; its contract declaration is supplied to tag-contracts; it owns owner lookup and doctor territory algorithms.
- **tag-neutrality / Sol high (done [[63ab5550]]):** shipped vocabulary neutrality with contradictory workflows and a no-code project.

Compiler, identity, catalog/profile definitions and contract descriptors proceed in parallel. Candidate planning and territory algorithms proceed as their concrete inputs stand; integration does not use substitutes for unfinished neighbours. Queries ([[b9a417cc]]) begin once canonical-id resolution, `descendantsOf` and contract support are available. Physical storage ([[8a83b3c9]]) starts now as a separate Astra high owner tag-storage (thread 01a0f54e-5a74-745f-a9a0-cfbad7290948) on the existing resolver/format2 APIs, without changing identity/alias semantics and without mutating the live graph.

## Contract boundaries already fixed

- Compiler: `TypeResolver(reference: string): string | null` resolves a stored key or permanent id to the canonical declaration key, never through a mutable alias. `compileVocabulary(candidates, behaviours, resolver?, prior?)` owns composition and per-type reuse. Identity supplies the resolver; queries and installer consume the compiled table, `descendantsOf` and `redeclare`. Queries owns `supports(node, contract)`, `typesSupporting(contract)` and their index over compiled bindings; contracts owns descriptor expansion and semantic role migration.
- The compiler alone composes inheritance/gates. Behaviour contracts contribute owned bindings, requirements and gates; the registration owner validates compatibility without replacing compilation. Descriptor changes and actual consumers move together under their owning task.
- Profile schema belongs to its own catalog subject in graph's wire, consumed by the catalog manifest and brief builder. Adding its optional member to `Catalog` does not change compiler's `Declaration`/`Tag` semantics. Shared files are not locked whole; only intersecting declarations require agreement.
- `LawProjection`, vocabulary revision and `AdoptedLaw.on(projectId, identities, typeIds)` are the graph-to-enforcement seam. The caller supplies its immutable snapshot's identities. Graph owns the projection codec and descriptor-version pinning; enforcement owns adoption records and serialization. No graph module imports enforcement.
- The agreed missing guard is `AdoptedLaw.hold<A,E,R>(projectId, revision, act)`: at a revision mismatch, `act` does not start; otherwise the accepted-law revision is fixed until `act` ends. `AdoptedLawMoved` names expected and actual. Tag-step-0 changes the graph port; law-adoption implements it using the same permit as acceptance; law-publish uses it for final judgement plus publication. Graph activation takes this permit before its writer transaction. Enforcement declares the resource order, including GLOBAL/project and re-entry, before wiring it.

## Joins and who connects them

1. Compiler + identity: the two owners join canonical resolution and descendant validation; tests protect rename with carriers and inherited gates together. No duplicate identity tables.
2. Compiler + contracts: contracts owns descriptor expansion/requirements; compiler owns composition; both old answers and semantic law projection must stay equivalent. A changed alias or equivalent translation cannot invalidate accepted law.
3. Catalog/library + installer: catalog owner supplies declarations/profile and transfer origins; installer moves releases/membership and writes only a completely checked candidate. No copied shipped tag becomes an unrelated new identity.
4. Installer + enforcement: the lead agrees the port with law-opus; graph owns candidate validation/activation, law team owns adoption serialization and durable records. A digest check alone is never a race guarantee.
5. Queries + territory + storage: use compiled descendants, supported contracts and stable identity. They introduce no second list of law units; storage never rewrites an enforcement document.
6. Format activation: a separate graph integration task owns the format/schema switch, writing the marker for an existing format-1 tree as well as a new tree. Compiler, ids, catalog and contracts workers do not each raise the constant. Acceptance is through public operations on isolated fixture data; the standing shared graph is not an experiment.

## Completion and checking

Each independently delivered part names its contract, changed files and narrow checks. Integration tasks remain open until the public create/update/query/install roads exercise the whole feature. An open task is not proof its whole requirement stands unimplemented: acceptance reads the unproven criterion, not the task status — queries are done, rename/extends are already public green. A reader-only implementation or a new type with no consumer is not the completed decision.

New assignments and reviews follow [[6ccec00a]]. Each task has one implementer; Claude and GPT split assignments. Every implementer's graph records are written by its Muse helper; the rest of the ownership scheme, the source cap and the code law stand unchanged. Simple work needs no review. For reviewed work, Muse xhigh reads independent lenses, including performance; Sol high reads the general contract; Opus reviews only critically important work. Reviewers receive the server review brief and run no tests or typecheck. Findings are fixed at their owning producer. Independent edits proceed in the shared tree without negotiating commit order.

The lead coordinates API changes and integration blockers directly with law-opus. The operator's coordinating thread receives only questions that need the operator's decision, not intermediate milestones. The lifted agent count is not a reason to duplicate readers or start dependent writers prematurely; command and test worker limits remain unchanged.
