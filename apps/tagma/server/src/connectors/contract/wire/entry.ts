import { MCP_SERVER_NAME_PATTERN, McpHttpServerDeclaration } from '@runlith/mcp/declaration';
import { Schema } from 'effect';

const named = Schema.String.check(Schema.isMinLength(1));

export const ConnectorSignIn = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('oauth'),
    client: Schema.optional(
      Schema.Struct({
        id: named,
        redirects: Schema.Array(named),
      }),
    ).annotate({
      description:
        'A public client registered with the service for PKCE with no secret, and the loopback redirect addresses it registered.',
    }),
  }),
  Schema.Struct({
    kind: Schema.Literal('key'),
    headers: Schema.Record(Schema.String, Schema.String).annotate({
      description: 'Sent with every request; the key stands in them as a `${NAME}` reference.',
    }),
    obtain: named.annotate({ description: 'Where the person gets the key.' }),
  }),
]);
export type ConnectorSignIn = typeof ConnectorSignIn.Type;

export const ConnectorEntry = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(MCP_SERVER_NAME_PATTERN)).annotate({
    description: 'The catalog id, also the name of the MCP server a connection declares.',
  }),
  title: named,
  description: named.annotate({ description: 'One line of what an agent can do there.' }),
  icon: named.annotate({ description: 'The SVG path data of a one-colour mark on a 24 by 24 grid.' }),
  url: named.annotate({ description: 'The service’s remote MCP endpoint.' }),
  signIn: ConnectorSignIn,
  capabilities: McpHttpServerDeclaration.fields.capabilities,
});
export type ConnectorEntry = typeof ConnectorEntry.Type;
