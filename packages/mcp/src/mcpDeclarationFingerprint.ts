import { createHash } from 'node:crypto';
import type { McpCapabilities, McpToolCapabilities } from './McpCapabilities';
import type { McpServerDeclaration } from './McpServerDeclaration';

const kinds = (classification: McpToolCapabilities) => [...classification.kinds].sort();

const record = (values: Readonly<Record<string, string>> | undefined) =>
  values === undefined
    ? null
    : Object.keys(values)
        .sort()
        .map((key) => [key, values[key]]);

const capabilities = (declared: McpCapabilities) => ({
  kinds: kinds(declared),
  mutates: declared.mutates,
  tools:
    declared.tools === undefined
      ? null
      : Object.keys(declared.tools)
          .sort()
          .map((tool) => {
            const own = declared.tools?.[tool];
            return [tool, own === undefined ? null : { kinds: kinds(own), mutates: own.mutates }];
          }),
});

const canonical = (declaration: McpServerDeclaration) =>
  JSON.stringify(
    declaration.transport === 'stdio'
      ? {
          name: declaration.name,
          enabled: declaration.enabled,
          timeoutMs: declaration.timeoutMs ?? null,
          maxCatalogBytes: declaration.maxCatalogBytes ?? null,
          capabilities: capabilities(declaration.capabilities),
          transport: 'stdio',
          command: declaration.command,
          args: declaration.args === undefined ? null : [...declaration.args],
          cwd: declaration.cwd ?? null,
          env: record(declaration.env),
        }
      : {
          name: declaration.name,
          enabled: declaration.enabled,
          timeoutMs: declaration.timeoutMs ?? null,
          maxCatalogBytes: declaration.maxCatalogBytes ?? null,
          capabilities: capabilities(declaration.capabilities),
          transport: 'http',
          url: declaration.url,
          headers: record(declaration.headers),
        },
  );

export function mcpDeclarationFingerprint(declaration: McpServerDeclaration): string {
  return createHash('sha256').update(canonical(declaration)).digest('hex');
}
