export type ToolWords = {
  readonly running: string;
  readonly runningAlone?: string;
  readonly done: string;
  readonly doneAlone?: string;
  readonly many?: (count: number) => string;
};
