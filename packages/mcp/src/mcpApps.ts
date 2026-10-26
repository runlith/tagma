import { Effect, Option, Schema } from 'effect';
import type { HoldStalled, ReentrantCall } from '@runlith/held/failures';
import { type McpFailure, McpResourceFailed, type McpServerReplaced, type McpToolUnoffered } from './McpFailure';
import type { McpResourcePage, McpResourceResult } from './mcpResources';
import type { McpSdkCallResult } from './sdk';

export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';

export type McpAudience = 'model' | 'app';

const Domains = Schema.optional(Schema.Array(Schema.String));

export const McpAppCsp = Schema.Struct({
  connectDomains: Domains,
  resourceDomains: Domains,
  frameDomains: Domains,
  baseUriDomains: Domains,
});
export type McpAppCsp = typeof McpAppCsp.Type;

const SOURCE = /^(?:(?:https?|wss?):\/\/)?(?:\*\.)?[a-z0-9.-]+(?::\d{1,5})?(?:\/[^\s;,'"]*)?$/iu;

const hostOf = (domain: string): string =>
  domain
    .replace(/^[a-z]+:\/\//iu, '')
    .replace(/[:/].*$/u, '')
    .toLowerCase();

const thisMachine = (host: string): boolean => host === 'localhost' || host.endsWith('.localhost') || /^[\d.*]+$/u.test(host);

const sources = (domains: readonly string[] | undefined): readonly string[] =>
  (domains ?? []).filter((domain) => SOURCE.test(domain) && !thisMachine(hostOf(domain)));

export const viewCsp = (declared: McpAppCsp): McpAppCsp => ({
  connectDomains: sources(declared.connectDomains),
  resourceDomains: sources(declared.resourceDomains),
  frameDomains: sources(declared.frameDomains),
  baseUriDomains: sources(declared.baseUriDomains),
});

const Granted = Schema.optional(Schema.Struct({}));

export const McpAppPermissions = Schema.Struct({
  camera: Granted,
  microphone: Granted,
  geolocation: Granted,
  clipboardWrite: Granted,
});
export type McpAppPermissions = typeof McpAppPermissions.Type;

export const McpAppResourceMeta = Schema.Struct({
  csp: Schema.optional(McpAppCsp),
  permissions: Schema.optional(McpAppPermissions),
  domain: Schema.optional(Schema.String),
  prefersBorder: Schema.optional(Schema.Boolean),
});
export type McpAppResourceMeta = typeof McpAppResourceMeta.Type;

export const MCP_APP_DOCUMENT_MAX_LENGTH = 8 * 1024 * 1024;

export const McpAppView = Schema.Struct({
  html: Schema.String,
  meta: McpAppResourceMeta,
  tool: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export type McpAppView = typeof McpAppView.Type;

export type McpAppTarget = {
  readonly server: string;
  readonly identity: string;
};

export type McpAppFailure = McpFailure | McpResourceFailed | McpToolUnoffered | McpServerReplaced | HoldStalled | ReentrantCall;

const Meta = Schema.optional(Schema.Record(Schema.String, Schema.Unknown));

export const McpAppCallResult = Schema.Struct({
  content: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
  structuredContent: Meta,
  isError: Schema.optional(Schema.Boolean),
  _meta: Meta,
});
export type McpAppCallResult = typeof McpAppCallResult.Type;

export function mcpAppResult(result: McpSdkCallResult): McpAppCallResult {
  if ('content' in result) return result;
  return {
    content: [{ type: 'text', text: JSON.stringify(result.toolResult) }],
    _meta: result._meta,
  };
}

export type McpAppSource<E> = {
  readonly read: (uri: string) => Effect.Effect<McpResourceResult, E>;
  readonly directory: Effect.Effect<McpAppDirectory, E>;
};

type Described = { readonly _meta?: Readonly<Record<string, unknown>> | undefined };

const uiOf = (meta: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, unknown>> | undefined => {
  const ui = meta?.ui;
  return typeof ui === 'object' && ui !== null && !Array.isArray(ui) ? (ui as Readonly<Record<string, unknown>>) : undefined;
};

export function mcpVisibleTo(descriptor: Described, audience: McpAudience): boolean {
  const visibility = uiOf(descriptor._meta)?.visibility;
  return !Array.isArray(visibility) || visibility.includes(audience);
}

export function mcpAppResource(descriptor: Described): string | undefined {
  const uri = uiOf(descriptor._meta)?.resourceUri;
  return typeof uri === 'string' && uri.startsWith('ui://') ? uri : undefined;
}

const decodeMeta = Schema.decodeUnknownOption(McpAppResourceMeta);

const metaOf = (meta: Readonly<Record<string, unknown>> | undefined): McpAppResourceMeta | undefined => {
  const ui = uiOf(meta);
  return ui === undefined ? undefined : Option.getOrUndefined(decodeMeta(ui));
};

const textOf = (blob: string): string => new TextDecoder().decode(Uint8Array.fromBase64(blob));

const lengthOf = (content: { readonly text: string } | { readonly blob: string }): number =>
  'text' in content
    ? content.text.length
    : Math.floor((content.blob.length * 3) / 4) - (content.blob.endsWith('==') ? 2 : content.blob.endsWith('=') ? 1 : 0);

const refused = (server: string, uri: string, reason: string) => new McpResourceFailed({ server, uri, method: 'resources/read', reason });

export type McpAppDirectory = ReadonlyMap<string, McpAppResourceMeta>;

export const mcpAppDirectory = Effect.fn('mcp.appDirectory')(function* <E>(
  list: (cursor: string | undefined) => Effect.Effect<McpResourcePage, E>,
  maxListingBytes: number,
): Effect.fn.Return<McpAppDirectory, E> {
  const directory = new Map<string, McpAppResourceMeta>();
  const asked = new Set<string>();
  let bytes = 0;
  let cursor: string | undefined;
  while (true) {
    const page = yield* list(cursor);
    for (const resource of page.resources) {
      const meta = metaOf(resource._meta);
      if (meta !== undefined) directory.set(resource.uri, meta);
      bytes += resource.uri.length + JSON.stringify(resource._meta ?? null).length;
    }
    const next = page.nextCursor;
    if (next === undefined || page.resources.length === 0 || asked.has(next) || bytes > maxListingBytes) return directory;
    asked.add(next);
    cursor = next;
  }
});

export const mcpAppDocument = Effect.fn('mcp.appDocument')(function* <E>(
  server: string,
  uri: string,
  source: McpAppSource<E>,
): Effect.fn.Return<McpAppView, E | McpResourceFailed> {
  const read = yield* source.read(uri);
  const content = read.contents.find((candidate) => candidate.uri === uri) ?? read.contents[0];
  if (content === undefined) return yield* refused(server, uri, 'the server answered no content');
  if (content.mimeType !== MCP_APP_MIME_TYPE) {
    return yield* refused(server, uri, `the content is ${content.mimeType ?? 'untyped'}, not ${MCP_APP_MIME_TYPE}`);
  }
  if (lengthOf(content) > MCP_APP_DOCUMENT_MAX_LENGTH) {
    return yield* refused(server, uri, `the document passes ${MCP_APP_DOCUMENT_MAX_LENGTH} characters, more than one view is given`);
  }
  const html =
    'text' in content
      ? content.text
      : yield* Effect.try({
          try: () => textOf(content.blob),
          catch: () => refused(server, uri, 'the blob is not base64'),
        });
  const meta = metaOf(content._meta) ?? (yield* source.directory).get(uri) ?? {};
  return { html, meta };
});
