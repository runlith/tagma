import type { McpAppCsp, McpAppPermissions } from '@runlith/mcp/apps';

export const VIEW_PROTOCOL = '2026-01-26';

export const UNAVAILABLE = -32601;

export const INVALID_PARAMS = -32602;

const FAILED = -32000;

const INVALID = -32600;

const PENDING_MAX = 64;

const PROXY_READY = 'ui/notifications/sandbox-proxy-ready';

const RESOURCE_READY = 'ui/notifications/sandbox-resource-ready';

const TEARDOWN = 'ui/resource-teardown';

export type ViewParams = Readonly<Record<string, unknown>>;

type ViewCall = {
  readonly signal: AbortSignal;
  readonly mounted: AbortSignal;
  readonly notify: (method: string, params: ViewParams) => void;
};

export type ViewMethod = (params: ViewParams, call: ViewCall) => Promise<unknown>;

export type ViewUpdate = { readonly uri: string; readonly _meta?: Readonly<Record<string, unknown>> | undefined };

export type ViewSubscription = {
  readonly updated: (update: ViewUpdate) => void;
  readonly ended: () => void;
  readonly signal: AbortSignal;
};

export type ViewHost = {
  readonly methods: Readonly<Record<string, ViewMethod>>;
  readonly capabilities?: ViewParams;
  readonly subscribe?: (uri: string, subscription: ViewSubscription) => Promise<() => void>;
  readonly context: () => ViewParams;
};

export class ViewRefusal extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export type ViewDocument = {
  readonly csp: McpAppCsp;
  readonly permissions: McpAppPermissions;
} & ({ readonly html: string } | { readonly src: string });

export type ViewFrame = {
  readonly origin: string;
  readonly source: () => unknown;
  readonly post: (message: unknown) => void;
};

export type ViewSize = { readonly width?: number; readonly height?: number };

export type ViewEvents = {
  readonly initialized?: () => void;
  readonly resized?: (size: ViewSize) => void;
};

export type ViewMessage = { readonly source: unknown; readonly origin: string; readonly data: unknown };

type Id = string | number;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isId = (value: unknown): value is Id => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));

const paramsOf = (value: unknown): ViewParams => (isRecord(value) ? value : {});

const sizeOf = (params: ViewParams): ViewSize => ({
  width: typeof params.width === 'number' && Number.isFinite(params.width) ? params.width : undefined,
  height: typeof params.height === 'number' && Number.isFinite(params.height) ? params.height : undefined,
});

const said = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

export class ViewBridge {
  private ready = false;
  private disposed = false;
  private asked = 0;
  private mount = new AbortController();
  private readonly pending = new Map<Id, AbortController>();
  private readonly awaited = new Map<string, () => void>();
  private readonly held = new Map<string, () => void>();
  private readonly wanted = new Set<string>();

  constructor(
    private readonly frame: ViewFrame,
    private readonly host: ViewHost,
    private readonly view: ViewDocument,
    private readonly events: ViewEvents = {},
  ) {}

  get initialized(): boolean {
    return this.ready;
  }

  receive(message: ViewMessage): void {
    if (this.disposed || message.source !== this.frame.source() || message.origin !== this.frame.origin) return;
    const data = message.data;
    if (!isRecord(data) || data.jsonrpc !== '2.0') return;
    if (typeof data.method !== 'string') {
      if (typeof data.id === 'string' && ('result' in data || 'error' in data)) this.awaited.get(data.id)?.();
      return;
    }
    const params = paramsOf(data.params);
    if (data.method === PROXY_READY) {
      this.restart();
      this.frame.post({ jsonrpc: '2.0', method: RESOURCE_READY, params: this.view });
      return;
    }
    if (isId(data.id)) {
      void this.answer(data.id, data.method, params);
      return;
    }
    if (data.method === 'ui/notifications/initialized') {
      this.ready = true;
      this.events.initialized?.();
      return;
    }
    if (data.method === 'ui/notifications/size-changed') this.events.resized?.(sizeOf(params));
  }

  notify(method: string, params: ViewParams): boolean {
    if (!this.ready || this.disposed) return false;
    this.frame.post({ jsonrpc: '2.0', method, params });
    return true;
  }

  close(reason: string, within: number): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (!this.ready) {
      this.dispose();
      return Promise.resolve();
    }
    this.asked += 1;
    const id = `teardown-${this.asked}`;
    return new Promise<void>((done) => {
      const finish = () => {
        clearTimeout(deadline);
        this.awaited.delete(id);
        this.dispose();
        done();
      };
      const deadline = setTimeout(finish, within);
      this.awaited.set(id, finish);
      this.frame.post({ jsonrpc: '2.0', id, method: TEARDOWN, params: { reason } });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.restart();
    this.disposed = true;
  }

  private restart(): void {
    this.ready = false;
    this.mount.abort(new Error('the view was torn down'));
    this.mount = new AbortController();
    for (const control of this.pending.values()) control.abort(new Error('the view was torn down'));
    this.pending.clear();
    for (const release of this.held.values()) release();
    this.held.clear();
    this.wanted.clear();
  }

  private reply(id: Id, result: unknown): void {
    if (!this.disposed) this.frame.post({ jsonrpc: '2.0', id, result });
  }

  private refuse(id: Id, code: number, message: string, data?: unknown): void {
    if (!this.disposed) this.frame.post({ jsonrpc: '2.0', id, error: { code, message, data } });
  }

  private async answer(id: Id, method: string, params: ViewParams): Promise<void> {
    if (method === 'ui/initialize') return this.reply(id, this.handshake());
    if (method === 'ping') return this.reply(id, {});
    if (this.pending.has(id)) return this.refuse(id, INVALID, 'the request id is already in flight');
    if (this.pending.size >= PENDING_MAX) {
      return this.refuse(id, FAILED, `the view has ${PENDING_MAX} requests in flight; it waits for one of them to answer`);
    }
    const handler =
      method === 'resources/subscribe' || method === 'resources/unsubscribe'
        ? this.subscription(method)
        : Object.hasOwn(this.host.methods, method)
          ? this.host.methods[method]
          : undefined;
    if (handler === undefined) return this.refuse(id, UNAVAILABLE, 'unavailable', { method });
    const control = new AbortController();
    this.pending.set(id, control);
    const mounted = this.mount.signal;
    try {
      const result = await handler(params, {
        signal: control.signal,
        mounted,
        notify: (name, sent) => {
          if (!mounted.aborted) this.notify(name, sent);
        },
      });
      if (!control.signal.aborted) this.reply(id, result);
    } catch (failure) {
      if (!control.signal.aborted) this.refuse(id, failure instanceof ViewRefusal ? failure.code : FAILED, said(failure));
    } finally {
      if (this.pending.get(id) === control) this.pending.delete(id);
    }
  }

  private subscription(method: 'resources/subscribe' | 'resources/unsubscribe'): ViewMethod | undefined {
    const subscribe = this.host.subscribe;
    if (subscribe === undefined) return undefined;
    return async (params, { signal }) => {
      const uri = params.uri;
      if (typeof uri !== 'string' || uri.length === 0) throw new ViewRefusal(INVALID_PARAMS, 'uri is required');
      if (method === 'resources/unsubscribe') {
        this.wanted.delete(uri);
        this.held.get(uri)?.();
        this.held.delete(uri);
        return {};
      }
      this.wanted.add(uri);
      if (this.held.has(uri)) return {};
      let release: () => void = () => undefined;
      release = await subscribe(uri, {
        updated: (update) => {
          this.notify('notifications/resources/updated', { ...update, uri });
        },
        ended: () => {
          if (this.held.get(uri) === release) this.held.delete(uri);
        },
        signal,
      });
      if (signal.aborted || !this.wanted.has(uri) || this.held.has(uri)) release();
      else this.held.set(uri, release);
      return {};
    };
  }

  private handshake(): ViewParams {
    const methods = this.host.methods;
    return {
      protocolVersion: VIEW_PROTOCOL,
      hostInfo: { name: 'tagma', version: '1' },
      hostCapabilities: {
        ...(Object.hasOwn(methods, 'tools/call') ? { serverTools: {} } : {}),
        ...(Object.hasOwn(methods, 'resources/read') ? { serverResources: {} } : {}),
        ...(Object.hasOwn(methods, 'ui/open-link') ? { openLinks: {} } : {}),
        ...this.host.capabilities,
        sandbox: { csp: this.view.csp, permissions: this.view.permissions },
      },
      hostContext: this.host.context(),
    };
  }
}
