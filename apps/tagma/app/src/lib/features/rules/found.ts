export type Found = {
  readonly key: string;
  readonly at: string | null;
  readonly file: string | null;
  readonly line: number | null;
  readonly said: string | null;
  readonly fix: string | null;
  readonly times: number;
};
