---
id: 01a18869-9324-73d4-a9c2-b724eb40c396
title: One refresh per sign-in record serves every project pool, and a refused refresh drops only the tokens it refused
ord: 11
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/mcp/serverPool.ts
  - kind: file
    ref: apps/tagma/server/src/mcp/signIns.ts
---
A user-scope server is one sign-in record (`user/<server>`) that every project's pool reads. `bearer()` refreshes a token expiring within a minute; `rejected(token)` refreshes only while the stored access token is the one the server rejected. Both go through the secret store's refresh flight keyed by the record, which re-reads the record inside the flight and commits only over the refresh token it started from — so the second pool to ask finds the fresh token and spends nothing, and a refresh racing a new sign-in never overwrites it.

A refusal — an invalid grant or client, or no refresh token left — drops the tokens only while they are still the refused ones, and a non-pre-registered client with them on `invalid_client`; the server then reads `needs-sign-in`. A transient failure keeps the tokens and fails only that connection. Every access token handed out joins that pool's redactor and stays there for the pool's life, like a `${NAME}` value: a request still in flight with the previous token can answer after a refresh, so dropping the predecessor would let a tool echoing its authorization show it. The OAuth kit masks in its own failure text the refresh token, code, verifier and client secret it sent, because an authorization server's unparsable error body reaches the reason whole.

A server reading `needs-sign-in` is settled: reconcile does not retry it under an unchanged declaration. Completing or dropping a sign-in reconnects only the servers reading that record, each through `McpPool.reconnect`, so no other server's handshake is waited on.
