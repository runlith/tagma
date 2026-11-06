---
id: 01a14c08-1c3f-7bde-a2e3-0468add6b3fa
title: Agent reproduces a page's screen, CPU, network and location
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/Measuring.svelte
  - kind: file
    ref: apps/tagma/server/src/browser/contract/wire/emulation.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/emulate.ts
  - kind: file
    ref: apps/tagma/server/src/managed-browser/host.ts
---
**Value.** The agent reproduces a device's layout and load conditions on the same page the human sees, without changing the human's window or browser profile.

**How.** `emulate_page` sets a built-in device, a viewport, a color scheme, a CPU factor, network conditions or a location. The browser panel and the phone page view name active load conditions and offer one reset that leaves layout emulation intact.

**Behaviour.** Emulation requires fast input; a human profile refuses it, and a mode switch clears the previous session's conditions and layout. In fast mode, viewport, device and color scheme survive an engine reconnect; the viewer's layout lies beneath them. Metric changes and refusal rollbacks settle on renderer dimensions or a post-write resize before queued engine work reads geometry. CPU, network and location end with the setting thread's run, an explicit reset or the engine session. Page answers name those active conditions. CPU slowdown includes out-of-process frames; frame and host hang detection account for the slowdown and for an engine-held pause. Network presets and custom throughput use request rules; offline also changes the page's online state. A location override temporarily grants geolocation and restores the previous permission when it ends.

**Limits.** Chromium's CPU throttler affects other pages sharing the renderer. Desktop CPU strain follows exact OS renderer processes, widening to the profile only during navigation toward an unknown speculative renderer and returning on commit or failure; heap pause stays on its captured PID. Managed watchdogs and engine frame probes whose renderer identity is unknown use the profile. While a managed profile is slowed or paused, detection of a genuinely hung other page of that profile is delayed until strain ends; unknown-identity frame probes pay the same cost. On managed Chromium a geolocation grant reaches same-origin pages of the profile. A metric write whose normalized size does not match and produces no qualifying renderer resize can wait until the page or engine session ends. A post-clear resize can establish restored native layout even when the native-size change was hidden by an override. Access matches [[4096201b|agent-driven pages]].
