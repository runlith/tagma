---
id: 01a0f855-d07e-7cff-816b-14c22c8b1b07
title: Wire the browser-built-in guard into the apps' own Vite builds and retire the separate browserBuild program
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f855-0493-7579-8869-aecbb27b6fe2",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f476-0526-7928-a1ce-c58bcdf2a89f
---
Operator's order: the guard that stops an app's client bundle from reaching a Node built-in (third-party files included) is a Vite plugin in the apps' own build config, failing the build, instead of a separate checks/browserBuild.ts program under rule 99b5c911.

Scope: new package packages/vite-browser-guard (@runlith/vite-browser-guard) with the plugin and its unit test; plugin wired into apps/tagma/app vite configs and package.json; checks/browserBuild.ts, browserGuard.ts, their .d.ts/.d.ts.map and browserBuild.test.ts deleted; claim 81ec3142 rewritten from the new code.

Acceptance: the Tagma app builds green; a substituted `fs` import from browser code fails it with module, importer and chain; the package's unit test covers failure with chain and a bare-name polyfill passing. Rule 99b5c911's enforcement is the lead's to change.