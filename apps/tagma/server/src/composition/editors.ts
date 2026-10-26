import { homedir } from 'node:os';
import { join } from 'node:path';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Layer } from 'effect';
import { EditorHost } from '../editors/contract/service/host.js';
import { makeMacEditors } from '../mac-editors/launchServices.js';
import { makePathEditors } from '../path-editors/which.js';

const host = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

const spawner = BunChildProcessSpawner.layer.pipe(Layer.provide(host));

const toolboxScripts = (): string =>
  process.platform === 'win32'
    ? join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'JetBrains', 'Toolbox', 'scripts')
    : join(homedir(), '.local', 'share', 'JetBrains', 'Toolbox', 'scripts');

const editorHost: Layer.Layer<EditorHost> =
  process.platform === 'darwin'
    ? Layer.effect(EditorHost, makeMacEditors).pipe(Layer.provide(Layer.merge(spawner, BunFileSystem.layer)))
    : Layer.succeed(
        EditorHost,
        makePathEditors({
          path: process.env['PATH'] ?? '',
          beside: [toolboxScripts()],
          opener: process.platform === 'win32' ? { program: 'explorer.exe', args: [] } : { program: 'xdg-open', args: [] },
        }),
      );

export const editorBindings = Layer.merge(editorHost, spawner);
