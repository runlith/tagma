---
id: 01a10b84-a62c-7c1f-a5ff-786268a2d306
title: "Device entry from another network: a hardened listener behind Tailscale Serve, one-time-code pairing, revocation"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/invocation/admission
  - kind: file
    ref: apps/tagma/server/src/artifacts/storage.ts
  - kind: file
    ref: apps/tagma/server/src/composition/http/artifacts.ts
  - kind: file
    ref: apps/tagma/server/src/composition/http/door.ts
  - kind: file
    ref: apps/tagma/server/src/power/sleepAssertion.ts
  - kind: file
    ref: apps/tagma/server/src/socket/live.ts
---
The phone enters the Tagma server through a separate listener that serves nothing without a device credential except the app shell and the code exchange. The local 5633 and 5634 never change and are never proxied.

## The `remote` module

A new server module `apps/tagma/server/src/remote`, kind product: devices, pairing, credential checks, remote access and its state. Imports: platform, settings. Entries: `contract/`, `remote.ts`, the assembly — for composition. The manifest declares its tables, operations, setting and the exchange HTTP endpoint. `invocation` gains a relation on `remote`; http and socket stay transport and never touch the device tables. Device revocation is published by `remote` as an event in its contract — `push` subscribes to it.

## Listener

- `127.0.0.1:<DEFAULT_PORT + 2>` — 5635 at the standard port, the same env mechanism ports use now. One origin for the app shell, API, WS and artifact pages. It rises while `remote.enabled` = true (false by default, user scope, operatorOnly).
- The listener type is set by the server configuration. `Tailscale-User-*`, `X-Forwarded-*`, session and grant headers never authenticate at this door.
- Without a credential only the app shell (`index.html`, `/_app/*` without source maps, the manifest, icons, `service-worker.js`) and `POST /api/access/pair` are served. API, `/health`, WS and `/a/*` answer HTTP 401 with code `device-unpaired` or `device-revoked`.
- State-changing HTTP and WS upgrade require an `Origin` exactly equal to the app origin with port; the origin comes from the transport state, not from `Host` or `Forwarded`. There is no mutation over GET, CORS is never opened.
- Every remote listener response carries `frame-ancestors 'none'` (CSP) and `X-Frame-Options: DENY`. `ts.net` is a public suffix, so for the browser all tailnet nodes and all machine ports are one site: a frame with the app would carry cookies and pass the Origin check.

## Who calls

- `Actor` stays `{kind:'operator', deviceId?}` (`platform/contract/wire/actor.ts`): the same rights, only admission writes `deviceId`, and it passes into the server call journal; graph events carry no device — the act's author there is the same operator.
- HTTP: the door passes transport facts into `invocation` — the listener type, cookie, Origin; admission checks the credential at `remote` ([[4657a163]]).
- WebSocket: the credential and Origin are checked before upgrade, the identity is pinned in the server-side connection context. Right now `socket/live.ts:49–62` upgrades without admission, and `composition/http/door.ts:106` calls `admission.admit({})` for every socket operation; the owners — invocation and socket — fix that. RPC message headers never authenticate: Effect glues the handshake headers to the client ones (`effect/unstable/rpc/RpcServer.ts`, the `message.headers` assembly).
- Revocation closes the device's sockets themselves with its own close code — `Protocol.end` of Effect's socket protocol does nothing — and ends their subscriptions. Already accepted commands are not cancelled: access revocation is not an agent stop.
- The browser sees an upgrade refusal as a drop (1006), not a 401. So the client learns it is unpaired through an HTTP call to `/health`, and the "final" close code only arrives on revocation of an open socket.

## The credential and pairing

- The credential is `<deviceId>.<32 random base64url bytes>`; the database keeps only the secret's SHA-256. It does not depend on `session.key`, which signs agent grants.
- The `__Host-tagma-device` cookie: always `Secure` (the listener behind Serve itself speaks http, so the connection scheme means nothing here), `HttpOnly`, `Path=/`, `SameSite=Lax`. Lax — because links arrive from outside: Camera, push, messenger; the exact Origin closes request forgery.
- The cookie is host-only, but the browser does not tell ports apart: any other service the machine serves through Serve under the same name receives it too when the phone opens it. A local service gains nothing beyond what it already reads on the machine; a mapping that proxies to another host carries the credential there.
- The term slides: 180 days from the last connection. `/health` on the remote listener extends `expiresAt` and reinstalls the cookie, so a phone in use never needs pairing again.
- The pairing code is 8 Crockford base32 characters (`XXXX-XXXX`), living 5 minutes. One code is active per installation: a repeated `create_pairing` returns the same one until it is redeemed or expires, so two open settings pages never redeem each other's codes. Wrong exchanges are rate-limited per installation, and reissue never resets the budget; other people's wrong attempts never burn the code. Input is normalized: case, hyphen, O→0, I and L→1. A tailnet member may hold the pairing past the wrong-attempt budget; Tailscale ACLs answer that.
- The QR carries `https://<origin>/pair#<code>`: the fragment never reaches HTTP logs or the Referer. The same code shows as text for manual entry in the installed PWA.
- The exchange is a declared HTTP authentication endpoint `POST /api/access/pair`: door → the authentication entry at invocation → `remote` atomically redeems the code and creates the device (two parallel exchanges yield one device) → the door encodes `Set-Cookie`. The Origin is checked before the body is read, the body is limited to a kilobyte. The secret never passes through the call journal.
- The `remote` tables in the machine SQLite: `device` (id, name, secretDigest, pairedAt, lastSeenAt, expiresAt, revokedAt) and `pairing` (codeDigest, expiresAt). Expired rows are swept on issue and redemption. `lastSeenAt` is written per connection, not per RPC.
- The device name comes from the UA at pairing ("iPhone · Safari"); there is no renaming.
- The server machine name is the tailnet node name, without it — the hostname. It arrives with the code-exchange response and with `read_remote_access`, and the interface calls the machine by it everywhere it speaks of it.
- Operations: `read_remote_access` (whether enabled, the origin, machine name, Tailscale state, current code), `create_pairing`, `list_devices` (limit and total), `revoke_device`. Audience operator, no MCP or agent doors.
- Switching `remote.enabled` off closes remote connections and stops accepting codes; the devices stay. Revocation is irreversible, re-entry means a new pairing.

## Tailscale

- The `remote/tailscale/` pack stands behind the `Exposure` contract in the `remote` core (origin, port, state); the core does not know tailnet ([[6f758080]]). Composition wires in the pack. A relay later replaces the pack and the TLS entry; devices, pairing, invocation and the client stay.
- The pack holds the CLI search paths as data per platform: `PATH` everywhere, plus `/Applications/Tailscale.app/Contents/MacOS/` on macOS and `C:\Program Files\Tailscale\` on Windows. A new platform is an entry in that list, not a branch in the code.
- The pack reads `tailscale status --json` and `tailscale serve status --json` and tells apart: not installed; not running or not signed in; HTTPS off in the tailnet; Serve forbidden without root — on Linux, cured once with `sudo tailscale set --operator=$USER`, which the section shows; Serve not configured; ready.
- Enabling remote access itself runs `tailscale serve --bg --https=443 http://127.0.0.1:<remote port>`. An exact Tagma mapping that already stands is accepted with no command. Someone else's mapping on 443 is left alone: Tagma takes 8443, and when that is busy too — shows the command. The launch is time-bounded and never waits on stdin; a refusal shows the genuine Tailscale output, including the link to the HTTPS approval.
- The installation keeps the origin of the first successful setup: installed PWAs, cookies and push subscriptions are bound to it. Someone else's mapping that later took that port is a blocked state with its target, not a move. The expected origin is known from the stored one before Tailscale answers, so the warm-up after a restart never refuses devices as forgery.
- A Tagma mapping with Funnel on is a blocked state: the listener does not serve, the section shows the command that switches Funnel off.
- After setup Tagma itself makes a warm-up request to the origin: the first HTTPS request waits for the certificate issue. The QR and the code appear only once the origin answers.
- Switching off removes the Tagma mapping by its target, even when the listener never rose, and repeats the removal until Tailscale confirms it; starting with access off removes the leftover Tagma mapping. Nobody else's is touched.
- Tagma never installs Tailscale, never signs in, never touches ACLs, Funnel, or someone else's Serve.

## Sleep and launch

Remote work requires `power.keepAwake = always`: `while-working` releases the machine exactly when a run waits for the operator — exactly when the phone is needed. Tagma never changes the setting itself; the "Phone & devices" section offers it in one tap.

What holds sleep on this platform and what the hold does not hold is told by the wake module: `idleSleepFacility(platform)` (`power/sleepAssertion.ts`) returns the helper together with its limit. On macOS that is `caffeinate -i`: it only holds idle sleep, and a closed laptop on battery still falls asleep. On a platform with no helper — "unavailable" with a reason. The section shows that text and writes no OS words of its own; Linux and Windows join at the wake module as a single entry.

The server must be running; launch at login is out of the spec.

## Artifacts

- On the remote listener pages are served at `/a/<id>` and `/a/<id>/v/<n>` with the same CSP and the HTTP header `sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox` without `allow-same-origin`. The document gets an opaque origin: it sees no cookies, its API requests carry `Origin: null` and are refused, `connect-src 'none'` stays. No second port and no second Serve are needed.
- The price: pages get no storage, `document.cookie`, downloads, printing, or `alert`/`confirm` dialogs. When real pages need that, a second origin takes the sandbox's place — a separate listener and Serve port; `allow-same-origin` is never added.
- The shelf index and the "no such page" answer require a credential too.
- A page's canonical address is the one the shelf hands out (`artifacts/shelf.ts:434`, the server's artifact origin); agents write it into the feed. The server declares that origin, and the link resolver shared by both shells translates the exact form `<declared origin>/a/<id>[/v/<n>][?…][#…]` into the artifact address of its own surface: on desktop the address never changes, on remote it becomes `/a/…` of its own origin.

## The "Phone & devices" section

- On top the "Allow access from your phone" switch (`remote.enabled`).
- Below, one state at a time, each with one next action: "Tailscale isn't installed — Get Tailscale"; "Open Tailscale and sign in"; "HTTPS certificates are off in your tailnet — Turn on" (a Tailscale link); "Setting up…" and "Getting a certificate…"; done.
- Done: the `https://…ts.net` address with copying; the QR and the code show at once, with no "Pair" button, refresh on their own while the section is visible, and after pairing; the QR is dark-on-light in both themes; the device list — name, when paired and when last seen, push on/off, "Remove" at once; while `keepAwake` ≠ `always` — the "While an agent waits for you, <machine> may sleep and your phone can't reach it · Keep awake: Always" line and the hold limit from the wake module.
- Over a remote connection the section never paints what would cut off the device itself: the remote-access switch and "Remove" on the current device.

## Acceptance

- Unadmitted HTTP and WS receive no data, including with forged session, RPC and Tailscale headers.
- Two simultaneous exchanges of one code create one device; wrong attempts past the budget are refused, and the code never changes.
- Revocation closes the device's open WS with its own close code.
- An artifact page under the sandbox reads no API and performs no mutation, even though cookies leave with its navigation; real interactive shelf pages open in Safari and Chrome.
- On a machine with Tailscale, tailnet HTTPS on and 443 free, enabling remote access yields a working `https://<machine>.<tailnet>.ts.net` with no manual command; with someone else's 443 — on 8443.
