---
id: 01a12320-6e01-7be0-8d8d-0d2d464327ae
title: App installation is a machine setting, enabling is per-project, and both are written only by app operations
ord: 3
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12306-efba-7a0e-94d7-05ecc0602266
---
Installation is a user setting `apps.installed` (`{id, source, enabled}`), enabling is per-project `apps.enabled`; both are written only by app operations (`managed`). So an installation record survives its project being deleted, and enablings leave with their settings, with no table of their own needed for that.

`source` is the directory the app runs from. One id on both floors or installed from another directory is a refusal with both paths, not a silent swap. Deleting an app removes its enabling in every project, otherwise a reinstall would silently return it there; the `<data>/app-data/<id>/` data is untouched. Installing, deleting, and enabling one app run under its lock: otherwise parallel install and uninstall would leave a working process with no installation record.
