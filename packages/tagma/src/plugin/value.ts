export type ToolResult = {
  readonly text: string;
  readonly structuredContent?: Readonly<Record<string, unknown>>;
};

export const toolResultOf = (value: unknown): ToolResult => {
  if (value === undefined) return { text: '', structuredContent: {} };
  if (typeof value === 'string') return { text: value };
  return { text: JSON.stringify(value) ?? String(value), structuredContent: { value } };
};

export const toolValueOf = (text: string, structuredContent?: unknown): unknown =>
  typeof structuredContent === 'object' && structuredContent !== null && !Array.isArray(structuredContent)
    ? (structuredContent as { readonly value?: unknown }).value
    : text;
