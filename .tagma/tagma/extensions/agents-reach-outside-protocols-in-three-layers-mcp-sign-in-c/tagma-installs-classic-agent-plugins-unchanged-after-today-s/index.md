---
id: 01a184c6-16dd-744f-b710-46e663966472
title: Tagma installs classic agent plugins unchanged, after today's plugins are renamed TagmaApp
ord: 3
tags: ["spec"]
fields:
  {
    "status": "open"
  }
---
## What the person gets

The person installs a plugin written for the agent ecosystem, from a folder or a git URL, and Tagma's agent works with it unchanged: its skills, MCP servers and agents. A plugin is installed once per machine and enabled per project, like today's apps. Its page lists what Tagma took from it and what Tagma ignores, by name, so nothing is dropped silently.

## Step 1: rename today's plugins to `TagmaApp`

The rename runs first. Today's app manifest is a root `plugin.json` (`plugins/contract/wire/manifest.ts`, `MANIFEST_FILE`), the same path as an Agent Plugins manifest, so until the rename a directory is ambiguous.

The rename is task [[05a933b6]]. It renames:
- the manifest (`tagma-app.json`);
- the project and machine directories;
- the settings keys `plugins.installed` and `plugins.enabled`;
- the operations;
- the tool prefix and the capability;
- the data directory;
- the modules, the skill and the graph.

**Names.** Code says `TagmaApp` (`tagma-app`, `tagmaApp`): the server module `tagma-apps`, the client module `app-tagma-apps`, the project directory `.tagma-apps/`, the manifest `tagma-app.json`. What an agent or the operator reads follows the interface word "Apps": the operations `read_apps`, `read_app_schema`, `install_app`, `uninstall_app`, `enable_app`, the view operations `call_app_tool` and `read_app_resource`, refusal codes `app-*`, the tool prefix `app__<id>__<tool>`, the capabilities `apps` and `app:<id>` (also the caller of an app's own calls), the setting keys `apps.installed` and `apps.enabled`, the thread binding `app`, the skill `apps`, and inside Tagma's data directory `apps/<id>/` and `app-data/<id>/`. The process environment is `TAGMA_APP_DATA` and `TAGMA_APP_REVISION`.

**A source with the old manifest name.** An installed source whose manifest is still `plugin.json` (a project's `.tagma-apps/<id>/`, or a source left under `.plugins/`) is read like any directory without `tagma-app.json`: its row is refused, naming the missing file, and its process does not start. Nothing reads `plugin.json` as an app, because from step 2 that path is a classic plugin's manifest. Tagma renames only what lies in its own data directory; a project's apps belong to its repository and are renamed there.

**What carries over.**
- Stored installs, enablings, data and secrets move to the new names on the first start of the build that carries it, so nobody reinstalls.
- Recorded tool calls of apps keep rendering as their app's view: a journal-shape step in the apps module (rule a4d62ee7) renames recorded `plugin__<id>__<tool>` names to the new prefix when a thread is opened.
- Renamed operation ids break their old inputs, and the commit marks the break (rule e33e6bd4).

## Step 2: read the classic format

**Formats and detection.** A directory is read by the first rule that matches:
1. `.claude-plugin/plugin.json`: the Claude Code format.
2. A root `plugin.json` whose `$schema` is an Agent Plugins schema identifier; any version other than 1.0.0 is refused naming the version, so a newer package is not misread as a Claude Code layout.
3. The Claude Code default layout without a manifest (`skills/`, `agents/`, `commands/`, `hooks/hooks.json`, `.mcp.json`), named after its directory.

A package carrying both manifests is read as Claude Code, the richer of the two, so its agents are not lost. For Agent Plugins, unknown top-level fields are reported and ignored, and any other violation rejects the plugin, as that standard says; an invalid `mcp.json` or server entry is skipped with its reason (a stdio `command` must be one bare name or a `./` path).

Each format is an adapter module (`claude-code-format`, `agent-plugins-format`) that turns a directory into one plugin description: name, version, and components with their files. Composition gives the core the adapters in that order; the core names no format.

**Names.**
- Every component is named `<plugin>-<name>`: skills, MCP servers and agents alike. `-` is valid in all three grammars, while `:` would force quoting in the composer's `$` and `.` is refused in MCP server names (`MCP_SERVER_NAME_PATTERN`).
- A `.` in a plugin name becomes `-`.
- Two components whose names collide after this are refused with both names.

**Components.**
- **Skills.** A new skill scope `plugin` beside `global`, `project` and `built-in` (`native-harness/contract/wire/sourceSettings.ts`), fed to the same discovery (`agent-sources` `SkillDirectories`). A plugin skill shows its plugin on the skills screen and is disabled by name like any other. Plugin skills are read before the operator's and the project's, so a global or project skill of the same name wins and the plugin skill is listed as replaced.
- **MCP servers.**
  - **Port.** `mcp` gains a port for contributed declarations, and the plugins module fills it. `mcp` knows no plugin, and plugin declarations are not a settings layer.
  - **Shadowing.** A user or project declaration of the same name shadows a contributed one.
  - **Disabling.** A contributed server is not editable: `remove_mcp_server` refuses it. Disabling one is a project setting keyed by its name (`mcp.contributionsOff`), which `enable_mcp_server` with scope `contributed` writes.
  - **Expansion.** A contributed declaration expands only its own format's variables, and never from the server environment:
    - Agent Plugins: `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` in args, env and cwd, never in the URL or headers;
    - Claude Code: `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${CLAUDE_PROJECT_DIR}` (the pool is per project) and `${user_config.KEY}`.

    Any other `${…}` stays literal, so a plugin cannot pull a value of Tagma's environment into a header it sends away.
  - **Transport.** `streamable-http` maps to `http`. `sse` is refused with a reason, as are Claude Code's `ws` servers, `.mcpb` bundles and a `headersHelper`.
  - **Classification.** A server is classified as mutating with every permission kind (`McpCapabilities`), so its tools ask in review mode.
  - **Consent.** Install and enable raise what `add_mcp_server` raises for the same server: the `execute` and `network` subjects, and `mcp-env-resolving`.
  - **Sign-in.** Remote servers sign in through the MCP layer.
- **User configuration.** Claude Code `userConfig` values marked `sensitive` live in the key store under the plugin owner. The others live in a setting of the plugin. Both are asked for on the plugin's page.
- **Agents.** `agents/*.md` become agent definitions `<plugin>-<agent>`. The Claude Code adapter owns one table from that format's tool names to Tagma's (for example `Read` → `read`, `Bash` → `bash`). A tool with no equivalent is dropped and listed on the plugin page. The mapped tools are the agent's whitelist. Like a project file, a plugin agent is offered to the operator alone until `agent.offered` opens it to agents, and its thread is born in the usual mode.
- **Commands.** `commands/*.md` are read as skills of the plugin, named `<plugin>-<command>`, in the same `plugin` scope and the same `$` catalog. Claude Code already treats a command and a skill as one thing, and Codex has deprecated its own prompts in favour of skills. Tagma's `/` stays for Tagma's own acts, each of which runs Tagma's code; a plugin brings prompt text, not such an act. `$ARGUMENTS` in a command takes the text of the message that invokes it, without its `$<name>` reference.
- **Hooks.** The `command` handlers of `hooks/hooks.json` run as the operator on the events Tagma's agent has:
  - `PreToolUse` at tool admission (`beforeTool`) and `PostToolUse` after execution (`afterTool`);
  - `UserPromptSubmit` before the step a message opens (`beforeStep`);
  - `Stop` at `beforeClose`;
  - `SessionStart` at a thread's first run and `SessionEnd` at its end.

  Input and output follow the Claude Code hook contract: JSON on stdin, exit code 2 blocks, `permissionDecision`, `additionalContext`. Whether `beforeTool` can carry a deny and an input rewrite is verified first; where it cannot, that point gains it, not a wrapper around it. Other events and the `http`, `mcp_tool`, `prompt` and `agent` handler types are listed as ignored. Install and enable raise the `execute` subject for a plugin with hooks, as for a stdio server.
- **Everything else.** LSP, output styles, themes, monitors, `bin/`, `settings.json` and workflows are listed as ignored.

**Installation.**
- From a folder, read in place; a relative folder is read from the project root.
- From a git URL, cloned (`--depth 1`, as the operator) into `plugins/<id>/` of the data directory. The clone is made before consent, in a staging directory, so the consent names what the plugin runs; installing the same URL again replaces the clone.
- Its persistent data directory is `plugin-data/<id>/`, the `PLUGIN_DATA` and `CLAUDE_PLUGIN_DATA` of its processes.
- The operations reuse the ids step 1 frees: `install_plugin`, `enable_plugin`, `uninstall_plugin`, `read_plugins`. Their new inputs are a break the commit marks.
- `uninstall_plugin` keeps the plugin's data, as apps do today, drops its secret options and removes the clone of a git URL.
- A plugin's reading is cached by the modification times of its manifest and component locations, so a folder edited in place is read again on its next use.
- Plugin marketplaces are not part of this spec.

## Owners touched

- **Step 1:** `plugins`, `views`, the apps owner kind of `secrets`, `app-plugins`, `native-harness` app agents, the settings keys, the skill, the graph.
- **Step 2:**
  - a new `plugins` (server) and `app-plugins` (client), freed by step 1;
  - `native-harness`: skill sources and declared agents;
  - `mcp`: the contributed-declarations port;
  - `secrets`: the plugin owner kind.

## Acceptance

- **Step 1.**
  - `rg -il plugin` over the renamed modules' directories, the apps skill and the apps' own code answers nothing. The exclusions are named in the task: third-party plugin words (Vite, remark, Claude) and the step-2 module.
  - The operation catalog (`tagma op`) and the setting ids carry no `plugin` for an app.
  - A data directory prepared with the old names opens with its apps installed, enabled, and holding their secrets and data.
  - A thread recorded with an app tool call shows the app's view.
- **Step 2.** Fixture plugins are installed from a folder and from a git URL and enabled in a project. Three fixtures are used: one per format, plus one carrying both manifests.
  - Each fixture's skill is offered as `<plugin>-<skill>`.
  - Its stdio MCP server's tool reaches the agent and asks in review mode.
  - Its agent definition starts.
  - Its command is offered in the `$` catalog, and its `PreToolUse` hook blocks a test tool call.
  - Its ignored components are listed by `read_plugins`.
- **Rejections.**
  - A malformed Agent Plugins manifest is rejected with a reason naming the field.
  - A plugin header holding `${HOME}` sends it literally.
  - Colliding component names are refused.
- **Disabling.** Disabling the plugin in the project withdraws its skills, servers and agents.
