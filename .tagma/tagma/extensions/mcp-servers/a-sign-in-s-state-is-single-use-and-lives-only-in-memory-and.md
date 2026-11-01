---
id: 01a18869-931e-7cc9-af0b-6661567bdac8
title: A sign-in's state is single-use and lives only in memory, and the callback checks the issuer before it reads the answer
ord: 10
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/mcp/callback.ts
  - kind: file
    ref: apps/tagma/server/src/mcp/signIns.ts
---
A pending sign-in holds the code verifier, the expected issuer, the client and the redirect it went out with, keyed by a 32-byte random state. The callback deletes it on first sight, before any check, so a replayed, tampered or late answer finds nothing and stores nothing; it expires after ten minutes, and a newer sign-in of the same server replaces it. It lives only in memory, so a server restart forgets it and the person signs in again — nothing durable waits on a browser. Its expiry is published, so the card stops waiting when it lapses.

Signing out or removing the server ends the server's sign-in lifetime: it withdraws a pending sign-in, and an exchange already past the state check keeps its tokens only if the lifetime it started in still stands — checked inside the store's write, so a removal never sees its record come back. The lifetime is read when `sign_in_mcp_server` begins, before discovery and registration, so a removal while they run leaves no pending sign-in behind.

Only `sign_in_mcp_server` creates one; the pool never reaches the SDK's authorization, so no reconnect can replace it. The callback compares `iss` to the issuer the sign-in discovered byte for byte, with no normalization, and refuses an absent `iss` where that server's metadata promises one. It reads the answer's `error` and `error_description` only after the issuer passes: on a mismatch they come from whoever forged the answer and are never shown. The callback is a route `mcp` declares pre-admitted, so the remote door hands its GET to it before device admission: the state is its only credential.
