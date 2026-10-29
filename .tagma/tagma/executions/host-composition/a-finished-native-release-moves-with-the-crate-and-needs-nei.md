---
id: 01a14cfa-6062-7d7f-ae36-852bea503c9d
title: A finished native release moves with the crate and needs neither the old home nor the toolchain
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/src/composition/nativeBuild.ts
---
`build:native` and the bundle-build CLI share one native-release preparation: identical flags and receipt, otherwise one command overwrites the other's outputs and every worker restarts cargo. Freshness check and build go under one target flock: a concurrent request after waiting reads the already published receipt. The source copy uses the already built library and holder: the absolute location of the crate and home does not make them different runtime bytes, so the receipt is not tied to these paths. The receipt covers the crate tree without target, Cargo manifests and lockfiles, Cargo configuration and toolchain in parent directories, and the home-path remap rule in portable form. The CLI takes the OS user's home because the test HOME does not cover the installed Rust toolchain's paths. The linked target stays a build output, otherwise moving it or the build itself would keep staling the receipt. A build for a named architecture (`cargo --target <triple>`, requested by the release cut) puts the library, holder and receipt in `target/<triple>/release` and counts the triple in the receipt, so it never overwrites the checkout build in `target/release` or another target's build. Source selection does not follow symlinks; to that end the walk keeps the directory-entry type via Node readdir, which FileSystem.readDirectory does not yield. Content reads and receipt writes go through FileSystem.
