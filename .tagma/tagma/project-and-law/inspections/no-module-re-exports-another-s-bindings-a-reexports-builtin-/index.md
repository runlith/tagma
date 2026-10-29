---
id: 01a0db81-b8b3-7522-97cf-1b67dabecf26
title: "No module re-exports another's bindings: a `reexports` builtin refuses them at gate, and every barrel in runlith is removed"
ord: 8
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
**Outcome.** No module in runlith forwards another module's bindings: every import names the file that defines what it takes. A new re-export is refused at `submit_work` and `merge_worktree` by a builtin inspection, `reexports`, carried by a project-wide #rule at gate.

**Problem.** Measured at `d7e6a1cf66` with oxc over tracked `.ts/.tsx/.js/.mjs/.jsx`: 238 files hold 1,313 re-export statements — 143 pure barrels, 94 files mixing re-exports with their own code; 17 of them under the dead `archive/` tree. Package roots (`@runlith/llm`, `@runlith/agent`, `@runlith/utils`, …) are barrels, so importing one binding loads the whole package, `loads` [[0d2c66a9]] has to name barrels and doors one by one, and a reader landing on `index.ts` learns nothing about where a binding lives.

**What holds now.** `@runlith/code-facts`' JS adapter reads re-exports only as import sites (`clause: true`), never as forwarding. `@tagma/inspection` carries `direction` and `loads`. Every workspace package is `private`; none is published.

**Target.**
1. `reexports` builtin in `@tagma/inspection`, `js` only, local reach. A violation is a statement that forwards a binding out of its module: `export * from`, `export * as ns from`, `export { … } from` (type-only included), and `export { a }` / `export default a` / `export =` of a binding the module imported. Fingerprint `<file relative to base> -> <specifier>`; unit: forwarded specifier per file. Parameters: `base`, `files` (extensions, exclude) and `allows` — globs of files that may forward (a published library's entry). The fact comes from the JS adapter as neutral data (a site forwarding bindings), so another language's adapter can supply it; the builtin stays free of any project opinion.
2. Every re-export in the workspace (`packages/*`, `apps/*`, `apps/tagma/*`, `scripts/`, `checks/`) is removed: consumers import from the defining file, pure barrels are deleted, mixed files keep only their own code. A package's `exports` map names subpaths that map onto source files (explicit entries or `./*` patterns); a package root that was a barrel disappears unless a real module stands there.
3. Rule "No module re-exports another's bindings" at the project root, enforced `reexports` at gate before `submit_work` and `merge_worktree`, excluding `archive/**`, generated files and `*.d.ts`; `allows` names `**/ui/*/index.ts` and `packages/primitives/src/dialog/index.ts`.

**Divergence (operator's word, after the removal began):** shadcn-svelte component directories keep their namespace `index.ts`. The shadcn CLI generates it and regenerates it on `add`/`update`, and markup uses it as `<X.Root>`; removing it costs every consumer ten default imports and flat component names.

**Owners.** The fact: `packages/code-facts/src/languages/js`. The builtin: [[bbddbda9]]. The rule: project root. The removal: every package, each consumer changed at its own import.

**Rejected.** Allowing package-root barrels: no package is published, and a root barrel is exactly what makes `loads` list doors. A lint plugin: the gate must be the engine's law, measured like every other rule.

**Acceptance.**
- `reexports` over `base: ''` reads 0 violations at HEAD outside `archive/`.
- Typecheck of every workspace package and `bun run test` pass at the level they passed before (compare against the base commit; a failure also present there is reported, not fixed here).
- [[0d2c66a9]] is re-enforced with its refused and allowed specifiers spelled for the new exports maps, and still measures 0 debt; [[f49f228f]] is unchanged and still 0.
- The rule stands at gate; a fresh `export * from './x'` refuses `rule-violated` at `submit_work`.

**Claims and tasks touched.** Claims naming a package's root door or an `index.ts` are revised by the builder that removes it. `loads` claims stay; [[f1c5081a]] and [[78be9471]] grow the third builtin.

**Order.** The builtin and the removal run in parallel on disjoint files: the builtin's builder also removes the barrels of `@tagma/inspection` and `@runlith/code-facts` and rewrites their consumers; the removal's builder does everything else and leaves those two packages and imports into them alone. The rule is enforced once the builtin lands; whatever the removal has not finished becomes debt owned by its task.

**Contract.** A package's import surface changes shape; nothing is published, so no compatibility is kept. **Stored data, permissions, rollout:** out: no stored data, no new act; the rule is a graph write. **Resources:** the builtin reads one file at a time, cost linear in the files a change touches. **Observability:** `check_rules` over the rule, and its `measured` figure.
