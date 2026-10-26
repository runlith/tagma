import type { ToolDisplay } from '@runlith/agent/tool/display';
import { Effect } from 'effect';
import { type ModulePresentation, UNVOICED } from '../platform/contract/service/presentation.js';
import type { McpServerRow } from './contract/wire/servers.js';
import { MCP_OPERATION_IDS } from './contract/wire/operations.js';
import { mcpText, serversOf } from './voice.js';

type McpInput = {
  readonly name?: string;
  readonly transport?: string;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly capabilities?: { readonly kinds: readonly string[]; readonly mutates: boolean };
  readonly scope?: string;
};

const mcpCalledDisplay = (input: McpInput): ToolDisplay => ({ form: 'none', title: input.name });

function mcpSettledDisplay(input: McpInput, servers: readonly McpServerRow[]): ToolDisplay {
  const scope = input.scope === undefined ? [] : [{ label: 'scope', value: input.scope }];
  if (input.transport !== undefined && input.name !== undefined) {
    const kinds = input.capabilities?.kinds ?? [];
    return {
      form: 'none',
      title: input.name,
      facts: [
        { label: 'transport', value: input.transport },
        ...(input.url === undefined
          ? input.command === undefined
            ? []
            : [{ label: 'runs', value: [input.command, ...(input.args ?? [])].join(' ') }]
          : [{ label: 'reaches', value: input.url }]),
        { label: 'may', value: kinds.length === 0 ? 'nothing of the host' : kinds.join(', ') },
        { label: 'durable data', value: input.capabilities?.mutates ? 'changes it' : 'changes nothing' },
        ...scope,
      ],
    };
  }
  if (input.name !== undefined) {
    return { form: 'none', title: input.name, facts: [{ label: 'dropped', value: input.name }, ...scope] };
  }
  return {
    form: 'list',
    items: servers.map((row) => ({
      label: row.name,
      detail: [
        row.status,
        row.status === 'connected' ? `${row.tools} tools` : undefined,
        row.reach.transport === 'stdio' ? row.reach.command : row.reach.url,
        row.failure,
      ]
        .filter((part) => part !== undefined)
        .join(' · '),
    })),
    total: servers.length,
  };
}

export const MCP_PRESENTATION: ModulePresentation = {
  operations: MCP_OPERATION_IDS,
  voice: (answer) => Effect.succeed(mcpText(answer) ?? UNVOICED),
  called: mcpCalledDisplay,
  settled: (input, answer) => {
    const servers = serversOf(answer);
    return servers === null ? mcpCalledDisplay(input as McpInput) : mcpSettledDisplay(input as McpInput, servers);
  },
};
