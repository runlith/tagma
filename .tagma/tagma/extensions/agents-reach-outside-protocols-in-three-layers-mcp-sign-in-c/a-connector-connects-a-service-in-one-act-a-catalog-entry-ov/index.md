---
id: 01a184c6-16dd-744f-b710-46e599d9552a
title: "A connector connects a service in one act: a catalog entry over a remote MCP server and its sign-in"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
## What the person gets

The MCP servers settings section opens with **Connectors**: the services Tagma knows, each with its name, icon, a line of what an agent can do there, and its state in this project.
- **Connect** is one act. It declares the service's remote MCP server and starts its sign-in, or asks for its key, through the MCP layer.
- A connected service appears in the MCP server list as that server, marked with the service's name and icon. Its state is the server row's: connected, `needs-sign-in`, `needs-value`, failed.
- **Disconnect** removes the declaration, and with it the tokens, the values and the client registration of that server.
- A service missing from the catalog is connected by URL through the MCP server form, with the same sign-in. There is no separate "custom connector".

**Connect** lands where MCP servers do: on the scope the settings page stands on, for all the person's projects or for this project only. The choice is the declaration's scope (`user` or `project`), and `connect_service` takes it as input.

## Design

**A connector is data, not a runtime.** A catalog entry (`ConnectorEntry`) holds:
- id, title, icon (the path of a one-colour mark, drawn in the text colour) and a one-line description;
- the remote MCP URL;
- the sign-in kind: `oauth`, optionally with a pre-registered public client id (PKCE, no secret, because the catalog is public) and the loopback redirect URIs it registered, used only when the calling door's callback is one of them; or `key`, with the header template and where the person gets the key;
- the capability classification of its tools (an MCP declaration requires one).

**Connecting** writes an ordinary MCP declaration under the entry's id, with a catalog mark.
- The mark is an optional `connector` field of Tagma's setting member (`McpServerSetting`), beside the kit's declaration fields. The resolution strips it before anything reaches the pool, so the mark is not part of the declaration's identity (`mcpDeclarationFingerprint`) or its equality (`mcpDeclarationsEqual`), and `@runlith/mcp` never knows it. The server row carries it as `connector`.
- After declaring, connect raises the server in the calling project through the pool's narrowing (`McpServers.raise`), so a connector declared for all projects reads its own state where it was connected without starting that project's other servers.
- Everything after connecting is the MCP layer's: sessions, tools, sign-in, refresh, redaction.
- The connected state is a projection of the calling project's MCP rows by their mark (`connectors/states.ts`). No second list of connected services exists, and a live feed (`connectors`) carries it to the view as the rows move.

**Edge cases.**
- `connect_service` refuses `mcp-server-exists` when a server of that name is already declared in the target scope, and, before writing anything, when it would connect for all projects a name this project declares for itself, whose declaration would stand in front of it.
- A catalog update never rewrites a declared server. When an entry's URL changes, the row reads `changed` and the view offers to reconnect.

**Catalog source.** The catalog ships inside Tagma as data owned by the `connectors` server module, so it works offline and with no account. The operations read entries of one shape through one port (`ConnectorCatalog`), which composition fills with the shipped data. A hosted catalog, if one comes, fills that port and changes no reader.

**First entries.** An entry ships only once its one-click path is verified: the vendor's own remote MCP server signs in by OAuth without the person registering anything, which today means its authorization server offers dynamic registration of a public client. Linear, Notion and Sentry ship. Google's Workspace servers (Gmail, Drive, Calendar) are in developer preview and sign in only through an OAuth client the signing app registers with Google. They join once Tagma holds such a client; until then a person connects them by URL with a client they registered.

**Operations.**
- `read_connectors` answers each entry with its state for the calling project; agents read it.
- `connect_service` and `disconnect_service` are operator-only.
- An agent reads the catalog and the states and asks the person to connect. It never signs in.

## Owners touched

- New `connectors` (server): the catalog, the operations and the feed.
- `mcp`: the setting member carries the optional mark beside the kit declaration; `raise` opens one server in a project.
- `app-mcp`: the Connectors list in the MCP section and the mark on server cards.

## Acceptance

Every check runs through the operations, against the MCP layer's test servers (`connectors.itest.ts`).

- `connect_service` on a test `oauth` entry declares the server in the scope it was given and answers the authorization URL. After the test sign-in, `read_connectors` shows it connected, and `read_mcp_servers` shows one row carrying its mark.
- `connect_service` on a test `key` entry shows `needs-value` until `set_secret` sets the key, then connected.
- `connect_service` for a name already declared refuses `mcp-server-exists`, as does connecting for all projects a name the project declares itself.
- `disconnect_service` leaves no declaration, token, value or client registration of that server: connecting again reads signed out with no client, and a keyed one needs its value again.
- Every catalog entry has a unique id and an HTTPS URL. This is checked over the shipped data, because types cannot check it.

A project declining the person's MCP servers — read as "connected, off in this project" — waits on a door to decline them, which [[356917d4]] adds.
