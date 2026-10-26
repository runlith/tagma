export const PATH_CHECKS = 1024;

export type PathCheck<A extends {} | null> = (path: string, signal: AbortSignal) => Promise<A>;

type Checked<A> = { readonly asked: Promise<A>; answer: A | undefined };

export class PathChecks<A extends {} | null> {
  private readonly checked = new Map<string, Checked<A>>();
  private readonly controller = new AbortController();

  constructor(
    private readonly check: PathCheck<A>,
    private readonly limit = PATH_CHECKS,
  ) {}

  get closed(): boolean {
    return this.controller.signal.aborted;
  }

  has(path: string): boolean {
    return this.checked.has(path);
  }

  known(path: string): A | undefined {
    return this.touched(path)?.answer;
  }

  read(path: string): Promise<A> {
    const standing = this.touched(path);
    if (standing !== undefined) return standing.asked;
    const checked: Checked<A> = {
      asked: this.check(path, this.controller.signal).then(
        (found) => {
          checked.answer = found;
          return found;
        },
        (cause: unknown) => {
          if (this.checked.get(path) === checked) this.checked.delete(path);
          throw cause;
        },
      ),
      answer: undefined,
    };
    while (this.checked.size >= this.limit) {
      const oldest = this.checked.keys().next().value;
      if (oldest === undefined) break;
      this.checked.delete(oldest);
    }
    this.checked.set(path, checked);
    return checked.asked;
  }

  close(): void {
    this.controller.abort();
  }

  private touched(path: string): Checked<A> | undefined {
    const standing = this.checked.get(path);
    if (standing === undefined) return undefined;
    this.checked.delete(path);
    this.checked.set(path, standing);
    return standing;
  }
}
