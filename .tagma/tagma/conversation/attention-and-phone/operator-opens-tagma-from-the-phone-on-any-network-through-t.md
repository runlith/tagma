---
id: 01a14bc0-76d6-793a-939b-838f9b8c75ed
title: Operator opens Tagma from the phone on any network through Tailscale Serve, and the door lets in only his devices
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/devices/Blocked.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/devices/Devices.svelte
  - kind: file
    ref: apps/tagma/server/src/remote/keys.ts
  - kind: file
    ref: apps/tagma/server/src/remote/reach.ts
  - kind: file
    ref: apps/tagma/server/src/remote/tailscale/blocks.ts
  - kind: file
    ref: apps/tagma/server/src/remote/tailscale/serve.ts
---
**Value.** The operator directs agents from the phone on any network while the machine with Tagma stays closed to everyone but his devices — with no own domain, VPN setup, or port forwarding.

**How.** Settings → Phone & devices, the `remote.enabled` setting (operator only, off by default); state — `read_remote_access`.

**Behaviour.**
- Enabling exposes the server door to the tailnet through Tailscale Serve over HTTPS and shows its address and pairing code.
- The door lets in only paired devices and only requests from its own page.
- The address pins on first setup and survives server restart, because the installed app, device logins, and push depend on it.
- The section advises against letting the machine sleep while an agent waits on the operator.

**Limits.** When Tailscale is not ready — not installed, not logged in, certificates off, no rights, address taken, Funnel on — the section names the problem and the command that clears it. Turning off closes the door, but devices stay paired.
