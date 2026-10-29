---
id: 01a0f483-46cc-7e9a-97aa-8b51fcaf4455
title: "The new declaration form rolls out in two releases: release N adds a vocabulary format marker and an old server's refusal to write over a newer one, release N+1 writes the new form"
ord: 7
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
Part of [[6bf40362]]. It fixes how the new declaration form is rolled out without an old server silently stripping law from the graph.

## Problem
The vocabulary silently drops a declaration it cannot read (`Tags.ts:476-489` as measured for draft v2): nodes lose its roles together with gates and law. There is no "the store is newer than me" check; the installer runs for every project at every start (`ensureVocabulary`), so a rolled-back binary reads the new graph at once.

## Outcome — two releases
- **Release N** introduces a vocabulary format marker and a refusal to write, and to install a catalog, when the marker is newer than the server understands. No new form is written yet.
- **Release N+1** writes the new form and raises the marker.
- The former declaration form is only a derived representation for reading during the transition, never a second mutable canon; it is removed once no unsupported reader remains.

## Where it is built
[[70083b67]] (section 2), D1: each graph store's `graph_stamp` holds `vocabulary_format` and `vocabulary_revision`; each tree holds `.tagma/<project>/format.json` (`{graph, vocabulary}`, committed with the tree, since another machine's newer server can bring declarations in through git); a server opening a store or reading a tree with a newer format serves reads and refuses every write and every catalog install, typed, naming both formats; every act records in `graph_act` the vocabulary revision it was written under, which is [[516d96bd]]' revision fence.

## Release N together with the law layer
Release N also carries the law layer's readers and refusals — enforcement's reader of document version 2, its refusal to write over a newer active version, the code of adoption records and the trusted predecessor, the publication re-check and enforcement's predicate module ([[172759d0]]) — as step A of the order agreed with [[9140c692]] ([[6bf40362]] §9).

## Rejected
- **One release that writes the new form at once:** a rollback binary would drop the new declarations and the law they carry.

## Acceptance
- A store or tree with a newer vocabulary format refuses writes and catalog installs on an older server, naming both formats; reads are served.
- Release N writes nothing in the new vocabulary declaration form. Neither does enforcement: release N reads the enforcement document version 2 and refuses to write over a newer one, and version 2 is first written at the trust-root act in release N+1 ([[172759d0]]; the order of [[6bf40362]] §9). Rollback is supported down to release N once either new form was written, never below it. A release-N server reads an active version 2 enforcement document but cannot write it, so it refuses every mutation of that rule's enforcement — it never downgrades the document to version 1.

## Spec-list questions
Answers 1–7, 10 (the marker `{graph, vocabulary}`), 15 (two releases) and 16 (a newer format: reads served, writes refused). Owners: the graph module, inside section 2's store open and freshness. Order: step 0. out: 11–14, 17 — the marker's storage is [[70083b67]]'s; the refusal is typed and names both formats.
