---
id: 01a0f508-d3ab-737c-a15b-70597d3895e1
title: Prepare compiled catalog candidates and keyed layer/fork semantics without activating incomplete vocabulary
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f50a-02c5-7797-8551-1142069a0f6e",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f483-46c4-74e5-8e04-50d0516d96bd
---
Independently implement candidate planning and keyed local-layer/fork semantics of [[516d96bd]], under [[a869340b]], following [[0f83e781]]. Class: complex, Opus high. Owns catalog candidate identity, named text sections, allowed append/replace/hide edits, fork provenance and classification of text-only versus structural changes. It consumes the one declaration compiler and identity resolver; it does not create another of either.

Compiler API: `compileVocabulary(candidates,resolver?)`, `Compiled{declaration,tag,lineage,provenance}`, `TagTable.redeclare(declaration,replacing)` and `descendantsOf`. Identity owner supplies canonical-key lookup, permanent ids, immutable carrier keys and checked provenance. Catalog owner supplies system-library declarations and profile, including the original origins of moved types. Agree the minimal named-section declaration with the compiler through the lead before changing its shape. Preserve unknown-base copies as explicit migration conflicts, never infer a trusted base from a matching name.

Compiler is currently changing only the existing install loop's validation from per-tag to full compilation. The installer then owns candidate preparation/activation in `graph/vocabulary/install.ts`; no agent else edits the install lifecycle. Build the real prepare/validate/result mechanism and layer/fork evaluation now; wire activation through `AdoptedLaw.hold(projectId, revision, act)` only once enforcement's filler is available. The project adoption permit is acquired before the graph writer, and switch-on rechecks vocabulary and affected carrier revisions under the guard. A read of a digest alone does not fence anything. No new activation on the shared graph and no format bump belong to this task.

Acceptance: actual candidate evaluation yields a complete compiled result or typed failure; keyed overrides retain provenance, unknown bases retain old effective semantics with a finding, and text-only changes avoid carrier reads. The parent task remains open until public installation, automatic-upgrade findings with a driven lifecycle, and concurrent activation/adoption tests pass. The pending [[70083b67]] §2.12 sentence is not implemented.
