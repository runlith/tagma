import { HOST_COMMAND } from '@runlith/tagma/adapter/harness';
import type { Channel } from './channel.js';

const directoryOf = (path: string): string => {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '.' : cut === 0 ? '/' : path.slice(0, cut);
};

const under = (at: string, ...names: ReadonlyArray<string>): string => [at.endsWith('/') ? at.slice(0, -1) : at, ...names].join('/');

export const INSTALL_FILE = 'install.json';
export const RUNTIME_PART = 'bun';
export const CLI_ENTRY = 'bin/cli/main.js';

export const SERVE_FLAGS: readonly string[] = ['--no-install'];

export const ADAPTERS = 'adapters';

export const RIPGREP_PART = 'tools/rg';

export const TYPESCRIPT_PART = 'tools/typescript';
export const TYPESCRIPT_COMPILER = 'tools/typescript/tsc';

export const WHISPER_ENGINE_PART = 'tools/whisper-engine';
export const SILERO_PART = 'tools/silero.bin';
export const WHISPER_ABSENCE_PART = 'tools/whisper-engine.absent';
export const SPEECH_MODELS = 'speech-models';
export const AUDIO_HELPER = 'Tagma Audio';

export const CURRENT = 'current';
export const ATTEMPT_FILE = 'attempt.json';
export const RETURN_FILE = 'returned.json';
export const INSTALL_LOCK = 'install.lock';

export const WORLD = 'world';
export const WORLD_COMMAND = HOST_COMMAND;

export const BUILD_COMMAND = 'bun run tagma:build';
export const BUILD_SWAPPED_ENV = 'TAGMA_BUILD_SWAPPED';
export const BUILD_HOME_ENV = 'TAGMA_BUILD_HOME';
export const SIGNING_IDENTITY_ENV = 'TAGMA_SIGNING_IDENTITY';
export const BUILD_CONDITIONS_ENV = 'TAGMA_BUILD_CONDITIONS';
export const BUILD_MAPS_ENV = 'TAGMA_BUILD_MAPS';
export const BUILD_INPUTS_ENV = 'TAGMA_BUILD_INPUTS';
export const RELEASE_NUMBER_ENV = 'TAGMA_RELEASE_NUMBER';
export const BUILD_TARGET_ENV = 'TAGMA_BUILD_TARGET';

export const buildConditionsIn = (env: NodeJS.ProcessEnv): readonly string[] =>
  (env[BUILD_CONDITIONS_ENV] ?? '')
    .split(',')
    .map((condition) => condition.trim())
    .filter((condition) => condition !== '');

export const DATABASE_FILE = 'tagma.sqlite';
export const TRANSFER_FILE = 'transfer.json';
export const INSTALLATIONS = 'install';
export const SERVE_LOG = 'serve.log';
export const DESKTOP_DATA = 'desktop';

export const dataDirectory = (channel: Channel, env: NodeJS.ProcessEnv): string | null => {
  const configured = env.TAGMA_DATABASE_PATH?.trim();
  if (configured) return directoryOf(configured);
  const home = env.HOME?.trim();
  return home ? under(home, channel.data) : null;
};

export const installationsRoot = (channel: Channel, env: NodeJS.ProcessEnv): string | null => {
  const configured = env.TAGMA_INSTALL_ROOT?.trim();
  if (configured) return configured;
  const home = env.HOME?.trim();
  return home ? under(home, channel.data, INSTALLATIONS) : null;
};

export const serveLogPath = (channel: Channel, env: NodeJS.ProcessEnv): string | null => {
  const at = dataDirectory(channel, env);
  return at === null ? null : under(at, SERVE_LOG);
};

export type Revision = { readonly head: string; readonly dirty: boolean };

export const revisionLabel = (revision: Revision | null): string =>
  revision === null ? 'no-commit' : `${revision.head}${revision.dirty ? '-dirty' : ''}`;

export const labelRevision = (build: string): Revision | null => {
  const label = build.split(' ')[0] ?? '';
  if (label === '' || label === 'no-commit') return null;
  const dirty = label.endsWith('-dirty');
  return { head: dirty ? label.slice(0, -'-dirty'.length) : label, dirty };
};
export const BUILD_ASKED_EVERY_MS = 2_000;

export const ASKED_EVERY_MS = 100;

export const SURFACE_INDEX = 'index.html';
export const HOST_MAIN = 'app/main.mjs';
export const hostBundle = (name: string): string => `${name}.app`;
export const hostBinary = (name: string): string => `${hostBundle(name)}/Contents/MacOS/Electron`;
export const RELEASE_INSIDE = 'Contents/Resources/release';
