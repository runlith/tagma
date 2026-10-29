---
id: 01a1477d-318c-7341-a827-fdfec0209ee3
title: Deleting a release copy unregisters it from LaunchServices; accumulated dead records are cleaned
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14733-5f42-79a9-a127-c52a98184a8e",
    "status": "done"
  }
---
LaunchServices registers every copy of `install/<v>/desktop/*.app` that was run, and its nested helpers, as separate records. `pruneReleases` deletes the release directory, and the records stay dead. On the operator's machine on 2026-10-17: `com.runlith.tagma.dev` has 4 live copies and 30 dead records; Tagma has 74. `lsregister -u` removes the record even for a nonexistent path, but nested `.app` entries only each separately.

To do:
- the installation module's `Applications` port gets `forget(dir)`: the macOS adapter unregisters every `.app` under the directory;
- `pruneReleases` calls it under the directory's exclusive lock, before deletion, in both places: release installation (`release-channel/install.ts`) and checkout build (`installation/cut/release.ts`, through `Composition`);
- remove the dead records of our ids on this machine once.

Done when after a prune the LaunchServices dump holds no records of the deleted directory, and `path to application id` points at `current`.
