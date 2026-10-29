---
id: 01a184c6-16dd-744f-b710-46e4142a1788
title: One key store holds every secret handed to a process, and remote MCP servers sign in by OAuth
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
## What the person gets

A remote MCP server that asks for sign-in shows **Sign in** on its card instead of failing. One click opens the service's sign-in page in the browser of the device the person is using, the desktop or a paired phone. On return the server connects and its tools reach agents. The token refreshes by itself until the service revokes it, then the card asks again.

A server that wants a key names the key on its card. The person pastes it there once, and it never enters settings, the graph or a feed.

An agent reading `read_mcp_servers` sees `needs-sign-in` or `needs-value` and tells the person; it never holds a secret.

## Part 1: one key store

**Today.**
- An MCP declaration's `${NAME}` resolves only from the server process environment (`mcp/serverPool.ts`, `process.env`). A person using the desktop app cannot set it.
- `list` shows such a row failed, and the pool's reconcile skips it.
- App secrets live in `plugin-secrets.json` (`plugin-secrets/store.ts`), with their own operations, redaction and restart.

These are two mechanisms for one fact: a secret Tagma hands to a process.

**After.**
- **Store.** A new server module `secrets` owns one document `secrets.json` on `@runlith/credential-file` (0600, atomic replace, interprocess lock): values and sign-in records keyed by owner.
- **Owner keys.** An owner is a kind and an id. The module that owns the kind registers it and checks its ids: `mcp` with `(user, server)` or `(project id, server)`, and today's apps module. Project-scope declarations are per project (`settings/store/rows.ts`), so two projects' servers of one name never share a value or a token.
- **Variants stay outside.** The `secrets` core and its wire name no owner kind. The rename later touches only the apps module.
- **Handout.** The store hands an owner its values plus their masked forms for the redactor (the value and its JSON-escaped form, as `plugin-secrets/shelf.ts` does). A change notifies the owner, which restarts or reconnects only what reads the changed value.
- **Removal.** Removing an owner drops its values and its sign-in record: `remove_mcp_server` for a server, uninstalling for an app.
- **`plugin-secrets` dissolves.**
  - Its storage moves into `secrets`. Its values move into `secrets.json` on the first start that carries the store, and the old file is deleted after the move is verified.
  - The `secrets` contribution point, the declaration it learns at launch and the launch environment move into the apps module, as that module's owner kind. `secrets` imports no apps code.
- **Model provider credentials stay with `providers`** (`tokens.json`, `console-keys.json`, adapter instance secrets):
  - their document format is declared by each adapter (`FileTokenStore` `scheme.credential`);
  - they include borrowed CLI accounts that Tagma reads but never refreshes (`providers/credentials/borrowed.ts`);
  - they refresh across processes under a file lock.

**MCP values.**
- `${NAME}` in a declaration of the `user` or `project` scope resolves first from the store under its owner, then from the process environment, so headless setups keep working.
- `add_mcp_server` no longer refuses a missing value (`mcp-secret-missing` is removed, with its grammar text). It declares the server, and the row shows `needs-value` naming the names until they are set.
- Values are still resolved into the declaration, so changing a key reconnects the server, as today.

**Operations.**
- `read_secrets`, `set_secret` and `remove_secret` take `{owner: <kind>, id, name}`. The registered owner checks the id and name.
- They replace the three `*_plugin_secret` operations.
- They are operator-only and never answer a value: a read answers `{name, description, set}`.
- New code in this layer never takes the word "plugin".

## Part 2: OAuth for remote MCP servers

**Protocol.** The MCP authorization spec, revision 2026-07-28, client side:
- protected resource metadata (RFC 9728);
- authorization server discovery (RFC 8414 and OIDC);
- PKCE S256 and `resource` (RFC 8707);
- scopes from the challenge, then `scopes_supported`;
- step-up on 403 `insufficient_scope`.

`@modelcontextprotocol/sdk` 1.30.0, which the repository resolves, implements discovery, registration, authorization and exchange (`client/auth.js`). Tagma uses it there and owns two things the SDK does wrong for a pool of sessions: refresh, and re-authorization during reconnects.

**Kit contract.** `@runlith/mcp` stores no secret. Its HTTP transport input gains an optional `auth` with two calls:
- `bearer()`: the current access token, or none;
- `rejected(token)`: a fresh token, or `needs-sign-in`.

The kit carries the bearer in its own fetch and hands the SDK no auth provider, so the SDK never refreshes, re-authorizes or drops a client. On a 401 with a Bearer challenge it calls `rejected` once and retries once; a Bearer challenge it cannot answer, or a 403 `insufficient_scope`, is a typed `needs-sign-in` carrying the challenge's scope and `resource_metadata`. A 401 without a Bearer challenge stays an ordinary failure, as for a server keyed by a header value.

A typed kit failure carries `needs-sign-in` into `McpServerStatus` (`packages/mcp/src/McpPool.ts`); it is never parsed from a message. The rule "pass declarations with already-resolved values" holds: tokens are not values of the declaration.

The reasons for this shape:
- **SDK refresh.** The SDK refreshes inside every `auth()` call whenever it holds a refresh token (`auth.js` `authInternal`). On `invalid_grant` it invalidates the stored tokens. Two sessions of one user-scope server, one per open project, would race a rotating refresh token, and the loser would wipe the winner's tokens.
- **SDK re-authorization.** With no usable token, `auth()` starts a new authorization and overwrites the code verifier, so a background reconnect would break a sign-in in progress.
- **Hosted seam.** The same two calls are what a hosted account holding tokens could serve, so the seam is this one contract.

**Tokens never enter the declaration.** The declaration fingerprint is row and session identity (`declarations.ts`, `mcpDeclarationFingerprint`). A token resolved into a header would reconnect the server on every refresh, and open MCP App views would refuse with `mcp-server-replaced`.

**Sign-in record.**
- One record per owner `(user, server)` or `(project id, server)` holds:
  - the client identity and its registered redirect URIs;
  - the discovered authorization server — its `issuer`, metadata, resource and scope — so a refresh needs no discovery;
  - the tokens.
- **Refresh.** Tagma refreshes a record with a single flight per record, and stores the result only if the grant it refreshed is still the stored one. That flight is the mechanism `FileTokenStore.getAccessToken` and `recoverAccessToken` already implement (`packages/llm/src/oauth/FileTokenStore.ts`). It moves into `@runlith/credential-file` as one primitive, with the cross-process lock as its option. `FileTokenStore` and the MCP record both use it, so no second implementation stands.
- **Pre-registered clients.** A refused client registration never drops a client the person pre-registered; the card shows the failure.

**Client identity, in this order.**
1. **Pre-registered.** The person enters a client id, and a secret if the service gives one; the card shows the redirect URIs to register. A catalog entry may carry such a public client id.
2. **Client metadata document (CIMD).** Used where the authorization server supports it. Its address is the `mcp.clientDocument` setting, which defaults to the document Tagma publishes on its site; set to null, a sign-in goes from step 1 to step 3. The document is one static public HTTPS file with no account data, served readable cross-origin. It can list only loopback redirect URIs: `http://127.0.0.1:<port>/mcp/oauth/callback` for the default port of each channel (stable and dev). A remote-door sign-in falls back to step 3. A local door on another port (`TAGMA_PORT`) still goes out with the document, which a server that ignores the port of a loopback redirect (RFC 8252) accepts and one that matches it exactly refuses.
3. **Dynamic registration.** Used where the server offers it, and repeated when the registered redirect URIs no longer cover the door in use.

A server offering none of these refuses `sign_in_mcp_server` with that reason.

**Redirect.**
- **The route.** The callback is a route of Tagma's own HTTP door, `/mcp/oauth/callback`, on the door the sign-in started from.
- **Which URI.** `sign_in_mcp_server` takes the redirect URI from the calling door through a door service the composition fills per listener, as it fills the terminal lane's endpoint, never from input:
  - the local door's loopback origin, `http://127.0.0.1:<port>`;
  - or the remote door's stored origin, which paired devices reach.
- **Why a route.** A random-port loopback listener (`packages/llm/src/oauth/callback-server.ts`) could not be pre-registered with a server that matches redirects exactly, and a paste fallback is poor on a phone.
- **The local door changes nothing.** `localGate` (`composition/http/local.ts`) checks a loopback Host, and a top-level navigation carries no `Origin`.
- **The remote door gets one exception.** Its gate answers this path before `admission.remote`, the way it answers the pairing endpoint (`composition/http/remote.ts`):
  - only a GET;
  - framed as unframed;
  - admitted only by a pending, single-use state bound to one sign-in and expiring with it.

  Without this exception the gate serves this GET the app shell, and the device keeper refuses a cross-site request (`remote/keeper.ts`).
- **Pending sign-in.** The pending sign-in, keyed by its state, holds the code verifier and the expected issuer. Only `sign_in_mcp_server` creates one; it lives in the server's memory, single-use, for ten minutes, and a newer one for the same server replaces it. The pool never reaches the SDK's `auth()`, so a reconnect can never replace a pending sign-in.
- **Issuer check (RFC 9207),** done by Tagma because SDK 1.30.0 does not:
  - with `iss` present, compare it to the expected issuer byte for byte, with no normalization;
  - with `iss` absent while the server's metadata sets `authorization_response_iss_parameter_supported` to true, reject;
  - on a mismatch, never show the response's `error` or `error_description`.
- **Exchange.** The code is exchanged through a kit entry (`@runlith/mcp/auth`) over the SDK's discovery, registration, authorization, exchange and refresh functions, never its `auth()` orchestrator, so server code never imports the SDK and no transport is needed.

**Flow.**
1. `add_mcp_server` for an HTTP server whose first answer is a 401 carrying a Bearer challenge declares it and answers after that first handshake, so the row shows `needs-sign-in` in every open pool that runs it; a project whose pool is not open, or is narrowed to other servers, reads `pending` until it runs it.
2. `sign_in_mcp_server` (operator-only) discovers and resolves the client identity, and answers the authorization URL.
3. The app opens it (`links.open`, as provider sign-in does).
4. The callback completes the exchange, and the pool connects.
5. A rows feed in `mcp` brings the new state to `app-mcp`, whose repo today is a `read_mcp_servers` query with no feed, so the card moves to connected without a reload.
6. `sign_out_mcp_server` drops the tokens and keeps the client identity.
7. A refresh the authorization server refuses drops the tokens and moves the row back to `needs-sign-in`; a transient failure leaves them and fails only that connection.

## Owners touched

- New `secrets`.
- `@runlith/credential-file`: the refresh flight.
- `@runlith/llm`: `FileTokenStore` moves onto the flight.
- `@runlith/mcp`: the auth contract, the typed status and the `auth` entry.
- `mcp` (server): resolution, rows feed, sign-in, the door route.
- The remote door's gate.
- `plugin-secrets`, dissolved into `secrets` and the apps module.
- `app-mcp`: card fields, sign-in state and buttons.
- `app-plugin-secrets`, onto the generic owner screens.
- The `plugins` skill (rule 7cb3c1cf) and the MCP doctrine text.

## Acceptance

Every check runs through the operations a caller uses, against an in-process test MCP server behind an in-process test authorization server.

- **Sign-in.**
  - `add_mcp_server` in a project answers a `needs-sign-in` row, and `sign_in_mcp_server` answers an authorization URL.
  - Following the URL through the local door's callback connects the server and lists its tools.
  - The same works through the remote door's callback, with no device cookie.
- **Rejected callbacks.** A callback is refused, and nothing is stored, for:
  - an unknown state;
  - a reused state;
  - a wrong `iss`;
  - an absent `iss` where metadata requires it.
- **Reconnect during a sign-in.** Reconnecting the server (`enable_mcp_server`) while a sign-in is pending leaves that sign-in completing.
- **Refresh.**
  - An expired access token is refreshed once across two project pools of one user-scope server, with a rotating refresh token at the test server.
  - Neither the declaration identity nor the session changes on refresh.
- **Values.**
  - A `${NAME}` set through `set_secret` connects a header-authenticated server with no environment variable.
  - A missing value shows `needs-value`.
  - Two projects declaring a server of one name keep separate values and tokens.
  - `remove_mcp_server` leaves no value or sign-in record of that server in the store.
- **Migration.** After the first start, an app secret set before in `plugin-secrets.json` reaches its app process from `secrets.json`, and `plugin-secrets.json` is gone.
- **No leaks.** A set value does not appear in the answers of `read_mcp_servers`, `read_secrets` and a failed connect's refusal, nor in a test tool's answer that echoes it.
