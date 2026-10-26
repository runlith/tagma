export type Runtime = {
  readonly id: string;
  readonly conditions: readonly string[];
  readonly provides: readonly string[];
  readonly builtin: (specifier: string) => string | undefined;
  readonly limitation?: string;
};
