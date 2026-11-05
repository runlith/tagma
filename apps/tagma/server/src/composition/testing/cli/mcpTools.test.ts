import { expect, test } from 'bun:test';
import { mcpCatalog } from '../../../cli/mcpTools.js';
import { OPERATIONS_CLI as operationsCli } from '../composed.js';

const served = mcpCatalog(operationsCli).tools('catalog');
const schemaOf = (name: string) =>
  served.find((tool) => tool.name === name)!.inputSchema as Readonly<Record<string, unknown>> & {
    readonly type: 'object';
    readonly properties: Record<string, { enum?: readonly string[]; description?: string }>;
    readonly required?: readonly string[];
  };

test('a union-input operation is served as one flat object a client need not flatten', () => {
  const combinators = served.filter((tool) => ['anyOf', 'oneOf', 'allOf'].some((key) => key in tool.inputSchema)).map((tool) => tool.name);
  expect(combinators).toEqual([]);
});

test('a tool served from a union input names every variant and the keys each one takes', () => {
  for (const name of ['read_performance', 'read_host_performance']) {
    const { properties, required } = schemaOf(name);
    expect(properties['type']?.enum).toEqual(expect.arrayContaining(['ledger', 'stalls', 'load', 'overview']));
    expect(required).toContain('type');
    expect(properties['type']?.description).toMatch(/type overview requires [^;]*\buntil\b/);
    expect(properties['type']?.description).toMatch(/type stalls [^;]*optionally [^;]*\bsince\b/);
    expect(properties['until']?.description).toMatch(/only when type is overview/);
  }
});
