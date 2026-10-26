export type McpResourceDescriptor = {
  readonly uri: string;
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly size?: number;
  readonly _meta?: Readonly<Record<string, unknown>>;
};

export type McpResourcePage = {
  readonly resources: readonly McpResourceDescriptor[];
  readonly nextCursor?: string;
  readonly _meta?: Readonly<Record<string, unknown>>;
};

export type McpResourceContent = {
  readonly uri: string;
  readonly mimeType?: string;
  readonly _meta?: Readonly<Record<string, unknown>>;
} & ({ readonly text: string } | { readonly blob: string });

export type McpResourceResult = {
  readonly contents: readonly McpResourceContent[];
  readonly _meta?: Readonly<Record<string, unknown>>;
};

export type McpResourceUpdated = {
  readonly uri: string;
  readonly _meta?: Readonly<Record<string, unknown>>;
};
