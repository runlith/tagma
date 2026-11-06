export type PluginEnvelope = {
  /** A plugin in Tagma’s format: lowercase letters, digits and inner hyphens, so it names a site and its agents. */
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly description?: string;
  readonly process?: {
    /** The bundled module Tagma runs on its own runtime, from the plugin directory as the operator. */
    readonly entry: string;
    /** Kept running while the plugin is enabled, rather than started on demand and stopped when idle. */
    readonly resident?: boolean;
  };
  /** The provider part, as the build described it without running it: model providers, CLI agents and speech providers that join the catalogs of the whole machine. */
  readonly providers?: {
    /** The bundled providers module Tagma imports into its own process, its host modules served by the server’s copies. */
    readonly entry: string;
    /** It brings model providers: wire providers, CLI agents or a settings form for them. */
    readonly models: boolean;
    /** Among its model providers, a CLI agent Tagma runs. */
    readonly harnesses: boolean;
    /** It brings speech providers. */
    readonly speech: boolean;
  };
  readonly options?: readonly ({
    /** The option, named as the environment variable its process reads it from: capital letters, digits and underscores, not starting with TAGMA_ and not PATH, HOME, USER, LOGNAME, SHELL, TERM or TMPDIR. */
    readonly key: string;
    readonly title: string;
    readonly description: string;
    readonly type?: 'string' | 'number' | 'boolean' | 'directory' | 'file';
    /** A secret: kept in the key store, masked in what the process answers. */
    readonly sensitive?: boolean;
    readonly required?: boolean;
    readonly default?: string;
  })[];
  /** The MCP servers the plugin brings: they join the MCP server list of every project running it, and its process and views call them with `servers.<name>.call`. */
  readonly mcpServers?: {
    readonly [key: string]: {
      readonly type: 'stdio';
      /** One executable name looked up on PATH, or a ./ path to a file inside the plugin. */
      readonly command: string;
      readonly args?: readonly string[];
      readonly env?: {
        readonly [key: string]: string;
      };
      /** Rooted at ./, ${PLUGIN_ROOT} or ${PLUGIN_DATA}; the plugin directory when omitted. */
      readonly cwd?: string;
    } | {
      readonly type: 'streamable-http';
      /** An https URL, or http to loopback only. */
      readonly url: string;
      readonly headers?: {
        readonly [key: string]: string;
      };
    };
  };
  readonly build: {
    /** SHA-256 over each source as its path, a NUL, its byte length, a NUL and its bytes, in the order listed. */
    readonly hash: string;
    /** Every file the build read outside node_modules. */
    readonly sources: readonly string[];
  };
  /** Contributions by point; every point is declared by the owner that registers it. */
  readonly contributes?: {
    readonly [key: string]: unknown;
  };
};

export type PluginPoints = {
  readonly actions: readonly {
    /** The action, named within its plugin: lowercase letters, digits and inner hyphens. */
    readonly id: string;
    /** What the palette and the shortcuts screen call the action. */
    readonly title: string;
    /** The tool of the plugin’s process that runs the action, named in contributes.tools with audience tagma. */
    readonly tool: string;
  }[];
  readonly agents: readonly {
    /** The agent inside the plugin; Tagma offers it as <plugin>.<id>. */
    readonly id: string;
    /** Its definition, a Markdown file with frontmatter, relative to the plugin directory. It names its capabilities; plugin:<plugin> is added to them. */
    readonly path: string;
  }[];
  readonly beforeBuild: readonly {
    /** The tool, named in contributes.tools with audience tagma, that Tagma calls before a build from this checkout. */
    readonly tool: string;
    /** What the update card shows while the step runs. */
    readonly title: string;
  }[];
  readonly commands: readonly ({
    /** What the person types after / in a thread’s composer, named within its plugin: lowercase letters, digits and inner hyphens. */
    readonly name: string;
    /** What the composer’s list of commands says it does. */
    readonly description: string;
    /** The text the command puts into the draft. Where it holds $ARGUMENTS, the composer asks for the words after the command and puts them there. */
    readonly text: string;
  } | {
    readonly name: string;
    readonly description: string;
    /** An id of contributes.actions. The composer runs it with the thread and the words typed after the command, and its answer fills the draft. */
    readonly action: string;
  })[];
  readonly composer: readonly {
    /** The view drawn above a thread’s composer in every thread of a project where the plugin runs, one of contributes.views; it receives { thread, draft, send }. */
    readonly view: string;
  }[];
  readonly hooks: readonly ({
    /** When Tagma’s agent asks the hook. beforeTool: before a tool call runs; the hook may deny it, rewrite its input or add context. afterTool: after it ran; the hook may add context. beforeStep: when a message reaches the agent; the hook may block it or add context. beforeClose: before the agent ends its turn; a block keeps it working with the reason as its next instruction. threadStarted: on the first step of a new thread; the hook may add context. threadEnded: when the thread is archived or deleted. */
    readonly at: 'beforeTool' | 'afterTool' | 'beforeStep' | 'beforeClose' | 'threadStarted' | 'threadEnded';
    /** Which calls reach the hook: names of the tools Tagma’s agent calls, its MCP and plugin tools included, separated by |, or a regular expression over the name; startup or resume for threadStarted; archive or delete for threadEnded. Absent: every one. Claude Code’s and Codex’s own tools never reach it. */
    readonly match?: string;
    /** The tool, named in contributes.tools with audience tagma, that Tagma calls with { at, threadId, cwd } and what the point carries, and that answers the verdict its point takes as structured content. The call wakes a sleeping process. */
    readonly tool: string;
    /** block: a hook that fails, answers an error or times out denies the tool call, or blocks the message, instead of letting it through. Absent: the agent goes on as if the hook had not been asked. */
    readonly onFailure?: 'block';
    /** How long Tagma waits for the answer, in milliseconds, a process start included; 10000 when absent. Past it the hook has failed. */
    readonly timeoutMs?: number;
  })[];
  readonly launchers: readonly {
    /** The view it opens in a window, one of contributes.views. The plugin needs no process for it. */
    readonly view: string;
    /** The words of the palette action and the rail button that open the view. */
    readonly title: string;
  }[];
  readonly notify: {
    readonly tool: string;
  };
  readonly on: {
    /** The tool, named in contributes.tools with audience tagma, that Tagma calls when a turn of a thread whose bindings name this plugin under `plugin` ends, with { threadId, runId, status, failureReason }. Its answer confirms the delivery; an error or no answer delivers it again, so it is idempotent by runId. */
    readonly ended?: string;
    /** The tool, named in contributes.tools with audience tagma, that takes the questions of threads bound to this plugin while it runs in their project, with { threadId, questionId, summary, prompts, deadlineAt }; prompts is null for a confirmation. Such a question leaves the person’s attention; the plugin answers it with answer_question. An error, no answer, or the answer { "question": "left" } hands it to the person for good. While the plugin is switched off or its process has failed, its questions stand with the person, and they arrive again once it runs, and after a server restart, so it is idempotent by questionId. */
    readonly asked?: string;
  };
  readonly panes: readonly {
    /** The view the section or pane shows, one of contributes.views. */
    readonly view: string;
    /** What the navigation, the palette and the pane header call it. */
    readonly title: string;
    /** An image file by its path from the plugin’s root, as dist/ui/ ships it, e.g. ui/icon.svg. Absent: a neutral plugin glyph. */
    readonly icon?: string;
  }[];
  readonly pins: readonly {
    /** A view of the plugin, one of contributes.views, that a thread may pin above its feed. */
    readonly view: string;
  }[];
  readonly results: readonly {
    /** A tool of the plugin’s process, named in contributes.tools for agents or own. */
    readonly tool: string;
    /** The view its call shows in the feed, one of contributes.views. */
    readonly view: string;
  }[];
  readonly schedule: readonly {
    /** The owner-chosen name of this schedule, unique within its owner. */
    readonly name: string;
    /** Milliseconds between runs, at least 1000. */
    readonly everyMs: number;
    readonly tool: string;
  }[];
  readonly shortcuts: readonly {
    /** The chord this plugin proposes, like Mod+Alt+G. */
    readonly keys: string;
    /** What the chord runs: an id of contributes.actions, section:<view> for a section of contributes.surfaces, or pane:<view> for a pane of contributes.panes. */
    readonly action: string;
    /** true asks for the chord to work in every app. It is a request: the person allows it on the plugin’s card, and until then the chord works inside Tagma. */
    readonly global?: boolean;
  }[];
  readonly surfaces: readonly {
    /** The view the section or pane shows, one of contributes.views. */
    readonly view: string;
    /** What the navigation, the palette and the pane header call it. */
    readonly title: string;
    /** An image file by its path from the plugin’s root, as dist/ui/ ships it, e.g. ui/icon.svg. Absent: a neutral plugin glyph. */
    readonly icon?: string;
  }[];
  readonly themes: {
    readonly [key: string]: {
      /** What the theme picker calls it. */
      readonly title: string;
      /** What the theme changes in one look; every key it leaves out keeps Tagma’s value. */
      readonly light?: {
        readonly surfaces?: {
          /** The window frame: the rail, the top bar and the status bar. */
          readonly chrome?: string;
          /** The feed and page ground. */
          readonly background?: string;
          /** Inputs and the composer. */
          readonly field?: string;
          /** Cards and panels standing above the ground. */
          readonly raised?: string;
          /** Menus, popups and the palette. */
          readonly popover?: string;
          /** Code blocks and wells below the ground. */
          readonly sunken?: string;
          /** Quiet fills such as a skeleton or a track. */
          readonly muted?: string;
          /** A highlighted fill such as a pressed control. */
          readonly accent?: string;
        };
        readonly text?: {
          /** Body text. */
          readonly foreground?: string;
          /** Secondary text: hints, stamps and meta. */
          readonly muted?: string;
          /** The primary action’s fill and strong text. */
          readonly primary?: string;
        };
        readonly signals?: {
          /** Red: a failure, a refusal, a lie. */
          readonly failure?: string;
          /** Orange: stale, out of date. */
          readonly stale?: string;
          /** Amber: in work, running. */
          readonly work?: string;
          /** Gold: you are here — the one current place. */
          readonly here?: string;
          /** Green: done, verified, added. */
          readonly done?: string;
          /** Blue: waiting on you, open. */
          readonly waiting?: string;
          /** Blue: a change, a write. */
          readonly change?: string;
          /** Grey: nothing to say, closed, superseded. */
          readonly neutral?: string;
        };
        readonly syntax?: {
          /** Plain code. */
          readonly text?: string;
          /** A name being declared. */
          readonly declaration?: string;
          /** A property or parameter. */
          readonly property?: string;
          /** Brackets and separators. */
          readonly punctuation?: string;
          /** Operators. */
          readonly operator?: string;
          /** Comments. */
          readonly comment?: string;
          /** Keywords. */
          readonly keyword?: string;
          /** Strings. */
          readonly string?: string;
          /** Function names and tags. */
          readonly function?: string;
          /** Types and attributes. */
          readonly type?: string;
          /** Numbers and constants. */
          readonly constant?: string;
        };
        readonly marks?: {
          /** The 8 project marks, quiet colours that tell projects apart. */
          readonly project?: readonly string[];
          /** The 6 worktree marks, quiet colours that tell worktrees apart. */
          readonly worktree?: readonly string[];
        };
        readonly terminal?: {
          /** An ANSI colour programs pick in the terminal. */
          readonly black?: string;
          readonly red?: string;
          readonly green?: string;
          readonly yellow?: string;
          readonly blue?: string;
          readonly magenta?: string;
          readonly cyan?: string;
          readonly white?: string;
          readonly brightBlack?: string;
          readonly brightRed?: string;
          readonly brightGreen?: string;
          readonly brightYellow?: string;
          readonly brightBlue?: string;
          readonly brightMagenta?: string;
          readonly brightCyan?: string;
          readonly brightWhite?: string;
        };
      };
      readonly dark?: {
        readonly surfaces?: {
          readonly chrome?: string;
          readonly background?: string;
          readonly field?: string;
          readonly raised?: string;
          readonly popover?: string;
          readonly sunken?: string;
          readonly muted?: string;
          readonly accent?: string;
        };
        readonly text?: {
          readonly foreground?: string;
          readonly muted?: string;
          readonly primary?: string;
        };
        readonly signals?: {
          readonly failure?: string;
          readonly stale?: string;
          readonly work?: string;
          readonly here?: string;
          readonly done?: string;
          readonly waiting?: string;
          readonly change?: string;
          readonly neutral?: string;
        };
        readonly syntax?: {
          readonly text?: string;
          readonly declaration?: string;
          readonly property?: string;
          readonly punctuation?: string;
          readonly operator?: string;
          readonly comment?: string;
          readonly keyword?: string;
          readonly string?: string;
          readonly function?: string;
          readonly type?: string;
          readonly constant?: string;
        };
        readonly marks?: {
          readonly project?: readonly string[];
          readonly worktree?: readonly string[];
        };
        readonly terminal?: {
          readonly black?: string;
          readonly red?: string;
          readonly green?: string;
          readonly yellow?: string;
          readonly blue?: string;
          readonly magenta?: string;
          readonly cyan?: string;
          readonly white?: string;
          readonly brightBlack?: string;
          readonly brightRed?: string;
          readonly brightGreen?: string;
          readonly brightYellow?: string;
          readonly brightBlue?: string;
          readonly brightMagenta?: string;
          readonly brightCyan?: string;
          readonly brightWhite?: string;
        };
      };
    };
  };
  readonly threads: {
    /** True lists the threads whose bindings name this plugin in the general thread list as well as in its own places; false, the default, keeps them out of the general list while the plugin runs in their project. */
    readonly listed?: boolean;
  };
  readonly tools: readonly ({
    /** The tool, as the process lists it. */
    readonly name: string;
    /** agents: offered, deferred, to every agent in a project where the plugin is enabled. own: only to the plugin’s own agents. view: only to the plugin’s views. tagma: called by Tagma alone, for a point that names it. */
    readonly audience: 'agents' | 'own' | 'view' | 'tagma';
    /** What the tool does, as an agent reads it. */
    readonly description: string;
    /** The JSON Schema of its input: an object at the root. */
    readonly inputSchema: {
      readonly type: 'object';
      readonly [key: string]: unknown;
    };
    /** The MCP tool annotations; readOnlyHint true lets it run without asking in review mode. */
    readonly annotations?: {
      readonly title?: string;
      readonly readOnlyHint?: boolean;
      readonly destructiveHint?: boolean;
      readonly idempotentHint?: boolean;
      readonly openWorldHint?: boolean;
    };
  })[];
  readonly views: readonly {
    /** The view, named within its plugin: lowercase letters, digits and inner hyphens. */
    readonly id: string;
    /** The Svelte component of the view, by its path from the plugin’s root, as dist/ui/ ships it, e.g. ui/Table.svelte. */
    readonly entry: string;
    /** true: a view in a tool result keeps running while scrolled away, within the feed’s budget. Absent: it unmounts out of sight. */
    readonly live?: boolean;
    /** true: the view embeds a site with <Frame media>, which may ask the person for the camera and microphone. The build writes it. */
    readonly media?: true;
  }[];
};

export type BuildVerdict = {
  readonly verdict: 'go';
} | {
  readonly verdict: 'pending';
} | {
  readonly verdict: 'stop';
  readonly reason: string;
  readonly thread?: string;
};

export type HookVerdicts = {
  readonly beforeTool: {
    /** The call does not run, and the agent reads this reason. */
    readonly deny?: string;
    /** The call runs with this input instead of its own. */
    readonly rewrite?: unknown;
    /** Words the agent reads beside the call, the message or the new thread. */
    readonly context?: string;
  };
  readonly afterTool: {
    readonly context?: string;
  };
  readonly beforeStep: {
    /** The message stays in the thread but does not reach the agent, which reads this reason in its place. */
    readonly block?: string;
    readonly context?: string;
  };
  readonly beforeClose: {
    /** The agent keeps working, with this as its next instruction. */
    readonly block?: string;
  };
  readonly threadStarted: {
    readonly context?: string;
  };
  readonly threadEnded: {};
};

export type ViewGraph = {
  readonly files: {
    readonly [key: string]: {
      /** Every import specifier the file’s compiled code writes, with the graph file it resolved to, or host for a module the window serves. */
      readonly imports: {
        readonly [key: string]: string | 'host';
      };
      /** true: the file belongs to a package the plugin depends on, so Svelte decides its mode instead of runes. */
      readonly dependency?: true;
    };
  };
  /** The Tailwind class candidates of every shipped file, as Tailwind’s own scanner reads them. */
  readonly candidates: readonly string[];
};

export type ToolFaceState = 'running' | 'done' | 'refused' | 'failed';

export const POINT_NAMES = ['actions', 'agents', 'beforeBuild', 'commands', 'composer', 'hooks', 'launchers', 'notify', 'on', 'panes', 'pins', 'results', 'schedule', 'shortcuts', 'surfaces', 'themes', 'threads', 'tools', 'views'] as const satisfies readonly (keyof PluginPoints)[];
