---
id: 01a0f476-0506-7364-9447-e291172759d0
title: "A rule's law keeps one home per datum and governs only once adopted: every change is judged by its trusted predecessor's accepted law, and a candidate edit stays pending until enforce_rule adopts it"
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
Part of [[9140c692]]. It fixes where each piece of a rule's law is stored, who writes it, how people review and merge it, and which law judges a change — so that an edit of the law never governs its own landing.

## 1. Outcome

- Every datum of the law has one home, the one native to whoever reads it; nothing is copied.
- A rule's document splits into **policy**, **adoption** and **ledger**. Only `enforce_rule` writes policy and adoption; the re-measure driver may only shrink the ledger and record escapes.
- Every change is judged by the law its **trusted predecessor** accepted. A candidate document that differs from its accepted law is `pending` and governs nothing, its own landing included.
- A deleted, disabled, moved or narrowed rule is caught, because the predecessor's rules are enumerated, not the candidate's.
- People review the law as a diff of `.tagma/` and `checks/` in the same change as the code, with a semantic summary.

## 2. Problem, with evidence

- The `.tagma` tree road absorbs a hand-edited enforcement document as it stands (M10, [[64798cd8]]'s tree-road limitation): a commit can loosen a gate with no operator's word.
- Until `e4c5458678`, a document was one JSON line — 127 KB for [[083d37f1]], 66 KB for [[ea465bed]] — unreviewable and unmergeable; hand copies under `checks/*.json` drifted from the rules (debt 57 against 3).
- The graph's field codec imports the builtin union, so no rule declared outside Tagma decodes (M5).

## 3. What holds now

- The document is a field of the #rule, written only by `enforce_rule` and the driver ([[64798cd8]]); a rule at watch or gate refuses `rule-enforced` to be disabled, superseded, trashed or moved.
- Graph rows follow the tree, and the tree absorbs what it carries ([[d234fbc1]]).
- Loosening is a permission subject asked under trust ([[bb03ddd5]]).

## 4. Target model

### 4.1 One home per datum

| Datum | Home | Written by |
|---|---|---|
| Norm: title and body | the #rule | anyone through graph operations; lifting an adopted rule only through `enforce_rule` |
| **Policy**: strictness, triggers, the check reference, builtin parameters (floors, entries, prohibitions, allowances), a program's parameters where they are its only configuration | `enforcement.policy` on the rule; in team storage the rule's `.tagma/…md` file, sorted multi-line JSON | `enforce_rule` |
| **Adoption**: the digest of the policy, computed over the decoded policy in canonical form, never over file bytes or field key names; the reach's identity — the region's id and the minimal set of source prefixes the reach resolves to within the rule's base (the region's sources and those of every live block under it, [[feab0c98]]), never the expanded file list; the checker's identity digest ([[b2965d21]]); the vocabulary revision it was adopted under and the **law projection** of the rule's type — the presence of the law contract, the binding, schema and codec of the enabled and enforcement fields, the rule's lifecycle guards; the measured revision | the enforcement store and the journal, and `enforcement.adoption` in the document from release N+1 | `enforce_rule` |
| **Ledger**: debt `{fingerprint, owner, count, value?}`, escapes, `measured` | `enforcement.ledger` | `enforce_rule`; the driver only lowers and records escapes |
| A linter's rule options and that rule's allowances | the linter's own config (`checks/law.oxlintrc.json`, `sgconfig.yml`) | anyone in a change; governs only once adopted |
| Runner descriptors | `runners.json` in the programs directory ([[d11108eb]]) | the same |
| Plugins and programs | the programs directory | the same |
| Tool versions | the lockfile | the package manager |
| Facts, parse memo, raw readings, prepared environments | `enforcement/`'s derived store | the server; losing it costs speed only |

- Builtin parameters are written by the server because every change to them must be measured at once: a floor added by hand leaves unowned violations that refuse the next unrelated landing.
- A linter's options stay in the linter's file because they are its input; a copy in the graph is the drift `checks/*.json` showed.
- An allowance lives in its check's home only: a builtin's in the policy, a linter rule's in the linter's config, a program's in its parameters on the rule when those are its only configuration. A rendered effective view joins them for delivery and review; it is never a second writable copy.
- The ledger is separate from the policy, so the driver's automatic retirement neither invalidates adoption nor authorizes growth.

### 4.2 The trusted predecessor

- Graph rows follow the tree; the graph reads bytes honestly and never substitutes them ([[d234fbc1]] holds). Whether a document governs is enforcement's decision.
- The **trusted predecessor** is the accepted law a change is judged by:
  - for `submit_work`: the accepted revisions the server keeps for that checkout and branch, surviving a restart;
  - for `merge_worktree`: the accepted revisions of the target branch;
  - for CI (`tagma check`): the base revision its caller names.
- The judgement fixes the predecessor's accepted rules **before** it reads the candidate, and enumerates them. A candidate whose policy, reach or checker differs from its adoption record is `pending`: it governs nothing, and every reading shows it as pending.
- A digest inside the document proves integrity, not approval; anyone can compute a hash. A revision is never chosen because it matches its own stamp, and a candidate's history cannot mint authority.
- Only `enforce_rule` makes a new accepted revision, against the predecessor, with compare-and-set on the accepted revision. A tightening its core logic proves writes without asking; anything else asks the operator.
- **What a rule is** is answered by enforcement's predicate module, never by a tag's name. A rule is a node whose type carries the law — today the `law` and `enforcement` roles, after [[877ba8f0]] the law contract. An open debt owner is a node carrying work or a promise in a non-terminal state and not replaced — today the `work` and `decision` roles, as `enforce_rule` already checks. The module also answers whether an adopted rule stands on a type and under which law projection; a vocabulary candidate's law check calls it and refuses a change of that projection on such a type ([[516d96bd]]). When the current vocabulary revision differs from the one an adoption pinned, the accepted predecessor keeps judging under its pinned projection, and the candidate — the rule as the current vocabulary reads it — stands pending until re-adopted; if the pinned projection can no longer be interpreted, the gate fails the inspection rather than skipping the rule. The projection is semantic — stable type and field ids and the normalized meaning of roles or contracts — so an alias rename, or the role-to-contract translation of [[877ba8f0]] that keeps the meaning, leaves every adoption valid. A subtype of `#rule` is enumerated like `#rule`, and the tag model's contract step swaps one implementation.
- Deleting a #rule or its whole region, moving it, `enabled: false`, narrowing its reach — through its region's sources or a descendant's —, changing triggers or its check binding: each is detected against the predecessor's enumeration and is a policy change. A container re-source or move that narrows an adopted rule's reach carries that rule's re-adoption in the same change.
- A new source file matching an existing selector, or a new block whose sources lie under an already covered prefix, is governed data, not an adoption.
- **Publication race:** immediately before a landing or merge publishes, the judgement re-checks the base tree and the accepted revisions it judged by. If either moved, it judges again, reusing only raw readings with exactly the same keys. A reading made under an old revision never retires debt or authorizes publication under a new one.
- **Trust root:** a project's first adoption, and a stealth graph with no history of adoption, need the operator to adopt the starting policy explicitly.
- **Threat model:** this stops ordinary authorized agent acts from granting themselves exceptions. It is no protection against a person with write access to the filesystem, and claims none.

### 4.3 Review and merge

- The law is reviewed as the diff of `.tagma/` and `checks/` beside the code. `enforce_rule`'s answer and `read_inspections` give the semantic summary: restrictions added and removed, reach changed, checker changed, debt absorbed and retired. Sorted keys fix the line diff; they authorize nothing.
- Two branches changing one document merge as text into a candidate; `merge_worktree` judges by the target's accepted law, and the merged policy governs only after `enforce_rule` adopts it against the merged tree, with owners revalidated.

### 4.4 Who may do what

- The operator decides intent, strictness, every loosening — parameters not proven tighter, allowances, lower strictness, dropped triggers, re-adopting an unproven checker change, the conversion of [[083d37f1]] — and the trust root.
- The `rules` agent measures, proposes, writes #rules and `checks/` files, and runs `enforce_rule` on the operator's word ([[f697d121]]).
- `enforce_rule` is the only writer of policy, adoption and debt growth. Permission is checked in `enforce_rule` (prepare, execute, compare-and-set) and in the judgement (pending governs nothing).
- If the tightening proof is wrong, a loosening passes silently; so proofs live only in core logic, each with a test against a full reading.

## 5. Owners and boundaries

- `enforcement/` owns the policy codec (free of the builtin union), adoption, the predecessor, pending states, the ledger's writes and the predicate module. The version 2 codec is where `#rule`'s `law` and `enforcement` roles become the enforced-law contract registered in enforcement's manifest ([[877ba8f0]]); the graph core stops knowing enforcement's schema.
- The tag model's storage stage ([[b4f28f40]]) never rewrites an enforcement document; a document changes form only at its rule's next `enforce_rule`.
- `graph/tree` reads and projects bytes and hands document changes to `enforcement/` through a port it declares; it never decides whether law governs.
- The journal keeps every accepted revision.

## 6. Rejected alternatives

- **Rule parameters in a repository file beside `.tagma`**: two homes for one rule and unmeasured edits; `checks/*.json`'s drift is the evidence.
- **Keeping the old rows while the tree carries a new document**: a fresh clone or CI would enforce what the server does not, and rows would stop reflecting the tree.
- **Choosing the accepted revision by a self-matching stamp**: anyone can recompute it.
- **Debt as hundreds of child blocks**: the ledger is one field owned by the rule, paged when large.

## 7. Acceptance criteria

- An edit of a policy in `.tagma`, a deleted #rule, a moved rule and a narrowed parent source do not govern the landing that carries them; each reads as pending, and the gate judges by the predecessor.
- A candidate carrying a recomputed stamp for a weaker policy is still pending.
- A subtype of `#rule` carrying enforcement is enumerated and judged; a vocabulary candidate that removes the law from a type carrying an adopted rule is refused.
- Renaming the graph's field keys, or rewriting a document's bytes with the same decoded policy, leaves the rule accepted.
- A vocabulary candidate that moves the enabled or enforcement binding of a type carrying an adopted rule is refused; an adoption landing between a candidate's check and its activation makes the candidate stale.
- Release N writes no version 2 document; the trust-root act in release N+1 is the first.
- Two concurrent `enforce_rule` acts on one rule: the second refuses on compare-and-set.
- A landing whose base moved between judgement and publication is judged again.
- A fresh clone judged by `tagma check` with its base revision named reaches the same verdict as the server.

## 8. What becomes of the claims and tasks it touches

- Decision [[64798cd8]]: its document becomes version 2, and its tree-road limitation is replaced by claims written from this mechanism.
- Claim [[d234fbc1]]: stands; the claims of area [[bb6220c4]] on enforcement writes are rewritten from the code.
- Claims [[9ef4f5c3]] and [[b920ebdc]]: re-read; an unadopted or pending law is named beside an unreadable graph.

## 9. Order of building

Release N, beside the tag model's format marker, ships readers and refusals only: the version 2 codec as a reader, the refusal to write over a newer version, the predicate module, the code of adoption records and of the predecessor with pending states, and the publication re-check. Release N+1 writes: the migration trust-root act is the first version 2 write, and protected judgement starts after it — the one order with the tag model stated in [[9140c692]].

## Spec-list questions

This decision answers 1–9 and 12.
- 10 Contract: the enforcement document `version: 2` (`policy`, `adoption`, `ledger`; a check `builtin | runner | command`, the inline `command` form within contract 1's support window until its rules are re-adopted on runner descriptors — amended by [[a0bc244f]]). Version 1 is read within a support window: before an implementation retires, every active rule needing it is migrated; an unknown or unsupported active version refuses `inspection-failed`; an older server refuses a newer active version instead of ignoring it. Release N reads version 2 and writes version 1; version 2 is first written in release N+1, at the trust root. Release N refuses to mutate an active version 2 document — it reads it and never rewrites it as version 1 — so a rollback to N never downgrades a document.
- 11 Stored data: a version 1 document is read as it stands and rewritten as version 2 by its rule's next `enforce_rule`; debt entries take `count: 1`. **Migration trust root:** before a checkout's judgement switches to version 2, the operator's authorized migration adopts its existing version 1 policies as the accepted predecessor; until then that checkout judges as today and is not described as protected by adoption. Rollback names the pair of binary and policy-and-checker revision; a version 1 document in the journal alone is no rollback once the binary changed. Once a version 2 document was written, rollback is supported down to release N, never below it: a binary older than N has no refusal of a newer version and would misread or drop the document.
- 13 Long-lived things: accepted revisions per checkout and branch, kept across restarts in the enforcement store; they die with the checkout's registration.
- 14 Bounded resources: a ledger above one page is read in pages ([[68659e3b]]).
- 15 Rollout: rules keep judging under version 1 until each is re-adopted; no strictness changes by migration.
- 16 Failures: a lost accepted revision (store lost) leaves the checkout unadopted: the gate refuses `inspection-failed` in a project known to gate until the operator re-adopts, never an inferred trust; concurrent adoptions are ordered by compare-and-set.
- 17 Observability: every reading shows accepted, pending or unadopted per rule; the journal names each adoption with its digests.
