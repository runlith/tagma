---
id: 01a1a19e-955c-7ece-a9f7-f89859f041a7
title: Adding a folder asks only what the folder cannot answer; a graph it finds keeps its own storage and catalogs
ord: 1
tags: ["spec"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/NewProjectDialog.svelte
  - kind: file
    ref: apps/tagma/server/src/graph/serving/birth.ts
---
Adding a folder asks only what the folder cannot answer. Today the New project dialog and `add_project` never look at the folder: they ask storage and catalogs for every folder, birth a fresh root with the chosen catalogs, pin the choice as the project's `graph.catalogs`, and the first opening then finds a carried `.tagma` tree, serves it instead of the fresh rows (`switchIfDue` → standing) and installs the pinned catalogs into it (`ensureVocabulary('mirror')`). A teammate cloning a repository with a team graph therefore gets an empty stealth graph when he keeps the default, or writes catalogs he ticked for himself into the graph everyone shares. The desktop fast path creates every folder as stealth, so a carried graph is ignored there too. The same happens to a graph a module brings from elsewhere at birth (a graph remote holding a graph): it opens, then receives the catalogs the dialog asked for.

## What stands after

**One rule at the owner.** A project whose opening finds its tree already holding blocks while its own birth rows were never projected — once per project, never on a later rebuild of a mirror — — a graph carried in the folder, or one the exchange side brought — takes the catalogs installed in that tree as its own `graph.catalogs` choice (project layer, pinned), replacing whatever the creation wrote. The graph it found is the truth; nothing is installed into it on that opening, and a later change of the machine default adds nothing to it. Catalogs chosen at creation install only into a graph born empty.

**Reading a folder before adding it.** A read operation, `read_folder`, answers for a path whether its project root carries a graph (`.tagma` holding a block — the cheap holds-any answer of the tree scanner, never a whole scan) and whether it is a git repository. The dialog asks it; in the web dialog it reads the typed root path.

**`add_project` derives what the folder decides.**
- `storage` omitted: `team` when the folder carries a graph, otherwise `stealth`.
- Over a carried graph, an explicit `storage: "stealth"` or any `catalogs` refuses `graph-carried`, naming that the folder carries its graph and that omitting them takes the graph as it stands. A carried graph is registered without birth rows: no fresh root, no catalog install, no pin from the input.
- CLI `tagma project add` follows the operation.

**The dialog (title and button: Add project).**
- Until a folder is chosen and read, it shows only the folder control and a disabled Add project.
- Folder carries a graph: a card says the repository carries its graph in `.tagma`, travels with the repository and opens as it stands; below it only Name and the contributed fields placed for a carried graph. No storage, no catalogs.
- Folder without a graph: the New graph path asks Name, Storage (Stealth by default) and Catalogs as checkboxes; none ticked installs only the system library, so the "No template" radio goes.
- A contributed creation field may declare itself a graph source with a label. When one exists, a folder without a graph offers two tabs — New graph and the source's label; the source tab shows only Name and the source fields, and the call carries no storage and no catalogs. Without such a field there are no tabs.
- A contributed field declares where it stands: in the carried state, in the New graph path, or as a source. One without a declaration stands in the New graph path.

**Desktop fast path.** It passes no storage: a carried folder becomes a team project over its graph at once; any other folder is born as today.

## Acceptance

- Through the `add_project` door: a folder whose `.tagma` carries a graph with only the `knowledge` catalog, on a machine whose default is `software-development`, becomes a team project; after its first opening the installed catalogs are the system library and `knowledge`, and the project layer of `graph.catalogs` names exactly those.
- The same folder with `storage: "stealth"`, or with `catalogs`, refuses `graph-carried` and registers nothing.
- A folder without a graph, added with chosen catalogs, behaves as today.
- `read_folder` answers carried / not carried and git / not git without scanning the whole tree.
- The dialog shows the four states above, and sends no storage or catalogs for a carried folder or a source tab.
- The feature [[1b6ba70d]] says what the window and the operation now do.
