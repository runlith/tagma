import { type Raised } from '@runlith/agent/permissions';
import { mcpResolvingEnvKeys } from '@runlith/mcp/declaration';
import { Schema } from 'effect';
import type { ProjectRef } from '../../../projects/contract/wire/project.js';
import { McpHttpServerDeclaration, McpStdioServerDeclaration } from '@runlith/mcp/declaration';
import { SETTABLE_SCOPES } from '../../../platform/contract/wire/setting.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { McpAppCallResult, McpAppView } from '@runlith/mcp/apps';
import { MCP_APP_REFUSALS, mcpMeta, mcpServerName, mcpViewResource } from './feeds.js';
import { mcpServerRowSchema } from './servers.js';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { MCP_ENV_RESOLVING } from '../../../platform/contract/wire/conditions.js';
import { ASKS_IN_REVIEW } from '../../../platform/contract/wire/conditions.js';
import { placeRole, projectField } from '../../../platform/contract/wire/place.js';

const mcpScope = Schema.optional(Schema.Literals(SETTABLE_SCOPES)).annotate({
  description: 'project (default): this project only. user: all projects for this operator.',
});

export const mcpScopeOf = (input: { readonly scope?: 'project' | 'user' }) => input.scope ?? 'project';

const mcpEnabled = Schema.optional(Schema.Boolean).annotate({
  description: 'Whether the server may be connected at all; true when omitted.',
});

const mcpDeclared = {
  project: projectField,
  name: McpStdioServerDeclaration.fields.name.annotate({
    description: 'Server name used to prefix its tool names.',
  }),
  capabilities: McpStdioServerDeclaration.fields.capabilities.annotate({
    description: 'Default permission kinds and durable-mutation flag. Per-tool entries replace the default; an empty kinds list is valid.',
  }),
  timeoutMs: McpStdioServerDeclaration.fields.timeoutMs.annotate({
    description: 'How long one request of this server may take; the SDK default when omitted.',
  }),
  enabled: mcpEnabled,
  scope: mcpScope,
};

const mcpAddParams = Schema.Union([
  Schema.Struct({
    ...McpStdioServerDeclaration.fields,
    ...mcpDeclared,
    command: McpStdioServerDeclaration.fields.command.annotate({
      description: 'The program to run. It is spawned as the operator, on the operator’s machine.',
    }),
    args: McpStdioServerDeclaration.fields.args.annotate({ description: 'Arguments to the command.' }),
    cwd: McpStdioServerDeclaration.fields.cwd.annotate({
      ...placeRole('value'),
      description: 'Where the child runs; the server’s own directory when omitted.',
    }),
    env: McpStdioServerDeclaration.fields.env.annotate({
      description: 'Overrides the inherited environment allowlist. Linker, interpreter and executable lookup-path variables are forbidden.',
    }),
  }),
  Schema.Struct({
    ...McpHttpServerDeclaration.fields,
    ...mcpDeclared,
    url: McpHttpServerDeclaration.fields.url.annotate({ description: 'The Streamable HTTP endpoint.' }),
    headers: McpHttpServerDeclaration.fields.headers.annotate({
      description: 'Sent with every request; a `${NAME}` value is resolved when the server is connected.',
    }),
  }),
]);

const resolving = (command: string, keys: readonly string[]): readonly Raised[] =>
  keys.length === 0
    ? []
    : [
        {
          condition: 'mcp-env-resolving',
          fact: `the declaration sets ${keys.join(', ')}, which decide what ${command} resolves to and loads`,
        },
      ];

const declared = {
  doors: { http: true },
  tool: { capability: 'mcp' },
  callers: 'any',
  subject: 'none',
  place: 'project',
  waits: [],
  lifetimes: [],
} as const;

const answer = arms({ ok: { mcp: Schema.Array(mcpServerRowSchema) } });

const acted = { ...declared, effect: 'write', identity: { key: 'call' } } as const;

export const MCP_OPERATIONS = {
  add_mcp_server: operation('add_mcp_server', {
    approval: { ...ASKS_IN_REVIEW, when: [MCP_ENV_RESOLVING] },
    ...acted,
    answer,
    meaning: 'Declare a project or user MCP server. Its tools become available at the next run.',
    grammar: `Requires the connection details and capability classification. \`\${NAME}\` anywhere in the declaration is stored literally and resolved on connection: first from the value the operator set for this server with set_secret, then from Tagma’s environment. A server whose names resolve from neither is declared and shows needs-value naming them.
Returns declarations without connecting. Use read_mcp_servers for connection state.`,
    input: mcpAddParams,
    refusals: ['mcp-server-exists', 'mcp-reconcile-stalled', 'secret-store-failed', 'setting-scope', 'setting-value', 'unknown-project'],
    confirmation: (input, project: ProjectRef) => ({
      summary:
        mcpScopeOf(input) === 'user'
          ? `Declare the MCP server ${input.name} in the operator's own set, for every project?`
          : `Declare the MCP server ${input.name} for project “${project.name}”?`,
      facts: [
        input.transport === 'stdio'
          ? { label: 'runs', value: [input.command, ...(input.args ?? [])].join(' ') }
          : { label: 'reaches', value: input.url },
        {
          label: 'may',
          value: input.capabilities.kinds.length === 0 ? 'nothing of the host' : input.capabilities.kinds.join(', '),
        },
        {
          label: 'durable data',
          value: input.capabilities.mutates ? 'changes it' : 'changes nothing',
        },
      ],
      consequence:
        mcpScopeOf(input) === 'user'
          ? 'Its tools are offered to every project on this machine from the next run, and its calls are judged by the capabilities declared here.'
          : `Its tools are offered to project “${project.name}” from the next run, and its calls are judged by the declared capabilities.`,
    }),
    confirmLabel: 'Declare',
    presentation: { running: 'Declaring an MCP server', done: 'Declared an MCP server' },
    subjects: (input) =>
      input.transport === 'stdio'
        ? [{ kind: 'execute', value: [input.command, ...(input.args ?? [])].join(' ') }]
        : [{ kind: 'network', value: input.url }],
    raises: (input) => (input.transport === 'stdio' ? resolving(input.command, mcpResolvingEnvKeys(input.env)) : []),
  }),
  remove_mcp_server: operation('remove_mcp_server', {
    approval: ASKS_IN_REVIEW,
    ...acted,
    answer,
    meaning: 'Remove an MCP declaration from its owning scope, withdraw its tools, stop its process and drop the secret values set for it.',
    grammar: 'A server absent from the selected scope refuses; if another scope owns it, the refusal names that scope.',
    input: Schema.Struct({
      project: projectField,
      name: Schema.String.check(Schema.isMinLength(1)).annotate({
        description: 'The server, as it was declared.',
      }),
      scope: mcpScope,
    }),
    refusals: ['mcp-server-unknown', 'mcp-reconcile-stalled', 'secret-store-failed', 'setting-scope', 'setting-value', 'unknown-project'],
    confirmation: (input, project: ProjectRef) => ({
      summary:
        mcpScopeOf(input) === 'user'
          ? `Drop the MCP server ${input.name} from the operator's own set, for every project?`
          : `Drop the MCP server ${input.name} from project “${project.name}”?`,
      consequence: 'Its tools stop being offered, and the process it was running ends.',
    }),
    confirmLabel: 'Drop',
    presentation: { running: 'Dropping an MCP server', done: 'Dropped an MCP server' },
    subjects: () => [],
  }),
  enable_mcp_server: operation('enable_mcp_server', {
    approval: ASKS_IN_REVIEW,
    ...acted,
    answer,
    meaning: 'Switch a declared MCP server on or off where it stands, keeping the declaration exactly as it was written.',
    grammar: `\`enabled: false\` withdraws its tools and ends the process it was running; enabling hands it back to the pool, which connects without this act waiting for it — read the state with read_mcp_servers.
Every other field is preserved, so switching back restores the same server rather than declaring a second one. A server absent from the selected scope refuses; if another scope owns it, the refusal names that scope.`,
    input: Schema.Struct({
      project: projectField,
      name: Schema.String.check(Schema.isMinLength(1)).annotate({
        description: 'The server, as it was declared.',
      }),
      enabled: Schema.optional(Schema.Boolean).annotate({
        description: 'true — connect it and offer its tools (the default); false — switch it off in place.',
      }),
      scope: mcpScope,
    }),
    refusals: ['mcp-server-unknown', 'mcp-reconcile-stalled', 'secret-store-failed', 'setting-scope', 'setting-value', 'unknown-project'],
    confirmation: (input, project: ProjectRef) => {
      const off = input.enabled === false;
      const set = mcpScopeOf(input) === 'user' ? "the operator's own set, for every project" : `project “${project.name}”`;
      return {
        summary: off ? `Switch the MCP server ${input.name} off in ${set}?` : `Switch the MCP server ${input.name} on in ${set}?`,
        consequence: off
          ? 'Its tools stop being offered, and the process it was running ends. The declaration stays as it was written.'
          : 'It is connected as it was declared, and its tools are offered again from the next run.',
      };
    },
    confirmLabel: 'Switch',
    presentation: { running: 'Switching an MCP server', done: 'Switched an MCP server' },
    subjects: () => [],
  }),
  read_mcp_servers: operation('read_mcp_servers', {
    approval: ASKS_NEVER,
    ...declared,
    answer,
    effect: 'read',
    identity: 'none',
    meaning:
      'Read effective MCP declarations and current state: connected with tool counts, connecting, disabled, needs-value naming the values it still lacks, needs-sign-in for an HTTP server the operator signs in to from its card, or failed with its reason.',
    grammar:
      'Resolves user declarations then project overrides. Secrets remain `${NAME}` references, never resolved values; a needed value is the operator’s to give on the server’s card (set_secret, owner mcp, id `<scope>/<server>`). Does not connect servers.',
    input: Schema.Struct({ project: projectField }),
    refusals: ['secret-store-failed', 'unknown-project'],
    confirmation: () => ({ summary: 'Read the MCP server declarations and their current state?' }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading the MCP servers',
      done: 'Read the MCP servers',
      many: (count) => `Read the MCP servers ${count} times`,
    },
    subjects: () => [],
  }),
};

const viewed = {
  doors: { http: true },
  callers: 'operator',
  subject: 'none',
  place: 'home',
  waits: [],
  lifetimes: [],
  approval: ASKS_NEVER,
} as const;

const mcpServer = mcpServerName;

const viewIdentity = Schema.String.annotate({
  description: 'The server declaration the view belongs to, as the tool call’s display names it.',
});

export const MCP_APP_OPERATIONS = {
  open_mcp_app: operation('open_mcp_app', {
    ...viewed,
    effect: 'read',
    identity: 'none',
    answer: arms({ ok: { view: McpAppView } }),
    meaning: 'Read the HTML and the sandbox metadata of an MCP App view, for the host to mount.',
    grammar: `The resource metadata comes from its read content, else from its entry in the server’s resource list.
The identity is the declaration the tool call ran against, as the call's display names it; opening, reading, calling and subscribing refuse mcp-server-replaced once the name means another declaration. The answered CSP is the one the sandbox enforces: no address of this machine and no bare IP. A named tool the server still offers is answered whole beside the view.`,
    input: Schema.Struct({
      server: mcpServer,
      identity: viewIdentity,
      resource: mcpViewResource,
      tool: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
    }),
    refusals: MCP_APP_REFUSALS,
    confirmation: (input) => ({ summary: `Open the view ${input.resource} of the MCP server ${input.server}?` }),
    confirmLabel: 'Open',
    presentation: { running: 'Opening an MCP App view', done: 'Opened an MCP App view' },
    subjects: () => [],
  }),
  read_mcp_resource: operation('read_mcp_resource', {
    ...viewed,
    effect: 'read',
    identity: 'none',
    answer: arms({ ok: { contents: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)), _meta: Schema.optional(mcpMeta) } }),
    meaning: 'Read one resource of an MCP server for its own view.',
    grammar:
      'The caller the server receives names the project and the view that reads, so a server serving several projects can refuse another project’s resource.',
    input: Schema.Struct({
      server: mcpServer,
      identity: viewIdentity,
      resource: mcpViewResource,
      uri: Schema.String.check(Schema.isMinLength(1)),
    }),
    refusals: MCP_APP_REFUSALS,
    confirmation: (input) => ({ summary: `Read ${input.uri} from the MCP server ${input.server}?` }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading an MCP resource', done: 'Read an MCP resource' },
    subjects: () => [],
  }),
  call_mcp_app_tool: operation('call_mcp_app_tool', {
    ...viewed,
    effect: 'external',
    identity: { key: 'call' },
    answer: arms({ ok: { result: McpAppCallResult } }),
    meaning: 'Call a tool of an MCP server on behalf of its own view, as the operator acting in it.',
    grammar: 'Only a tool whose visibility includes app is called; the caller the server receives names the view and its thread.',
    input: Schema.Struct({
      server: mcpServer,
      identity: viewIdentity,
      resource: mcpViewResource,
      tool: Schema.String.check(Schema.isMinLength(1)),
      arguments: Schema.Record(Schema.String, Schema.Unknown),
      threadId: Schema.optional(Schema.String.annotate(placeRole('value'))),
    }),
    refusals: MCP_APP_REFUSALS,
    confirmation: (input) => ({ summary: `Call ${input.tool} on the MCP server ${input.server} from its view?` }),
    confirmLabel: 'Call',
    presentation: { running: 'Calling an MCP App tool', done: 'Called an MCP App tool' },
    subjects: () => [],
  }),
};

const operatorActs = {
  doors: { http: true },
  callers: 'operator',
  subject: 'none',
  place: 'project',
  waits: [],
  lifetimes: [],
  approval: ASKS_NEVER,
} as const;

const signedName = Schema.String.check(Schema.isMinLength(1)).annotate({ description: 'The HTTP server, as it was declared.' });

export const MCP_SIGN_IN_OPERATIONS = {
  sign_in_mcp_server: operation('sign_in_mcp_server', {
    ...operatorActs,
    effect: 'external',
    identity: { key: 'call' },
    answer: arms({ ok: { url: Schema.String } }),
    meaning: 'Start signing an HTTP MCP server in by OAuth and answer the address of its sign-in page, for the operator to open.',
    grammar: `The service's answer returns to this door's /mcp/oauth/callback, which keeps the tokens and connects the server; a sign-in left unanswered expires in ten minutes, and a newer one for the same server replaces it.
The client Tagma signs in as is, in order: the one given here or registered before, a client metadata document where the service accepts one, then dynamic registration. A service offering none refuses mcp-sign-in-unsupported.`,
    input: Schema.Struct({
      project: projectField,
      name: signedName,
      scope: mcpScope,
      client: Schema.optional(
        Schema.Struct({
          id: Schema.String.check(Schema.isMinLength(1)),
          secret: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
        }),
      ).annotate({
        description: 'A client the operator registered with the service for this door’s callback, kept for the next sign-ins.',
      }),
    }),
    refusals: [
      'mcp-server-unknown',
      'mcp-sign-in-unsupported',
      'mcp-sign-in-failed',
      'mcp-sign-in-unserved',
      'mcp-reconcile-stalled',
      'secret-store-failed',
      'unknown-project',
    ],
    confirmation: (input) => ({ summary: `Sign in to the MCP server ${input.name}?` }),
    confirmLabel: 'Sign in',
    presentation: { running: 'Signing in to an MCP server', done: 'Opened the sign-in of an MCP server' },
    subjects: () => [],
  }),
  sign_out_mcp_server: operation('sign_out_mcp_server', {
    ...operatorActs,
    effect: 'write',
    identity: { key: 'call' },
    answer,
    meaning: 'Drop the tokens of an HTTP MCP server, keeping the client it signs in as; the server reads needs-sign-in again.',
    input: Schema.Struct({ project: projectField, name: signedName, scope: mcpScope }),
    refusals: ['mcp-server-unknown', 'mcp-reconcile-stalled', 'secret-store-failed', 'unknown-project'],
    confirmation: (input) => ({ summary: `Sign out of the MCP server ${input.name}?` }),
    confirmLabel: 'Sign out',
    presentation: { running: 'Signing out of an MCP server', done: 'Signed out of an MCP server' },
    subjects: () => [],
  }),
};

export type McpOperationId = keyof typeof MCP_OPERATIONS;
export const MCP_OPERATION_IDS = Object.keys(MCP_OPERATIONS) as readonly McpOperationId[];
