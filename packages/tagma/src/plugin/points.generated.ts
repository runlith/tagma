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
  readonly surfaces: readonly {
    readonly view: string;
    readonly title: string;
    readonly icon?: string;
  }[];
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

export const POINT_NAMES = ['agents', 'beforeBuild', 'launchers', 'notify', 'on', 'panes', 'pins', 'results', 'schedule', 'surfaces', 'tools', 'views'] as const satisfies readonly (keyof PluginPoints)[];
