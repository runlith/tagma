import type { ToolCatalog } from '@runlith/agent/catalog';
import { NO_CLAIMS, Tool, ToolFailed, type ToolMedia } from '@runlith/agent/tool';
import { Effect, Schema } from 'effect';
import { HoldStalled, ReentrantCall } from '@runlith/held/failures';
import type { McpCapabilities } from './McpCapabilities';
import { mcpToolCapabilities } from './McpCapabilities';
import { type McpToolIdentity, mcpToolIdentity, mcpToolSubjects } from './McpToolIdentity';
import { mcpDeclarationFingerprint } from './mcpDeclarationFingerprint';
import { redactValue } from './mcpRedactor';
import type { McpFailure } from './McpFailure';
import type { McpServerDeclaration } from './McpServerDeclaration';
import type { McpCallOptions, McpToolDescriptor } from './McpSession';
import type { McpSdkCallResult, McpSdkContent } from './sdk';
import { type McpAppCallResult, mcpAppResource, mcpAppResult, mcpVisibleTo } from './mcpApps';
import { TOOL_OUTPUT_MAX_BYTES } from '@runlith/agent/ToolOutputSpool';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '@runlith/agent/permissions';
import type { ToolDisplayApp } from '@runlith/agent/tool/display';

export type McpToolCaller = {
  call(
    server: string,
    tool: string,
    args: Readonly<Record<string, unknown>>,
    options: McpCallOptions,
  ): Effect.Effect<McpSdkCallResult, McpFailure | HoldStalled | ReentrantCall>;
};

const passThrough = Schema.Record(Schema.String, Schema.Unknown);

const kindOf = (part: McpSdkContent): string => (part.type === 'resource_link' ? 'resource link' : part.type);

const named = (parts: readonly McpSdkContent[]): string => {
  const counted = new Map<string, number>();
  for (const part of parts) counted.set(kindOf(part), (counted.get(kindOf(part)) ?? 0) + 1);
  return [...counted].map(([kind, count]) => (count === 1 ? `1 ${kind}` : `${count} ${kind}s`)).join(', ');
};

export type McpToolAnswer = {
  readonly value: unknown;
  readonly text: string;
  readonly failed: boolean;
  readonly media: readonly ToolMedia[];
};

export function mcpAnswer(result: McpSdkCallResult, redact?: (text: string) => string): McpToolAnswer {
  const scrub = redact ?? ((text: string) => text);
  if (!('content' in result)) {
    const spokenBack =
      result.toolResult === undefined ? 'The server answered nothing.' : JSON.stringify(redactValue(result.toolResult, redact));
    return { value: result.toolResult === undefined ? undefined : spokenBack, text: spokenBack, failed: false, media: [] };
  }
  const spoken = scrub(result.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n'));
  const images = result.content.flatMap((part) => (part.type === 'image' ? [part] : []));
  const media = images.map((part, index) => ({
    bytes: new Uint8Array(Buffer.from(part.data, 'base64')),
    mediaType: part.mimeType,
    label: images.length === 1 ? 'image' : `image ${index + 1}`,
  }));
  const others = result.content.filter((part) => part.type !== 'text' && part.type !== 'image');
  const failed = result.isError === true;
  const structuredContent = result.structuredContent === undefined ? undefined : redactValue(result.structuredContent, redact);
  if (spoken.length > 0) {
    const text = others.length === 0 ? spoken : `${spoken}\n\nThe server also answered ${named(others)}.`;
    const value = structuredContent === undefined ? text : { text, structuredContent };
    return { value, text, failed, media };
  }
  if (structuredContent !== undefined) {
    const text = JSON.stringify(structuredContent);
    return { value: { text, structuredContent }, text, failed, media };
  }
  const text = others.length > 0 ? `The server answered ${named(others)}.` : media.length > 0 ? '' : 'The server answered no content.';
  return { value: text, text, failed, media };
}

const fits = (result: McpAppCallResult): boolean => Buffer.byteLength(JSON.stringify(result), 'utf8') <= TOOL_OUTPUT_MAX_BYTES;

export function mcpViewResult(result: McpSdkCallResult, answered: McpToolAnswer, redact?: (text: string) => string): McpAppCallResult {
  const whole = redactValue(mcpAppResult(result), redact);
  if (fits(whole)) return whole;
  const failed = answered.failed ? { isError: true } : {};
  const structured = whole.structuredContent === undefined ? {} : { structuredContent: whole.structuredContent };
  const spoken: McpAppCallResult = { content: [{ type: 'text', text: answered.text }], ...structured, ...failed };
  if (fits(spoken)) return spoken;
  const clipped = answered.text.slice(0, Math.floor(TOOL_OUTPUT_MAX_BYTES / 6) - 64);
  return { content: [{ type: 'text', text: clipped }], ...failed };
}

export type McpToolCatalogInput = {
  readonly projectId: number | null;
  readonly declaration: McpServerDeclaration;
  readonly descriptors: readonly McpToolDescriptor[];
  readonly pool: McpToolCaller;
  readonly redact?: (text: string) => string;
  readonly apps?: true;
  readonly roots?: readonly string[];
};

export type McpToolExcluded = {
  readonly tool: string;
  readonly reason: string;
};

export type McpServerCatalog = {
  readonly tools: ToolCatalog;
  readonly excluded: readonly McpToolExcluded[];
};

export function mcpToolCatalog(input: McpToolCatalogInput): McpServerCatalog {
  const server = input.declaration.name;
  const capabilities = input.declaration.capabilities;
  const serverIdentity = mcpDeclarationFingerprint(input.declaration);
  const url = input.declaration.transport === 'http' ? input.declaration.url : null;
  const tools: ToolCatalog = Object.create(null) as ToolCatalog;
  const excluded: McpToolExcluded[] = [];
  for (const descriptor of input.descriptors) {
    if (!mcpVisibleTo(descriptor, 'model')) {
      excluded.push({ tool: descriptor.name, reason: 'the tool is not visible to the model' });
      continue;
    }
    if (descriptor.execution?.taskSupport === 'required') {
      excluded.push({
        tool: descriptor.name,
        reason: 'the tool requires task-based execution, which this client does not speak',
      });
      continue;
    }
    const naming = mcpToolIdentity(server, descriptor.name);
    if (naming._tag === 'unnamed') {
      excluded.push({ tool: naming.tool, reason: naming.reason });
      continue;
    }
    const resource = input.apps === true ? mcpAppResource(descriptor) : undefined;
    const tool = descriptor.name;
    tools[descriptor.name] = mcpTool(
      naming.identity,
      serverIdentity,
      url,
      descriptor,
      capabilities,
      input.pool,
      input.projectId,
      input.redact,
      input.roots,
      resource === undefined ? undefined : { server, identity: serverIdentity, resource, tool },
    );
  }
  return { tools, excluded };
}

function mcpTool(
  identity: McpToolIdentity,
  serverIdentity: string,
  url: string | null,
  descriptor: McpToolDescriptor,
  capabilities: McpCapabilities,
  pool: McpToolCaller,
  projectId: number | null,
  redact: ((text: string) => string) | undefined,
  roots: readonly string[] | undefined,
  view: ToolDisplayApp | undefined,
): Tool.Tool {
  const server = identity.server;
  const classification = mcpToolCapabilities(descriptor.name, capabilities);
  const title = descriptor.title ?? descriptor.name;
  const subject = descriptor.title === undefined || descriptor.title === descriptor.name ? undefined : descriptor.title;
  const invocation = classification.mutates
    ? {
        mutates: true as const,
        confirmation: {
          prompt: () => ({ summary: `Call ${title} on the ${server} MCP server.` }),
          confirmLabel: 'Call',
          intent: descriptor.annotations?.destructiveHint === true ? ('destructive' as const) : undefined,
        },
      }
    : { mutates: false as const };
  return Tool.make({
    approval: classification.mutates || classification.kinds.some((kind) => kind !== 'read') ? ASKS_IN_REVIEW : ASKS_NEVER,
    description: descriptor.description ?? `The ${descriptor.name} tool of the ${server} MCP server.`,
    parameters: passThrough,
    inputSchema: descriptor.inputSchema,
    subjects: () => mcpToolSubjects(identity, classification, serverIdentity, url),
    claims: NO_CLAIMS,
    ...invocation,
    display: () => (view === undefined ? { form: 'none' as const, title: subject } : { form: 'none' as const, title: subject, app: view }),
    execute: (args, call) =>
      pool
        .call(server, descriptor.name, args, {
          roots,
          caller: {
            kind: 'agent',
            projectId,
            agentId: call.caller.agentId,
            ownerId: call.caller.ownerId,
            thread: call.caller.thread,
          },
        })
        .pipe(
          Effect.mapError((failure: McpFailure | HoldStalled | ReentrantCall) =>
            failure instanceof HoldStalled
              ? new ToolFailed({
                  reason: `the ${server} MCP server was still reconnecting after ${failure.waitedMs}ms; the call did not run`,
                })
              : failure instanceof ReentrantCall
                ? new ToolFailed({ reason: `the ${server} MCP server was called from inside its own reconnect; the call did not run` })
                : new ToolFailed({ reason: failure.message }),
          ),
          Effect.map((result) => {
            const answered = mcpAnswer(result, redact);
            const shown = view === undefined ? undefined : mcpViewResult(result, answered, redact);
            return new Tool.ToolAnswer(
              answered.value,
              {
                form: 'text',
                text: answered.text,
                title: subject,
                app: view === undefined || shown === undefined ? undefined : { ...view, result: shown },
                opens: answered.media.length > 0 ? true : undefined,
              },
              {
                media: answered.media,
                refusal: answered.failed
                  ? {
                      code: 'failed',
                      reason: answered.text || `The ${server} MCP server answered an error.`,
                      words: `${server} answered an error`,
                    }
                  : undefined,
              },
            );
          }),
        ),
  });
}
