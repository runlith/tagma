---
id: 01a1b34d-bcb3-76dd-9da9-49f6d89251c5
title: The SDK's host modules are the checkout's listed ones in a workspace and literal imports baked at SDK build in a published SDK
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/tagma/src/adapter/sdkHost.ts
---
`tagma-plugin build` and conformance both need the SDK's own copies of the host modules: the build to externalize them from a providers bundle and to import the bundle in describe mode, conformance to serve them to a built providers module. `@runlith/tagma` may not import the adapter packages that sit above it, so `sdkHost` cannot name them statically. In a checkout it lists them from the workspace manifests' `tagma.host` entries and imports each by its computed name; `kit/build.ts` replaces the file by path with the same list as literal imports, so a published SDK needs no workspace and its bundled copies are the ones served. The two flavours therefore must derive from the same `hostSpecifiers` answer: a host module added to a manifest reaches the checkout at once and the SDK at its next build.

Conformance passes `--no-install` to the loader itself because the build already proved that the bundle imports only host, Node and Bun modules; a providers bundle not made by `tagma-plugin build` is not covered by that proof.