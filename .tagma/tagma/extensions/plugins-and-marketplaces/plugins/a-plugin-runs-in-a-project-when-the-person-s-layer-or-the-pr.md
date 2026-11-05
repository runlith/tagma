---
id: 01a189de-7f93-7650-97a5-c9b107c6506c
title: A plugin runs in a project when the person's layer or the project's own enables it and the project has not switched it off
ord: 9
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/plugins/enabling.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/installs.ts
---
A plugin runs in a project when the person's own layer of `plugins.enabled` or the project's layer names it and the project's `plugins.disabled` does not. The switch-off is a list of its own because the layer's `declined` flag would drop the person's whole layer — every plugin enabled for all projects — where the person turned off one.

A project's switch-off is written only while the plugin is enabled for every project; switching a plugin off in a project where only its own layer named it just drops it there, so enabling it for every project later reaches that project. Switching it on in a project writes the project's own layer and lifts the switch-off, so the project keeps running it when the every-project enabling is dropped; switching it on for every project also lifts the calling project's switch-off and leaves the others'. Collisions are checked in each project that will start running it, and an install checks every project that will run the new version. Uninstalling clears the person's layer and every project's two lists.
