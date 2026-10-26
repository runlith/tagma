import { type Brand, Context, Schema } from 'effect';
import { spokenId } from './ids.js';

export type HarnessId = string & Brand.Brand<'HarnessId'>;

export type SessionRef = { readonly harness: string; readonly key: string };

export const NATIVE_HARNESS = 'tagma';

export const SESSION_HEADER = 'x-tagma-session';

export const MCP_SESSION_HEADER = 'x-tagma-mcp-session';

export const MCP_KEY_VARIABLE = 'TAGMA_MCP_KEY';

export const MCP_TOOL_SHAPES = ['catalog', 'proxy'] as const;
export type McpToolShape = (typeof MCP_TOOL_SHAPES)[number];

export class SessionIdentity extends Context.Service<
  SessionIdentity,
  {
    readonly prefix: Readonly<Record<string, string>>;
    readonly extras: readonly string[];
  }
>()('tagma/platform/SessionIdentity') {}

export const sessionIdentitySchema = Schema.Struct({
  prefix: Schema.Record(Schema.String, Schema.String),
  extras: Schema.Array(Schema.String),
});

export function sessionToken(ref: SessionRef): string {
  return `${ref.harness}:${ref.key}`;
}

export function parseSessionToken(value: string): SessionRef | null {
  const parsed = /^([a-z][\w.-]*):(.+)$/.exec(value.trim());
  const harness = parsed?.[1];
  const key = parsed?.[2];
  return harness === undefined || key === undefined ? null : { harness, key };
}

export function sessionName(ref: SessionRef, identity: SessionIdentity['Service']): string {
  const spoken = spokenId(ref.key);
  if (ref.harness === NATIVE_HARNESS) return spoken;
  return `${identity.prefix[ref.harness] ?? ref.harness}:${spoken}`;
}
