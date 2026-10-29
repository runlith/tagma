---
id: 01a12b27-485b-759a-98d0-d4919e1454a9
title: runlith-typecheck checks TypeScript packages with bun check instead of tsc -b and generated composite configs
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12b12-a3a2-7e2c-b91a-997500c6640b",
    "status": "done"
  }
---
The operator's decision: type checking runs `bun check` (Bun 1.4.3), one checker instead of `typescript-native` (tsc 7.1-dev). svelte-check for svelte packages stays as is; TypeScript 6 stays as the JS API (svelte-check, code facts, tsconfig reading, checks/law).

What to do: `runlith-typecheck` runs `bun check -p <package>` on each TS package closure's own `tsconfig.json`, one process at a time; `tsconfig.check.json` generation, solution configs, and `.tscheck` are removed with the errors that lived only for project references; `typescript-native` leaves the root `package.json`; `engines.bun` is `>=1.4.3`.

Measurement before the work (single, machine under load): the whole repo with tsc -b from scratch 54 s / 7.1 GiB; bun check per package 24 s, all 46 clean; on the server with two strict flags 3,775 errors matched tsc 7.0.2 and 7.1-dev by file, line, column, and code.

Proof: `runlith-typecheck .` and `apps/tagma` green; on a scratch workspace with an introduced error the command fails with a nonzero code and names the file.
