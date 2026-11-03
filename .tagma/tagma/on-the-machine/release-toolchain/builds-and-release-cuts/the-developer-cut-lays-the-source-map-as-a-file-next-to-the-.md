---
id: 01a15bac-1b0d-7169-95ec-e5888c935cbb
title: "\"The developer cut lays the source map as a file next to the bundle: inside, it would join the source the JSC sampler hashes whole\""
ord: 10
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/cut/release.ts
---
The developer cut builds the CLI, the server and their workers with the map separate (`external`) and lays it next to the bundle as `<bundle file>.map`, naming it part of closure. The release keeps maps outside the installation (they are read by `tagma:stack`), and the release's proof refuses a map inside it.

The reason is cost growing with file size. JSC counts the whole file as the source of the bundle program and of every class's synthetic field initializer. The always-on sampler (`CpuProfiler`, when the `telemetry.cpuSampler` setting is on) computes SHA1 over the UTF-8 of its source for every CodeBlock first caught in a sample — within the GC marking limit while the loop is stopped, or in `Profiler.stop` on the loop itself. An inline map made up most of the bundle file, and the SHA1 work in every such stop was larger by as much; besides, those bytes were held in the process memory as source.

Bun itself looks for the map of an already built file under its name with the `.map` suffix next to it; it needs no link in the bundle. So the map is named by the name under which the cut lays the bundle, not by the name Bun would derive from the entry; stacks and profile frames then point at sources — by the build checkout's absolute paths.

The remainder — the hash of the bundle code itself — stands only while the sampler is on (`telemetry.cpuSampler`, off by default); splitting the bundle into chunks reduced it but was rolled back: without the sampler it never speeds up startup ([[e645796e]]).
