---
id: 01a18e6c-7bbb-7241-82cc-ea20753ba256
title: Plugins is a place on the rail where a person finds, adds and manages everything agents can use in a project
ord: 26
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
## What the person gets

Plugins is a place on the rail of every project, beside Agents, Knowledge and Rules. It is where a person finds what agents can be given, adds it, and sees what agents can use here. Settings keep only behaviour: the Plugins section and the server list of the MCP section leave them.

**One list of what agents can use here.** The place's own list opens with "In this project": every installed plugin, every MCP server declared for the person or the project, ordered by attention — what waits on the person first (a sign-in, a missing value), then what does not start, then the rest by name. A row is the thing's name; its state is a tile in the tail: blue when it waits on the person, red when it does not start, nothing when it works; "Off" when it is installed but off here, "Update" when its marketplace lists a newer version. Below it: the catalog's groups (all, then each category) and the sources (each marketplace with its entry count).

**The catalog.** One search over every source. Tagma's own plugins first as cards, then every entry as a row: icon tile, name, one line, publisher in words. An entry of an unreviewed source carries an outlined "Unreviewed". Entries of the same name in several sources show once, the most trusted source first; the others are named on its page.

**A plugin's page** answers, in this order: what agents get (each component in plain words — a connection to a service, a skill by the name typed after `$`, an agent, a command run on this computer), what adding it costs (what it reaches, what it runs on this computer, the sign-in it will ask), and the facts (version, source, format). One primary button names the project, "Add to <project>"; its menu adds it to all the person's projects.

**Adding is one flow on the page.** Added → sign in to each remote server that asks (the button opens the browser; agents never sign in) → ready, with the tools the server answered. "Later" leaves the plugin added and its row blue. A failure is a red tile with the reason as the process gave it.

**An installed plugin's page** carries its state, the sign-ins it waits on, its options and secrets, what it brings and what Tagma ignores, and its acts: turn off here or on, run in all projects, update, remove. A standalone server's page is the same for one server.

**Add by address**, from the place's header: one field takes a marketplace or a plugin (git URL, `owner/repo`, folder), a service address or a command, and says what it found before anything is added.

## Design

- **Owner.** `app-plugins` owns the place: `features/plugins/surfaces.ts` declares the surface (`plugins`, rail order after Rules), `routes/[project]/plugins/[[id]]` renders it, the id encodes the opened place. The server list moves from `app-mcp`'s settings section into the place, reusing its server card; `app-mcp` keeps the settings that are behaviour (whether a project uses the person's servers, the client document).
- **Data.** The catalog reads the `marketplaces.subscribe` feed; installed plugins `read_plugins`; servers `read_mcp_servers` kept live by the `mcp.servers` feed. The page never reads a package: a plugin's page asks `preview_plugin` and installs the prepared revision.
- **Catalog data the server owns.** The marketplaces module fills an entry's title, description and what it brings from the plugin's own manifest when its list leaves them out and the package lies in the list's own checkout, and names one category from a closed set across vendors' words.
- **Address inspection** is a marketplaces operation answering what a source holds — a marketplace list or a plugin, with its preview — so the field never guesses by trying to add.
- **Interface** follows `tagma-design`: state is a tile, gold only for the place you are in, publisher in words, no colour for trust.

## Acceptance

- The rail shows Plugins in every project; Settings no longer carries the Plugins section or the MCP server list.
- Through the operations against fixture marketplaces: the catalog lists entries of two sources with one row per name; a plugin's page previews, adds to this project and to all projects, and an added plugin whose server asks for a sign-in reads as waiting until signed in.
- An entry whose list omits its description and components reads them from its manifest.
- `bun run typecheck` for the app and server passes; tests only where the project's test rules allow them.
- What the screen looks like is not checked live.
