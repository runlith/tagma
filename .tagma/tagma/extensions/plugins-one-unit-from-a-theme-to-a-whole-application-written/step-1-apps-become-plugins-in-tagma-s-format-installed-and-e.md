---
id: 01a1ad94-d32a-7b54-93f0-03990e3d3951
title: "Step 1: apps become plugins in Tagma's format, installed and enabled by the plugins module"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1ac4f-c0e3-7a05-b151-84b158ca12a4",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a1ad4a-a9f0-7e77-9b01-4d7dd2b5f488
---
Step 1 of [[d2b5f488]]: apps become plugins in Tagma's format, installed and enabled by `plugins`. Rule [[0528876d]] applies: nothing old is kept or read beside the new.

**Server**
- **A reader for Tagma's format.** `plugin-formats/tagma` is one more `PluginFormat`. It claims a directory that holds `tagma-plugin.json` and reads it into `PluginPackage`, which gains the parts only Tagma's format carries: `process` and `contributes`. Declared secrets become options marked sensitive, so the existing option and key-store mechanism carries them, and the plugin card shows them.
- **Install and enable.** `install_plugin`, `enable_plugin` and `uninstall_plugin` serve every format, with records in `plugins.installed`, `plugins.enabled` and `plugins.disabled`. A folder install is read in place, as it is now.
- **`tagma-apps` becomes `plugin-host`.** It supervises one process per machine for each installed plugin that has a process and is enabled in at least one project, and registers its contributions through the points as now. "Enabled in this project" is read from `EnabledPlugins`, not from `apps.enabled`.
- **Removed outright:**
  - the operations `install_app`, `enable_app`, `uninstall_app`, `read_apps` and `read_app_schema`;
  - the settings `apps.installed` and `apps.enabled`;
  - discovery of `.tagma-apps` and of the personal `apps/`;
  - the start step `tagma-apps/steps/data.ts`;
  - the `secrets` point and the `tagma-apps` secret owner.

  The three journal form steps that renamed plugins to apps (`toolNames`, `appBinding`, `appCapabilities`) go too: they run on every read and would turn the current names back into app names. Old thread records stay as written.
- **Names:** the caller `plugin:<id>`, tool names `plugin__<id>__<tool>`, `bindings.plugin`, the capabilities `plugins` and `plugin:<id>`, and `TagmaApp*` symbols renamed by role.
- **Text:** the `apps` skill and the Apps doctrine section become `plugins`, describing the hand-written `tagma-plugin.json` until the SDK of step 2 emits it.

**Client**
- The Plugins screen lists Tagma-format plugins with their process state.
- Settings → Apps → Secrets goes; secrets stand as options on the plugin card.
- `features/tagma-apps` keeps drawing views under plugin names.

**At merge into main:** remove the `TagmaApp` exception from the global rule eeaf88ec; the global graph has no branch, so it changes when this code reaches main (931cfbf1 already changed in this branch).

**Done when** a plugin directory holding `tagma-plugin.json` installs from its folder through `install_plugin` and is enabled in a project through `enable_plugin`. Its process then runs, its tools stand in an agent's catalog as `plugin__<id>__<tool>`, its view opens, and its secret is set on its card. None of the app operations, settings or directories remain.
