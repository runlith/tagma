---
id: 01a16ac4-44bf-7e0a-8178-b705a099f1ad
title: The app unit layer stops rebuilding jsdom and the module graph for every file
ord: 6
tags: ["spec"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: apps/tagma/app/vitest.config.ts
---
**Measurement.** `bun run --bun vitest run --project unit` in `apps/tagma/app`: 1445 tests in 229 files, 215 s wall at `maxWorkers: 2`. Summed over workers: test bodies 52 s, import 216 s, environment 129 s, transform 127 s. The config does not set `isolate`; under vitest 4.1.11 isolation, before each file it resets the mocker and evaluated modules (`vitest/dist/chunks/base.*.js`, loop over files), and jsdom with the module graph are rebuilt for each of the 229 files. For comparison: the server's bun unit layer runs 1494 tests in 18.6 s.

**Direction.**
- Environment and evaluated modules live on the worker, not the file: `isolate: false`. Under it the mocker and modules are not reset, so files with `vi.mock`, `vi.doMock`, `vi.resetModules`, `vi.stubGlobal` (28 across the app and vitest packages) switch to doubles through `Layer.of` or go into a separate vitest project with isolation; the same project takes a test that needs a clean page.
- State leaking between files — a DOM left mounted, a module-level store, subscriptions — is fixed at its owner, as in [[ff15f336]].
- Transform: `isolate: false` does not touch it — Vite caches transform per module within a run (output), so the 127 s is probably the first compilation of each module. `experimental.fsModuleCache` removes it between runs (after a source change that module's cache is cold); dependency pre-bundling is `deps.optimizer`. Each measured separately.
- Guards and the report come from the kit's vitest binding ([[3e26831e]]); same direction for the 11 vitest packages.
- App setup lives in `vitest.config.ts`: it needs Svelte compilerOptions from `svelte.config.js`, the `$lib` alias and the test projects, but not launching SvelteKit, Tailwind and release plugins. Clean host facts and shared fixtures do not import window composition; app scenarios take only their owners.

**Limit.** Test bodies cost 52 s summed, i.e. at least ~26 s wall on two workers. With setup removed, the layer approaches that number — about ×8. ×20 here also needs cheaper bodies; which ones are expensive will be shown by the test lines in the kit's report. That is separate work after this.

**Acceptance.**
- The same run before and after, separately with a cold and a warm transform cache; on warm, import, environment and transform together cost no more than the bodies.
- The layer green with `sequence.shuffle` on three seeds and in an isolated run.
- Tests in the isolated project named in the config, their share recorded in the measurement.

**Remaining acceptance.** In the [[5bb2a136|delivery measurement]] warm import + environment + transform are 71.26 s against 23.68 s of bodies. Vitest double-counts the shared worker's environment, but even without it import + transform = 32.51 s: setup cost still not down to body cost. Shared workers, a persistent transform cache, an explicit isolated project and green shuffled/isolated runs delivered; `deps.optimizer` not enabled after a negative measurement. Eleven packages' configurations delivered; the [[8bdd211f|packages note]] names the checks already done and the commands of the remaining quiet window. After sibling measurements stop, the launching agent takes the final after, the full shuffle/isolated runs of the other ten packages, and the decision which configurations brought no measurable benefit; that acceptance is still open.
