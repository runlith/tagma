import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Deferred, Effect, Fiber, FileSystem } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { join } from 'node:path';
import { type NativeBuild, nativeBuilt } from './nativeBuild';
import { pidStanding } from '../posix/testing/processes';

it.live(
  'interrupting a native build waits for its compiler process to leave',
  Effect.fnUntraced(function* () {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: 'native-build-cancel-' });
    const crate = join(root, 'crate');
    const tools = join(root, 'tools');
    yield* fs.makeDirectory(crate);
    yield* fs.makeDirectory(tools);
    yield* fs.writeFileString(join(tools, 'cargo'), '#!/bin/sh\nexec /bin/sleep 60\n', { mode: 0o755 });
    const spawned = yield* Deferred.make<ChildProcessSpawner.ChildProcessHandle>();
    const observed = ChildProcessSpawner.make((command) =>
      spawner.spawn(command).pipe(Effect.tap((child) => Deferred.succeed(spawned, child))),
    );
    const build = yield* Effect.forkScoped(
      nativeBuilt({
        crate,
        target: join(crate, 'target'),
        packages: ['x'],
        outputs: [join(crate, 'target/release/lib')],
        flags: [],
        home: root,
        env: { PATH: `${tools}:/bin:/usr/bin` },
      }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, observed)),
    );
    const child = yield* Deferred.await(spawned);
    expect(yield* pidStanding(child.pid)).toBe('standing');
    yield* Fiber.interrupt(build);
    expect(yield* pidStanding(child.pid)).toBe('gone');
  }, Effect.provide(BunServices.layer)),
);

it.live(
  'rebuilds changed native inputs or outputs and reuses a fresh copied release without a toolchain',
  Effect.fnUntraced(function* () {
    const fs = yield* FileSystem.FileSystem;
    const scratch = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'native-build-' }));
    const crate = join(scratch, 'crate');
    const target = join(crate, 'target');
    const tools = join(scratch, 'tools');
    yield* fs.makeDirectory(join(crate, 'src'), { recursive: true });
    yield* fs.makeDirectory(tools);
    yield* fs.writeFileString(join(scratch, 'Cargo.toml'), '[workspace]\nmembers = ["crate"]\n');
    yield* fs.writeFileString(join(scratch, 'Cargo.lock'), 'version = 4\n');
    yield* fs.writeFileString(join(crate, 'Cargo.toml'), '[package]\nname = "x"\n');
    yield* fs.writeFileString(join(crate, 'src/lib.rs'), 'pub fn one() {}\n');
    yield* fs.writeFileString(
      join(tools, 'cargo'),
      `#!/bin/sh\nmkdir -p "${target}/release" && printf 'built\\n' > "${target}/release/lib" && cp "${target}/release/lib" "${target}/release/holder"\n`,
      { mode: 0o755 },
    );
    const build = (path: string): NativeBuild => ({
      crate,
      target,
      packages: ['x'],
      outputs: [join(target, 'release/lib'), join(target, 'release/holder')],
      flags: ['-Cdebuginfo=1'],
      home: '/home',
      env: { PATH: `${path}:/bin:/usr/bin` },
    });
    expect((yield* Effect.all([nativeBuilt(build(tools)), nativeBuilt(build(tools))], { concurrency: 2 })).sort()).toEqual([false, true]);
    expect(yield* fs.readFileString(join(target, 'release/lib'))).toBe('built\n');
    expect(yield* nativeBuilt(build(join(scratch, 'nothing')))).toBe(false);
    expect(yield* nativeBuilt(build(tools))).toBe(false);
    yield* fs.writeFileString(join(scratch, 'Cargo.lock'), 'version = 4\n[[package]]\nname = "dep"\nversion = "2.0.0"\n');
    expect(yield* nativeBuilt(build(tools))).toBe(true);
    yield* fs.writeFileString(join(scratch, 'Cargo.toml'), '[workspace]\nmembers = ["crate", "copy"]\n');
    expect(yield* nativeBuilt(build(tools))).toBe(true);
    yield* fs.writeFileString(join(crate, 'src/lib.rs'), 'pub fn two() {}\n');
    expect(yield* nativeBuilt(build(tools))).toBe(true);
    expect(yield* nativeBuilt({ ...build(tools), flags: [] })).toBe(true);
    yield* fs.writeFileString(join(target, 'release/holder'), 'built by hand\n');
    expect(yield* nativeBuilt({ ...build(tools), flags: [] })).toBe(true);
    expect(yield* fs.readFileString(join(target, 'release/holder'))).toBe('built\n');
    const copy = join(scratch, 'copy');
    yield* fs.makeDirectory(copy);
    yield* fs.copy(join(crate, 'src'), join(copy, 'src'));
    yield* fs.copy(join(crate, 'Cargo.toml'), join(copy, 'Cargo.toml'));
    yield* fs.makeDirectory(join(copy, 'target'));
    yield* fs.symlink(join(target, 'release'), join(copy, 'target/release'));
    const moved: NativeBuild = {
      ...build(join(scratch, 'nothing')),
      crate: copy,
      target: join(copy, 'target'),
      outputs: [join(copy, 'target/release/lib'), join(copy, 'target/release/holder')],
      flags: [],
      home: join(scratch, 'confined-home'),
    };
    expect(yield* nativeBuilt(moved)).toBe(false);
  }, Effect.provide(BunServices.layer)),
);
