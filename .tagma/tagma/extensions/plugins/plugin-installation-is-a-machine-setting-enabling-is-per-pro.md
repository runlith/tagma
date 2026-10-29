---
id: 01a12320-6e01-7be0-8d8d-0d2d464327ae
title: Plugin installation is a machine setting, enabling is per-project, and both write only plugin operations
ord: 3
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12306-efba-7a0e-94d7-05ecc0602266
sources:
  - kind: file
    ref: apps/tagma/server/src/plugins/contract/wire/settings.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/installs.ts
---
Installation is a user setting `plugins.installed` (`{id, source, enabled}`), enabling is per-project `plugins.enabled`; both are written only by plugin operations (`managed`). So an installation record survives its project being deleted, and enablings leave with their settings, with no table of their own needed for that.

`source` is the directory the plugin runs from. One id on both floors or installed from another directory is a refusal with both paths, not a silent swap. Deleting a plugin removes its enabling in every project, otherwise a reinstall would silently return it there; the `~/.tagma/plugin-data/<id>/` data is untouched. Installing, deleting, and enabling one plugin run under its lock: otherwise parallel install and uninstall would leave a working process with no installation record.
