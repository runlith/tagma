import type { ToolCatalog } from '@runlith/agent/catalog';
import type { Tool } from '@runlith/agent/tool';
import type { ToolFactoryOptions } from './workspace';
import { resolveToolOptions } from './workspace/runtime';
import type { World } from './world';
import { createBashTool } from './bash/tool';
import { createDeleteTool } from './delete';
import { createEditTool } from './edit';
import { createGlobTool } from './glob';
import { createGrepTool } from './grep';
import { createLsTool } from './ls';
import { createReadTool } from './read';
import { createRenameTool } from './rename';
import { createWebfetchTool } from './webfetch';
import { createWebsearchTool } from './websearch';
import { createWriteTool } from './write';

type FileTools = { read: Tool; write: Tool; edit: Tool; rename: Tool; ls: Tool };
type RemovalTools = { delete: Tool };
type ShellTools = { bash: Tool; glob: Tool; grep: Tool };
type WebTools = { webfetch: Tool; websearch: Tool };

export type ToolName = keyof (FileTools & RemovalTools & ShellTools & WebTools);

type Binds<W, K extends keyof World> = K extends keyof W ? (undefined extends W[K] ? false : true) : false;

type Present<T, B> = B extends true ? T : Partial<T>;

type BindsShell<W> = Binds<W, 'files'> extends true ? Binds<W, 'exec'> : false;

type BindsRemoval<W> = Binds<W, 'files'> extends true ? Binds<W, 'entries'> : false;

export type WorldTools<W extends World> = Present<FileTools, Binds<W, 'files'>> &
  Present<RemovalTools, BindsRemoval<W>> &
  Present<ShellTools, BindsShell<W>> &
  Present<WebTools, Binds<W, 'egress'>>;

export function createTools<W extends World>(options: ToolFactoryOptions & { world: W }): WorldTools<W>;
export function createTools(options: ToolFactoryOptions): ToolCatalog {
  const { world } = resolveToolOptions(options);
  const files = world.files !== undefined;
  const exec = world.exec !== undefined;
  const egress = world.egress;
  return {
    ...(files
      ? {
          read: createReadTool(options),
          write: createWriteTool(options),
          edit: createEditTool(options),
          rename: createRenameTool(options),
          ls: createLsTool(options),
        }
      : {}),
    ...(files && world.entries !== undefined ? { delete: createDeleteTool(options) } : {}),
    ...(files && exec ? { bash: createBashTool(options), glob: createGlobTool(options), grep: createGrepTool(options) } : {}),
    ...(egress === undefined
      ? {}
      : {
          webfetch: createWebfetchTool({ egress }),
          websearch: createWebsearchTool({ egress, websearch: options.websearch }),
        }),
  };
}
