---
id: 01a1b2cd-b572-7244-8f97-fb194d92c6ea
title: A plugin's composer parts and commands reach a thread only in projects where the plugin runs, and an action command asks for its words in a field
ord: 36
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/pluginParts.composer.svelte
---
The parts come from the project's view sets, which list only plugins enabled there, and the commands from the machine-wide actions feed filtered by the set's `projects`; so neither needs a check of its own. Parts are drawn together in the composer's `dock` region, each through `PluginView`, whose boundary keeps a failing part to itself; their modules are preloaded with result views, so a part draws without waiting for its load.

A command is listed as `/<plugin>-<name>`: the composer's command roster refuses a second command of one name, and a plugin's own name cannot meet Tagma's or another plugin's. An action command takes its words through a field rather than as the text after its name, because a command that opens on the typed text runs on every keystroke; its answer replaces the draft, and a refusal shows as the composer's notice. A text command asks for words through the same field only when its text holds `$ARGUMENTS`, every occurrence of which the words replace; a text without it is inserted at once. So one command shape covers both a fixed prompt and a parameterized one, as a Claude Code command does.