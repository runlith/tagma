import { Schema } from 'effect';
import { CHANNELS, type Channel } from './channel.js';
import { WORLD_COMMAND } from './layout.js';
import { processChainSchema } from './process.js';

export const ACTIVE_LOCK = 'active.lock';
export const ACTIVE_FILE = 'active.json';

export const ActiveServer = Schema.Struct({
  channel: Schema.String,
  cli: Schema.String,
  url: Schema.String,
  pid: Schema.Number,
  birth: Schema.optional(Schema.String),
  chain: Schema.optional(processChainSchema),
});
export type ActiveServer = typeof ActiveServer.Type;

export type ActiveHolder = ActiveServer | 'unnamed';

export const holderName = (holder: ActiveHolder): string =>
  holder === 'unnamed'
    ? 'another Tagma'
    : (Object.values(CHANNELS).find((channel) => channel.id === holder.channel)?.name ?? holder.channel);

export const channelActive = (holder: ActiveHolder, own: Channel): { readonly reason: string; readonly unblock: string[] } => {
  const name = holderName(holder);
  return {
    reason: `${name} runs on this Mac${holder === 'unnamed' ? '' : ` (pid ${holder.pid}, ${holder.url})`}, and one Tagma runs at a time`,
    unblock: [`${own.command} switch — ends ${name} the way quitting does and starts ${own.name}`],
  };
};

export const JUNCTION: readonly string[] = ['Library', 'Application Support', 'Tagma'];
export const ENTRY = 'bin/tagma';
export const INSTALLATION_MODE = 'TAGMA_INSTALLATION_MODE';

export const integratesProjects = (env: NodeJS.ProcessEnv): boolean => env[INSTALLATION_MODE] !== 'beside';

export const junctionDirectory = (env: NodeJS.ProcessEnv): string | null => {
  const home = env.HOME?.trim();
  return home ? [home.endsWith('/') ? home.slice(0, -1) : home, ...JUNCTION].join('/') : null;
};

export const entryPath = (env: NodeJS.ProcessEnv): string | null => {
  const junction = junctionDirectory(env);
  return junction === null ? null : `${junction}/${ENTRY}`;
};

export const entryCommand = (env: NodeJS.ProcessEnv): readonly string[] => {
  const entry = entryPath(env);
  return entry === null ? [WORLD_COMMAND] : [entry];
};

export const entryLine = (args: string): string => `t="$HOME/${[...JUNCTION, ENTRY].join('/')}"; [ -x "$t" ] || exit 0; exec "$t" ${args}`;

export const ENTERED = 'TAGMA_ENTERED';
export const NOT_RUNNING = 'Tagma is not running: open Tagma or Tagma Dev';

export const ENTRY_SCRIPT = `#!/bin/sh
active="$(dirname "$0")/../${ACTIVE_FILE}"
cli=$(sed -n 's/.*"cli":"\\([^"]*\\)".*/\\1/p' "$active" 2>/dev/null)
pid=$(sed -n 's/.*"pid":\\([0-9]*\\).*/\\1/p' "$active" 2>/dev/null)
if [ -n "$cli" ] && [ -x "$cli" ] && [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then ${ENTERED}=1; export ${ENTERED}; exec "$cli" "$@"; fi
if [ "$1" = hook ]; then exit 0; fi
echo "${NOT_RUNNING}" >&2
exit 1
`;
