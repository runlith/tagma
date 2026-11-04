import { expect } from 'bun:test';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { Effect, FileSystem, PlatformError } from 'effect';
import * as BunServices from '@effect/platform-bun/BunServices';
import { cachedArtifact, HOST_ENTRY, type BuildInput } from '../../buildArtifact';
import { HOLDER_BINARY, HOLDER_LIBRARY } from '../../posix/testing/holder';
import { nativeWorkers } from '../artifact';
import { dirname } from 'node:path';

it.live('reuses a bundle after a test report changes, invalidates build inputs and leaves unaccounted inputs uncached', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const directory = yield* files.makeTempDirectoryScoped({ prefix: 'artifact-cache-' });
    const source = join(directory, 'packages/execution-host');
    const config = join(source, 'config/paths.json');
    const report = join(source, '.bun-test-timings.json');
    const write = (relative: string, text: string) => files.writeFileString(join(source, relative), text);
    yield* files.makeDirectory(join(source, 'src/posix'), { recursive: true });
    yield* files.makeDirectory(join(source, 'config'));
    yield* files.makeDirectory(join(source, 'drizzle'));
    yield* files.makeDirectory(join(directory, 'packages/performance/src/store'), { recursive: true });
    yield* files.writeFileString(join(directory, 'package.json'), JSON.stringify({ workspaces: { packages: ['packages/*'] } }));
    yield* write('package.json', '{ "name": "cache-conformance" }');
    yield* write('jsconfig.json', '{ "extends": "./config/compiler.json" }');
    yield* write('config/compiler.json', '// inherited configuration\n{ "extends": "./paths.json", }');
    yield* files.writeFileString(config, '{ "compilerOptions": { "baseUrl": "..", "paths": { "picked": ["src/a.ts"] } } }');
    yield* write('src/main.ts', 'import { value } from "picked"; console.log(value);');
    yield* write('src/a.ts', 'export const value = "config-a";');
    yield* write('src/b.ts', 'export const value = "config-b";');
    yield* write('src/recovery.ts', 'console.log("recovery");');
    for (const entry of nativeWorkers) {
      yield* files.makeDirectory(join(source, dirname(entry)), { recursive: true });
      yield* write(entry, 'export {};');
    }
    yield* write('src/posix/terminals.worker.ts', 'export {};');
    yield* files.writeFileString(join(directory, 'packages/performance/src/store/worker.ts'), 'export {};');
    yield* write('drizzle/001.sql', 'select 1;');
    yield* files.writeFileString(report, '{ "elapsed": 1 }');
    const input: BuildInput = {
      root: join(directory, 'first'),
      source,
      library: HOLDER_LIBRARY,
      holder: HOLDER_BINARY,
      build: 'first',
      bundling: { comments: 'none', minify: true },
    };
    const first = yield* cachedArtifact(input);
    expect(yield* files.readFileString(join(first.root, HOST_ENTRY))).toContain('config-a');
    const unavailableRuntime = FileSystem.FileSystem.of({
      ...files,
      copyFile: (from, to) =>
        from === process.execPath
          ? Effect.fail(
              PlatformError.systemError({ _tag: 'PermissionDenied', module: 'FileSystem', method: 'copyFile', pathOrDescriptor: from }),
            )
          : files.copyFile(from, to),
    });
    yield* files.writeFileString(report, '{ "elapsed": 2 }');
    const next = yield* cachedArtifact({ ...input, root: join(directory, 'next'), build: 'next' }).pipe(
      Effect.provideService(FileSystem.FileSystem, unavailableRuntime),
    );
    expect(next.manifest.identity.digest).toBe(first.manifest.identity.digest);
    const changed = (root: string) =>
      cachedArtifact({ ...input, root: join(directory, root) }).pipe(
        Effect.provideService(FileSystem.FileSystem, unavailableRuntime),
        Effect.flip,
      );
    yield* files.writeFileString(config, '{ "compilerOptions": { "baseUrl": "..", "paths": { "picked": ["src/b.ts"] } } }');
    expect(yield* changed('config-changed')).toMatchObject({ _tag: 'BuildRefused', part: 'bun' });
    yield* files.writeFileString(config, '{ "compilerOptions": { "baseUrl": "..", "paths": { "picked": ["src/a.ts"] } } }');
    yield* write('src/a.ts', 'export const value = "source-changed";');
    expect(yield* changed('source-changed')).toMatchObject({ _tag: 'BuildRefused', part: 'bun' });
    yield* write('src/main.ts', 'import data from "../data.json"; console.log(data.value);');
    yield* write('data.json', '{ "value": "outside-source" }');
    const outside = yield* cachedArtifact({ ...input, root: join(directory, 'outside') });
    expect(yield* files.readFileString(join(outside.root, HOST_ENTRY))).toContain('outside-source');
    expect(yield* changed('outside-again')).toMatchObject({ _tag: 'BuildRefused', part: 'bun' });
  }).pipe(Effect.provide(BunServices.layer)),
);
