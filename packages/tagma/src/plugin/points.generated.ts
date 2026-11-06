export type PluginEnvelope = {
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly description?: string;
  readonly process?: {
    readonly entry: string;
    readonly resident?: boolean;
  };
  readonly options?: readonly ({
    readonly key: string;
    readonly title: string;
    readonly description: string;
    readonly type?: 'string' | 'number' | 'boolean' | 'directory' | 'file';
    readonly sensitive?: boolean;
    readonly required?: boolean;
    readonly default?: string;
  })[];
  readonly build: {
    readonly hash: string;
    readonly sources: readonly string[];
  };
  readonly contributes?: {
    readonly [key: string]: unknown;
  };
};

export type PluginPoints = {
  readonly actions: readonly {
    readonly id: string;
    readonly title: string;
    readonly tool: string;
  }[];
  readonly agents: readonly {
    readonly id: string;
    readonly path: string;
  }[];
  readonly beforeBuild: readonly {
    readonly tool: string;
    readonly title: string;
  }[];
  readonly launchers: readonly {
    readonly view: string;
    readonly title: string;
  }[];
  readonly notify: {
    readonly tool: string;
  };
  readonly on: {
    readonly ended?: string;
    readonly asked?: string;
  };
  readonly panes: readonly {
    readonly view: string;
    readonly title: string;
    readonly icon?: string;
  }[];
  readonly pins: readonly {
    readonly view: string;
  }[];
  readonly results: readonly {
    readonly tool: string;
    readonly view: string;
  }[];
  readonly schedule: readonly {
    readonly name: string;
    readonly everyMs: number;
    readonly tool: string;
  }[];
  readonly shortcuts: readonly {
    readonly keys: string;
    readonly action: string;
    readonly global?: boolean;
  }[];
  readonly surfaces: readonly {
    readonly view: string;
    readonly title: string;
    readonly icon?: string;
  }[];
  readonly themes: {
    readonly [key: string]: {
      readonly title: string;
      readonly light?: {
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
    readonly listed?: boolean;
  };
  readonly tools: readonly ({
    readonly name: string;
    readonly audience: 'agents' | 'own' | 'view' | 'tagma';
    readonly description: string;
    readonly inputSchema: {
      readonly type: 'object';
      readonly [key: string]: unknown;
    };
    readonly annotations?: {
      readonly title?: string;
      readonly readOnlyHint?: boolean;
      readonly destructiveHint?: boolean;
      readonly idempotentHint?: boolean;
      readonly openWorldHint?: boolean;
    };
  })[];
  readonly views: readonly {
    readonly id: string;
    readonly entry: string;
    readonly live?: boolean;
    readonly csp?: {
      readonly connectDomains?: readonly string[];
      readonly resourceDomains?: readonly string[];
      readonly frameDomains?: readonly string[];
      readonly baseUriDomains?: readonly string[];
    };
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

export const POINT_NAMES = ['actions', 'agents', 'beforeBuild', 'launchers', 'notify', 'on', 'panes', 'pins', 'results', 'schedule', 'shortcuts', 'surfaces', 'themes', 'threads', 'tools', 'views'] as const satisfies readonly (keyof PluginPoints)[];
