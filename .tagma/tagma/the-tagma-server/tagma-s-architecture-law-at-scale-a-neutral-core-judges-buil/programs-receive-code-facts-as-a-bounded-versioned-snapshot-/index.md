---
id: 01a0f476-0510-7432-a96e-1bbc3f3fe425
title: Programs receive code facts as a bounded, versioned snapshot in their input, and Python arrives beside JavaScript as an adapter with declared capabilities
ord: 6
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
Part of [[9140c692]]. It fixes what code facts a project's program gets from Tagma, what the language-neutral interface holds, and the order in which languages beyond JavaScript arrive.

## 1. Outcome

- A program that declares it needs facts receives them in its contract 2 input as a bounded snapshot — resolved imports, declarations, the unit of each path under a named `boundaries` rule — so it parses nothing Tagma already parsed.
- Every fact answer carries the adapter's and schema's version, the tree's identity and its completeness; a capability an adapter lacks is stated, never an empty list.
- The language-neutral interface holds files, dependency sites, resolved and unresolved targets, manifests, declarations and file metrics; each language's resolution settings are opaque data of its adapter.
- Python arrives after JavaScript, only with a declared and tested resolution envelope.
- out: Go and Rust adapters — dropped by the operator's word on 2026-10-01; this decision builds neither.

## 2. Problem, with evidence

- A program receives `paths`, `files` and `baseFiles` only, so a project check needing imports or owners re-parses the tree itself.
- `Adapter.workspace(tree, from, conditions)` carries npm export conditions in the neutral interface; `Declarations` carries `tag`, `shape`, `union`, `queries`, `Made`, and `usage` carries `CallUse` and `TopUse` — shapes that exist for the Effect and Tagma builtins; `LANGUAGES` and `ADAPTERS` are closed to `{ js }` (`packages/code-facts/src/adapter.ts`, `languages/`).

## 3. What holds now

`@runlith/code-facts` reads imports, resolves over a tree port and answers floor crossings, through one adapter per language; its core imports no parser ([[6c02fbe0]]). Only `js` ships.

## 4. Target model

- **To programs:** a program's descriptor declares `needs: { facts: [imports, declarations, "units:<rule>"] }`; the input's `facts` holds them for the paths of each side and what they import. The snapshot has a byte ceiling the enforcement store derives from the machine's memory; a request above it fails the inspection naming the size it needed and the missing capability, never a partial reading. A query channel inside the run (long-term) serves what a snapshot cannot; a program never re-enters the server's gate.
- **Graph owners** are navigation, not identity: a unit comes from the adopted `boundaries` policy, and a program asking for owners gets the graph's reading labelled as such.
- **The neutral interface:** `parses(path)`; `imports(text, path)` → sites with kind (value, type, dynamic, side effect); `resolve(specifier, from, tree)` → a path, an external target or unresolved; `manifests(tree)` → `{ dir, name, dependencies, entries }`; `metrics(text, path)` → lines, import lines; optionally `declarations(text, path)` → name, kind, line, exported. A language's resolution context — JavaScript export conditions, Python source roots — is opaque adapter data identified by its digest.
- **What leaves the interface:** the Effect- and Tagma-shaped declaration and usage forms go with the builtins that used them ([[cdf2a89f]]); `workspace` becomes `manifests` plus the adapter's own context.
- **Order:**
  1. JavaScript: honest resolution and the reverse-import index ([[bedb212a]] §4.5).
  2. At once, non-JavaScript projects are served by runner adapters — ruff, ast-grep, semgrep ([[d11108eb]]).
  3. Python: source roots and relative dots, for one declared application layout.

  Parsing is not resolving: a language ships only with its resolution envelope declared, tested, and honest about `unjudged`.

## 5. Owners and boundaries

`@runlith/code-facts` owns the interface and the adapters and stays free of rules; `enforcement/` builds the snapshot from its parse memo; the runner contract owns the snapshot's schema.

## 6. Rejected alternatives

- **A callback CLI into the running server during a judgement**: re-entry into the gate that is waiting on the program.
- **A universal AST**: each language's facts are read by its adapter; no shared tree shape is needed for law.
- **Tree-sitter grammars alone as a language's support**: they parse and do not resolve.

## 7. Acceptance criteria

- A fixture program declaring `imports` receives resolved edges for both sides and parses nothing itself; the answer names the adapter version and the tree.
- A snapshot above its ceiling fails the inspection with the size it needed.
- The Python adapter judges `boundaries` over a fixture service with `src/<pkg>/{domain,app,adapters,api}` and names dynamic imports as unjudged.
- The neutral interface names no npm, Effect or Tagma notion.

## 8. What becomes of the claims and tasks it touches

The claims of area [[da721ea5]] and [[6151fe9a]] are rewritten from the code when the interface changes; [[6c02fbe0]] and [[561d8ebe]] are re-read.

## 9. Order of building

The snapshot for `imports` in contract 2 first (it serves the runlith program of [[cdf2a89f]]); the interface cut next; Python in the next phase; `units:<rule>` once the judging callers hand the program road the accepted law.

## Spec-list questions

This decision answers 1–9.
- 10 Contract: `facts` is an optional field of contract 2; each fact carries its schema version.
- 14 Bounded resources: the snapshot's ceiling and its failure as above.
- 16 Failures: an adapter that cannot read a file answers it `unjudged` on the base side and fails the built side, as today ([[1f9f1418]]).
- 17 Observability: fact requests, sizes and memo hits in the judgement span.
- out: 11, 12, 13, 15 — facts are derived and disposable, carry no permission, hold nothing long-lived beyond the parse memo that exists today, and roll out with the program that asks for them.
