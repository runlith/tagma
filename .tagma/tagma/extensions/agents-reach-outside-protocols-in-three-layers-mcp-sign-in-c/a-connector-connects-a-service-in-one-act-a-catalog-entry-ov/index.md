---
id: 01a184c6-16dd-744f-b710-46e599d9552a
title: "A connector connects a service in one act: a catalog entry over a remote MCP server and its sign-in"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "open"
  }
---
## What the person gets

A **Connectors** view lists services Tagma knows: their name, icon, a line of what an agent can do there, and their state in this project.
- **Connect** is one act. It declares the service's remote MCP server and starts its sign-in, or asks for its key, through the MCP layer.
- A connected service appears in the MCP server list as that server, marked with the service's name and icon. Its state is the server row's: connected, `needs-sign-in`, `needs-value`, failed.
- **Disconnect** removes the declaration, and with it the tokens, the values and the client registration of that server.
- A service missing from the catalog is connected by URL through the MCP server form, with the same sign-in. There is no separate "custom connector".

**Connect** asks where, as MCP servers and skills do: for all the person's projects, or for this project only. The choice is the declaration's scope (`user` or `project`), and `connect` takes it as input. A project that turns the person's servers off shows a connector connected for all projects as "connected, off in this project".

## Design

**A connector is data, not a runtime.** A catalog entry holds:
- id, title, icon and a one-line description;
- the remote MCP URL;
- the sign-in kind: `oauth`, optionally with a pre-registered public client id (PKCE, no secret, because the catalog is public) and the loopback redirect URIs it registered; or `key`, with the header template and where the person gets the key;
- the capability classification of its tools (an MCP declaration requires one).

**Connecting** writes an ordinary MCP declaration with a catalog mark.
- The mark lives in Tagma's setting member, which wraps the kit's declaration. The pool receives the declaration without it, so the mark is not part of the declaration's identity (`mcpDeclarationFingerprint`) or its equality (`mcpDeclarationsEqual`), and `@runlith/mcp` never knows it.
- Everything after connecting is the MCP layer's: sessions, tools, sign-in, refresh, redaction.
- The connected state is a projection of MCP rows by their mark, per calling project, because a project can decline the user layer (`mcp/declarations.ts`). No second list of connected services exists.

**Edge cases.**
- `connect` refuses `mcp-server-exists` when a server of that name is already declared in the target scope.
- A catalog update never rewrites a declared server. When an entry's URL changes, the view marks the service "changed" and offers to reconnect.

**Catalog source.** The catalog ships inside Tagma as data owned by a new `connectors` server module, so it works offline and with no account. The module reads entries of one shape through one contract. A hosted catalog, if one comes, fills that contract and changes no reader.

**First entries.** An entry ships only once its one-click path is verified: the vendor's own remote MCP server signs in by OAuth without the person registering anything. The first set to verify is GitHub, Linear, Notion, Sentry and Figma. Google's Workspace servers (Gmail, Drive, Calendar) are in developer preview and sign in only through an OAuth client the signing app registers with Google. They join once Tagma holds such a client; until then a person connects them by URL with a client they registered.

**Operations.**
- `read_connectors` answers each entry with its state for the calling project.
- `connect` and `disconnect` are operator-only.
- An agent reads the catalog and the states and asks the person to connect. It never signs in.

## Owners touched

- New `connectors` (server): the catalog and the operations.
- `mcp`: the setting member carries the optional mark beside the kit declaration.
- `app-mcp`: the Connectors view and the mark on rows.

## Acceptance

Every check runs through the operations, against the MCP layer's test servers.

- `connect` on a test `oauth` entry declares the server in the scope it was given and answers the authorization URL. After the test sign-in, `read_connectors` shows it connected, and `read_mcp_servers` shows one row carrying its mark.
- `connect` on a test `key` entry shows `needs-value` until `set_secret` sets the key, then connected.
- A project that declines the user layer reads that connector as off in this project.
- `connect` for a name already declared refuses `mcp-server-exists`.
- `disconnect` leaves no declaration, token, value or client registration of that server.
- Every catalog entry has a unique id and an HTTPS URL. This is checked over the shipped data, because types cannot check it.
