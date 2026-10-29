---
id: 01a16b72-6d5b-7861-ab73-d4aa37f542a9
title: Under vitest guards see the module runner code and any builtin require, and under Bun an ESM builtin import from an outside dependency passes by
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/testbed/src/vitest/setup.ts
---
Under vitest guards see the module runner's code and any require of a builtin, and under Bun an ESM import of a builtin from an outside dependency passes by. Guards patch the builtins' CommonJS objects (`fs`, `child_process`, `net`, `http`, …) and substitute them through `vi.doMock`, so the refusal gets code loaded by the vitest module runner — the test file and workspace sources — and every `require` of a builtin. Under Node `syncBuiltinESMExports` carries the patch into ESM exports too, so outside dependencies also get the refusal. Under Bun a builtin's ESM exports never sync with its CommonJS object (checked on `writeFileSync` from `node:fs`), so an outside dependency vitest does not inline and importing the builtin as ESM passes guards by (inferred from such dependencies loaded by the runtime, not the module runner).
