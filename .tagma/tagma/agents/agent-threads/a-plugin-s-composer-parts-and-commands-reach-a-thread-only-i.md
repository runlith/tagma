---
id: 01a1b2cd-b572-7244-8f97-fb194d92c6ea
title: A plugin's composer parts and commands reach a thread only in projects where the plugin runs, through a face bound to the draft it was made for
ord: 36
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/pluginParts.composer.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/composerFace.ts
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/plugin-views/PluginActions.svelte.ts
    symbol: PluginActions.commands
---
The parts come from the project's view sets, which list only plugins enabled there, and the commands from the machine-wide actions feed filtered by the set's `projects`, the reading the palette's plugin actions use too; so neither needs a check of its own. `plugin-views` owns the turn from a plugin's entries to the composer: `ComposerParts` draws the parts, each through `PluginView`, whose boundary keeps a failing part to itself, and `PluginActions.commands` builds the slash commands on the same `run` the palette uses. Threads only builds the face and registers what it receives, so `ComposerFace`, which `plugin-views` declares, is the one seam between the two. Part modules are preloaded with result views, so a part draws without waiting for its load.

A face belongs to the draft it was built for: the contribution builds a new one whenever the slot's draft moves to another thread, and an older face keeps writing the draft of its own thread through `ThreadDraft.held`, while its `send` answers `false`. So a part or a slow action answering after the person moved on writes where it was asked, never into another thread's words. An action command's answer replaces that draft when it is still as the run found it, and follows what the person wrote there meanwhile otherwise. `insert` writes at the caret through the prompt editor's own synchronous write, so two inserts in one handler keep their order and live marks shift with them; without an editor it appends. A refused attachment rejects `attach` and is told in the composer.

A command is listed as `/<plugin>:<name>`: neither a plugin id nor a command name admits `:`, and Tagma's own commands carry none, so no two commands of the window can share a name and the composer's roster never refuses one. An action command takes its words through a field rather than as the text after its name, because a command that opens on the typed text runs on every keystroke; a refusal shows as the composer's notice. A text command asks for words through the same field only when its text holds `$ARGUMENTS`, every occurrence of which the words replace; a text without it is inserted at once. So one command shape covers both a fixed prompt and a parameterized one, as a Claude Code command does.
