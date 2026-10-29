---
id: 01a15134-0b9f-7e2c-809e-ec171f26def0
title: Workspace reader typecheck accepts an invalid package.json shape and loses WorkspaceUnreadable
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15136-4984-7146-a28a-9d93e64082da",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15120-d727-72aa-b665-acc0f13fcc59
sources:
  - kind: file
    ref: packages/tsconfig/src/workspace.ts
---
In `packages/tsconfig/src/workspace.ts:184–192` `manifestAt` does `JSON.parse(text) as Manifest` and catches syntax only. Public `read` on a package.json `{"workspaces":[42]}` fails with `TypeError: pattern.endsWith is not a function` (:83–84); dependency spec `42` reaches `spec.startsWith` (:110–114), root JSON null reaches `manifest.workspaces` in findRoot (:68). A synthetic read-only probe confirmed the first error. `src/typecheck.ts:62–70` reads the workspace before the plan and promises `WorkspaceUnreadable` in CheckFailure but loses it and the manifest path. Fix: manifestAt decodes the Schema of the consumed package.json fields; JSON/shape errors become WorkspaceUnreadable with the manifest path. Public read/findRoot are checked against null, invalid workspace patterns and dependency specs, correct object workspaces, and workspace dependencies — workspace.test.ts, 2 pass. The package's `bun run typecheck` passed; the effect-test devDependency was written into the lockfile by the package manager, and the test runs with an in-memory FileSystem. This is a defect of the standalone typecheck CLI, not a block on the server request path.
