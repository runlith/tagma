---
id: 01a0f8f0-e70a-7e3c-b6b6-9fc916819c00
title: Accepted law, checker pinning, the equivalence proof, suppression blanking and enforcement confirmations are removed on the operator's word of 2026-10-01; a rule governs as the graph holds it
ord: 12
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
The operator's order of 2026-10-01: Tagma does not defend itself against its own agents ([[06e41b6f]]), and enforcement keeps one current form ([[acb620dd]]).

## Product

A rule edited in the graph governs the very next landing, merge, commit or check at the place it is read. Nobody adopts, accepts, confirms or pins anything: `enforce_rule` writes on the caller's word, and a runner checker runs from the checkout as it stands.

## Removed

- Accepted law: `adopt_law`, the trusted predecessor, the accepted-law store and its `law_accepted` table, adoption stamps, branch lines, the `enforcement/accepted-law` permit, publication under the accepted law, the `AdoptedLaw` port with `hold`/`on`, the `law-adopted`/`law-unread` refusals and the `rule-checker://` subject.
- Checker pinning: locators and digests, prepared environments under `enforcement/checkers`, the checker package mirror and its postinstall, "checker changed" pending and `checker not prepared`.
- The files-equivalence proof and `layout.equivalent`.
- Suppression blanking in oxlint, ESLint, ast-grep, Ruff and Semgrep: a checker honours its own suppression comments.
- Confirmation of a loosening, an absorb and a program (`rule-program://`).
- Numbered enforcement documents (version 1/2/newer), inline `command` programs with their contract 1 and SARIF outputs, program work directories and warm trees, and the merge request's `seen` column.

## Kept

The gate, strictness and triggers, owned and counted debt, escapes, the re-measure driver for builtins, runner programs through `runners.json` descriptors, and the builtins that judge today (direction, modules, names, the effect pack, reexports, swallowed failures, call services).

## Architecture

Every judgement reads the rules from `Orientation.rules` of the graph it runs over, cached per rule revision. A runner checker is resolved by `checkerOf` from the checkout's `runners.json` and launched there. The enforcement document has one shape; old graph files are lifted on read and rewritten once when the graph opens, and the machine store drops the adoption table and leftover directories at start.

## Fate of the decisions it touches

- [[172759d0]] and its child [[db25dbd7]] are closed against this decision.
- [[b2965d21]] and [[c09fe8dc]] stay closed as history; the claims that answered them are deleted with the code.
- [[9140c692]], [[8fe9d0a8]] and [[d11108eb]] §4.5 lose their accepted-law, checker-pinning and equivalence parts; the rest of each stands.

## Done

Server typecheck clean; the enforcement integration tests of the remaining contracts pass; a rule edit in the graph refuses the next landing (publication.itest).
