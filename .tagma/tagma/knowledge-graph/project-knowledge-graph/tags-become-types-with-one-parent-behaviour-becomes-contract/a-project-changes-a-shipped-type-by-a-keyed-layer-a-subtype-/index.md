---
id: 01a0f483-46c4-74e5-8e04-50d0516d96bd
title: A project changes a shipped type by a keyed layer, a subtype, an explicit fork or a request to the catalog; an upgrade is a checked candidate switched on atomically, and a blocked or hidden change is a finding
ord: 6
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
Part of [[6bf40362]]. It fixes how a project changes what is shipped, how a vocabulary is upgraded under those changes, and how an upgrade is rolled back.

## Four levels of change
The scheme of package systems (ESLint, VS Code, Kustomize, dpkg):
1. **A parameter or a section by key** — only in the slots and sections the type declared changeable: append, replace, hide a section. The local layer stores the section key and the revision of the base it was accepted over. Upgrades of the shipped type arrive.
2. **Its own descendant type** (`#bug extends #task`) — a new project type.
3. **An explicit fork** — when one wants to rewrite more than is allowed: a project type recorded as "fork of `<library>#<type>` at revision X". Upgrades of this type stop arriving; a new shipped revision arrives as information ("a new version is out, here is the difference"), not as a conflict.
4. **A request to the shipped catalog** — a narrow case that gets in the way of many — a reflection in Tagma's graph, so that the catalog adds a parameter.

A project never rewrites a contract's behaviour: different behaviour is a different type with a different contract (a note instead of a claim).

**A catalog's section on another library's type.** Apart from a project's levels, a shipped catalog may add one section of its own text, keyed by its id, to a type another library ships — `software-development` adds its code words to `core`'s `#rule` and `work`'s `#task` ([[16f1296b]]). It adds no field, role or edge, so a block moved to a project without that catalog stays valid; it never rewrites the base text; a project cannot edit it. The installer composes the type's own sections, then each installed catalog's section, then the project section, and settles a project's layer or fork over that composed text; the section stands while its catalog is installed and changes with that catalog's release.

The types Tagma ships (`#claim`, `#task`, `#rule`, `#decision` …) declare **one section, "project context", append only** as changeable; the shared contract cannot be hidden or replaced. A project's opinions on how to write are its `#rule`s, not the type's text. runlith's current `#claim` divergence (two sentences) is folded into the shipped catalog rather than becoming a layer.

## Findings
- **`layer-stale`**: the shipped catalog changed or removed a section the project had replaced or hidden. It means "a change is hidden by a local layer and the decision has not been updated", not "the local text is false". Resolved by keeping the replacement deliberately over the new base, changing it or removing it; the agent decides, and it goes to the operator only if the meaning of a project rule changes.
- **`upgrade-blocked`**: an automatic upgrade was refused (below).
- **migration conflict**: a copy that cannot become a layer or a descendant (below).
- **fork information**: a new revision of a forked type.

## Upgrade
- **A candidate is checked before it is switched on:** the declaration, descendants, carriers, the effect on law. The kind of change decides whether carriers are checked: text, alias and layout do not touch them — one write unit, as now. A change that touches carriers checks them; their number decides only the strategy: one unit, or preparation in batches outside the writer, a short lock on the affected types and an atomic switch-on. The threshold is derived from the measured cost of the check on the machine, never set as a number.
- **The effect on law** is read from enforcement: the candidate check asks enforcement's predicate module whether an adopted rule stands on each affected type, and on such a type preserves the adopted law's projection — which field is the enabled switch, which holds the enforcement document, the law contract's version — as each adoption record pins it ([[172759d0]]), compared by permanent ids ([[42fb81f7]]) so an alias re-keying or an equivalent role-to-contract translation is no change. A projection change never removes an accepted predecessor from judgement: its pinned projection keeps judging the affected rules, which read pending until re-adopted, and an unreadable pinned projection fails the inspection. A candidate that drops the law contract, or changes that law projection (the binding, schema or codec of the `enabled` or `enforcement` field included), or the rule's lifecycle guards, is refused — `upgrade-blocked` for an automatic upgrade, a refusal for an explicit change. Activation fences and rechecks enforcement's adoption revisions beside the carrier and schema revisions: an adoption landing between the check and the switch-on makes the candidate stale.
- **Every mutation pins the schema revision** it was written under; at the switch-on, under the lock, the delta of carriers changed since the background check is checked. A candidate prepared over a revision already replaced goes stale and is prepared again.
- **Two cases of refusal:**
  - **An automatic upgrade of an installed catalog** (start, project birth — `ensureVocabulary`, `graph/serving/birth.ts`): the project is not brought down, the previous version stays active, and `upgrade-blocked` with the reason is placed on the `#catalog`. For a fork, a new shipped revision is an informational finding.
  - **An explicit change of the set of catalogs** (`graph.catalogs`) and a first installation: the setting change **is refused** with the reason; the setting and the installation stay one unit ([[69f7d9c6]]). "Accepted but not active" does not exist; at a first installation there is no previous version, so it is only a refusal.
  - *Pending the operator's approval of [[70083b67]] §2.12, not accepted text:* "An explicit change is atomic in the checkout it is written through and orders the project's requested set; the project's other checkouts, and every project following a user-scope value, take it as an automatic update."
- **A wrong local part is not switched off automatically** (that could remove the project's protection): the candidate is switched on whole after the check, or the previous version stays; an independent part can be released as a separate candidate.
- **Rollback** is a checked reverse migration over the current state, not a substitution of the base; if it cannot be done without data loss — a refusal and a direct fix.
- A vocabulary upgrade does not change the strictness or the snapshot of law (`#rule` with enforcement) — only `enforce_rule` does.

## Migration of local copies
A local copy becomes a descendant of the shipped type **only if** its base is known (`release.tags`) and its differences fall into slots the new shipped type allows. Otherwise — an unknown base, a difference in a closed slot, an incompatible old declaration — the copy **keeps its former effective contract** with a migration-conflict finding until one outcome: fold the difference into the shipped catalog, declare an explicit fork, or convert under authorization. Bases and permissions are not invented; text is not reconstructed by guessing from a diff.

## What holds now
The installer upgrades in place, merges parts with a known base, keeps the local value on a conflict and names it in the catalog's release ([[cfa23151]]); upgrades of a conflicted tag stop arriving.

## Rejected
- **Keeping the local value on conflict (today):** upgrades stop silently.
- **Switching off a wrong local part automatically:** can remove the project's protection.
- **Rollback by substituting the base:** loses what the current state carries.
- **A carrier-count threshold written as a number:** it differs per machine (rule [[fe83acfa]]).

## Acceptance
- A shipped text change reaches a project that appended to "project context".
- A shipped change to a section a project replaced raises `layer-stale`; a blocked automatic upgrade leaves the previous version active with `upgrade-blocked`; an explicit refused change leaves the setting unchanged.
- A candidate prepared over a replaced revision is not switched on.
- A copy with an unknown base keeps its former effective contract with a migration-conflict finding.
- A vocabulary upgrade changes no rule's strictness.

## Fates
Claim [[cfa23151]] is replaced by claims written from this installer; claim [[69f7d9c6]] is rewritten per [[70083b67]] §2.4.9.

## Spec-list questions
Answers 1–9. 11 stored data: layers store the section key and the base revision; copies migrate as above. 12 who may do what: the agent resolves `layer-stale`, the operator only when a project rule's meaning changes; conversions of conflicted copies need authorization. 13 long-lived things: candidates, pinned revisions, the short lock on affected types. 14 bounded resources: the carrier-check strategy by measured cost. 16 failures: automatic vs explicit refusal, rollback by reverse migration. 17 observability: the four finding kinds. Order: step 5. out: 10, 15 — the declaration's format and the rollout are [[fcaf4455]]'s.
