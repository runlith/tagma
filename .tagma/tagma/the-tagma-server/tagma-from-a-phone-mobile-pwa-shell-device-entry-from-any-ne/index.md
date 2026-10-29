---
id: 01a10b84-921f-7c42-a1d6-fc86c508fd35
title: "Tagma from a phone: mobile PWA shell, device entry from any network over Tailscale, and push when an agent waits for the operator"
ord: 103
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/server.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/actor.ts
---
The operator walks away from the Mac and runs agents from a phone — from home or from another country. The phone shows what waits for their answer, what failed and what finished; opens a stream, answers an agent's question, writes the next message, stops a run; sends push when an agent waits for the operator, fails, or finishes. The work stays on the Mac: the phone is one more client of the same server, paired once.

## Decisions

- **A PWA out of the same SvelteKit app.** The interface is already web: the server serves it, and it reaches the server through `window.location.origin` (`app/src/lib/wire/Door.ts`, `app/src/lib/wire/Live.ts`). A native app would be a second codebase for what the browser already gives: at Orca (`.external/orca`, commit c8937936) the mobile app is about 127 thousand lines with no tests.
- **Its own mobile shell, a shared data layer.** The desktop is a multi-column workplace; squeezed to phone width, it serves phone scenarios worse. Wire, the live channel, state classes and the stream feed are shared.
- **The device picks the shell, not the width:** once at load, resize switches nothing, the device offers a manual choice. A narrow desktop window stays desktop.
- **URLs are shared:** a link from push opens the same place on any device.
- **The transport is Tailscale Serve.** Zero own infrastructure, WireGuard connectivity and valid HTTPS, without which the browser grants neither service worker nor Web Push. An own relay comes when Tagma goes to people without Tailscale, and then it is a relay with TLS passthrough: the server machine holds the certificate, the relay only sees TLS. A relay with application-level encryption, like "Orca Relay", does not fit the web client: the page code would arrive from the relay's origin.
- **An own hardened listener.** Right now any unsigned call is the operator (`invocation/admission/actor.ts:72–74`), and only the loopback binding protects: a proxy on 5633 would hand the operator to any tailnet device.
- **A paired device is the operator in full,** with a device mark for the journal; nothing asks for confirmation.
- **The server itself sends push** (Web Push, VAPID). The payload is encrypted with the browser's key (RFC 8291); APNs and FCM cannot read it.
- **The server OS shows in two places, and both are data owned by their owner.** The Tailscale CLI search paths per platform live in the Tailscale pack ([[68a2d306]]), sleep hold is `idleSleepFacility(platform)` at the wake module. Linux and Windows join as an entry there, not as branches across the code: everything else is Bun, the browser and web standards. The interface calls the server machine by name; there is no word "Mac" in it.

## Flow

```
phone ─https─▶ <machine>.<tailnet>.ts.net ─tailscale serve─▶ 127.0.0.1:<remote port>
  ─▶ remote listener ─▶ invocation (admission: the device is at remote) ─▶ operator{deviceId} ─▶ the same operations and feeds
threads ("Attention" events) ─▶ push ─▶ APNs / FCM ─▶ the phone's service worker ─▶ /<project>/chat/<id>
```

## Parts

- [[68a2d306]] — device entry: the listener, pairing, revocation, Tailscale, artifacts, the "Phone & devices" section.
- [[6ab92e8d]] — the mobile shell and PWA.
- [[c39abc78]] — push.

## Order

Device entry goes first. The shell in parallel: before entry it is developed over loopback through the manual choice. Push after entry — the subscription is bound to the device.

## Defaults in v1

- Push is always sent, even when the operator sits at the computer: suppression would need a window-presence signal.
- A stream of another CLI in terminal mode shows its status and "Open on <machine>" on the phone. Streams on ACP ([[adb9cd5b]]) are an ordinary feed and work on the phone on their own.

## Out of the spec

- An own relay and a native app.
- The terminal, graph, blocks, journal, checkout and rules on the phone.
- An offline copy of the data.
- Server launch at login and waking a sleeping machine ([[2e073431]]).
- Moving the desktop from port 5634 to `/a/` under the sandbox: possible after device entry as a separate decision, because it touches link handling in Electron.

## Full acceptance

- iPhone (a home-screen PWA) and Android Chrome on a cellular network with Tailscale: QR pairing → "Attention" → answering an agent's question → stopping the run → push on the locked screen → a tap opens the stream.
- The desktop browser and Electron are unchanged: resize never switches the shell, no service worker registers there.
- Without a device credential the remote listener serves neither API, nor feeds, nor artifact pages.
