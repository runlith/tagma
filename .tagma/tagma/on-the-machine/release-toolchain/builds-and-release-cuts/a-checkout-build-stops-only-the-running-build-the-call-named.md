---
id: 01a11268-d9d5-7045-81bd-0b581210860c
title: A checkout build stops only the running build the call named by `since`
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/builds/checkout.ts
  - kind: file
    ref: apps/tagma/server/src/installation/operations/builds.ts
---
Two builds cannot run at once: they write one installation. So `build_checkout` never refuses while a build runs but replaces it: `prepare` reads the running build and issues the `build-running` consent, and `CheckoutBuilds.build` receives its `since` and stops exactly that one before starting a new build.

The operator's consent covers the build they saw in the question. A build that started between the question and the answer is not named by them, and its call stops nothing — a `build-running` refusal here means a race. A build at the `restart` step has already landed and asked for a restart; it cannot be stopped, and that is `build-restarting` with no question. A build stopped by replacement never restarts the server, even when it managed to land — just as with `stop_build`.
