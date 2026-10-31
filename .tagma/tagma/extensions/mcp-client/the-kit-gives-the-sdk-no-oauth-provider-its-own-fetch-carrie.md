---
id: 01a18869-9314-71ed-802b-99a7b04783a5
title: "The kit gives the SDK no OAuth provider: its own fetch carries the bearer, so only Tagma refreshes or re-authorizes"
ord: 31
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/mcp/src/mcpOAuth.ts
  - kind: file
    ref: packages/mcp/src/sdk.ts
---
`@modelcontextprotocol/sdk` 1.30.0 runs its `auth()` orchestrator from the Streamable HTTP transport whenever it holds an auth provider, and that orchestrator is wrong for a pool of sessions:
- it refreshes inside every call whenever it holds a refresh token and wipes the stored tokens on `invalid_grant`, so two sessions of one user-scope server — one per open project — would race a rotating refresh token and the loser would wipe the winner's tokens;
- with no usable token it starts a new authorization and overwrites the code verifier, so a background reconnect would break a sign-in the person has open;
- without a redirect URL it falls back to a client-credentials grant;
- on `invalid_client` it calls `invalidateCredentials('all')`, which would drop a client the person registered by hand.

So the transport gets no provider. The kit's own fetch adds `Authorization: Bearer` from `bearer()`, answers a 401 carrying a Bearer challenge by calling `rejected(token)` once and retrying the request once, and turns a Bearer challenge it still meets — or a 403 `insufficient_scope` — into a kit-internal error that each request's catch maps to `McpNeedsSignIn` with the challenge's scope and `resource_metadata`; nothing is parsed from a message. A 401 without a Bearer challenge stays an ordinary failure: a server keyed by a header value is not an OAuth server. For the same reason `@runlith/mcp/auth` calls the SDK's discovery, registration, authorization, exchange and refresh functions one by one and never `auth()`. It reads the authorization server's metadata itself over the SDK's discovery URLs and keeps the raw document: the SDK's OpenID schema strips unknown keys, which would lose `authorization_response_iss_parameter_supported` and let an answer without `iss` through.

A 403 `insufficient_scope` on a single request is a sign-in too: the pool marks the server `needs-sign-in` with the scope the challenge asks for, even while ping still answers, and a resource read carries the same challenge inside its failure.
