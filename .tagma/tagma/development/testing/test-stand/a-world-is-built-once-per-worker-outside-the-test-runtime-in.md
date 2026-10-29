---
id: 01a16c03-89ef-7846-941b-d63682279b2b
title: A world is built once per worker outside the test runtime, in its own hook, and the guard holds its processes by the world's pool, build and home
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/testbed/src/worlds.ts
---
A world is built once per worker outside the test runtime, in its own hook, and its processes are held by the guard on the world's pool, build and home.

The worlds registry is the `worlds.ts` module state, so its lifetime is the runner's module registry: under `--no-isolate` one per worker shared by all its files, under `--isolate` a new one per file, and the world is rebuilt. The world key is the tag name of its kind and canonical JSON of parameters. Preparation not reducible to data (functions, layers) cannot go into the key: such a call gets its own world (`own`) with a cause in the report, not a world shared by function identity.

- **Build outside the test runtime.** A shared world is built through `Effect.runFork` on the registry edge. Built in the runtime of the group that first asked for it, it would grab that group's TestClock and services, and its hook's timeout would interrupt the build for every worker file after.
- **Own hook with a hang guard.** `world()` registers a `beforeAll` in the file with the stand's hang guard (3 minutes), not with a build timeout: a build slow under load is no failure, and the failure never depends on the file's order in the worker. So `world()` is called where the test file registers. An own world from `world(..., { own })` gets the same hook. It is built outside the test runtime in its own scope; the layer takes the ready world and closes that scope on its release. Before, an own world was built inside the layer's hook and under load missed its 10 s. A shared module helper takes the world through `shared`: at its module level the hook would stand in the file that first imported the helper, even when that file never takes a world.
- **World processes.** The world holds what the guard must not judge as the file's leftover at the end:
  - everything the build spawned (the `holding` window);
  - SQLite pool children in keep mode — through the pool's `adopt`;
  - any process whose command line names the world's home (`claim`). So the guard takes onto holding the execution hosts and the watcher the runtime raises on demand inside tests; such a process the guard takes onto holding in the file's verdict.

  The held is removed by the reaper on worker exit. Shared-world scope finalizers never run.

- **World home** is `<BASE>/<pid>.w<n>`; the number counts per process, not per module instance, and a busy home is skipped: under `--isolate` each file builds the world anew, and the module's shared counter would hand it a home of a past build with its leftovers. The short path keeps the watcher sockets inside the `sun_path` limit: a long watcher would replace it with a hash in the temporary directory, and its command line would stop naming the home. A directory with such a name is removed by the next run's `sweep` when the worker is dead, and processes with cwd inside it removed.
