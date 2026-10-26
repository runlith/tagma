export class ConcurrencyGate {
  private ceiling: number;
  private active = 0;
  private waiters: (() => void)[] = [];

  constructor(limit: number) {
    this.ceiling = requireLimit(limit);
  }

  get limit(): number {
    return this.ceiling;
  }

  set limit(limit: number) {
    this.ceiling = requireLimit(limit);
    while (this.active < this.ceiling && this.waiters.length > 0) {
      this.active += 1;
      this.waiters.shift()?.();
    }
  }

  readonly admit = async <T>(work: () => Promise<T>): Promise<T> => {
    if (this.active >= this.ceiling) await new Promise<void>((resolve) => this.waiters.push(resolve));
    else this.active += 1;
    try {
      return await work();
    } finally {
      this.release();
    }
  };

  private release(): void {
    if (this.active > this.ceiling) {
      this.active -= 1;
      return;
    }
    const next = this.waiters.shift();
    if (next) next();
    else this.active -= 1;
  }
}

function requireLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`A concurrency gate needs an integer limit of at least 1, got ${limit}.`);
  }
  return limit;
}

export async function mapConcurrent<TInput, TOutput>(
  items: readonly TInput[],
  limit: number,
  work: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (limit < 1) throw new Error(`mapConcurrent needs a limit of at least 1, got ${limit}.`);
  const results = new Array<TOutput>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index] as TInput, index);
    }
  });
  await Promise.all(workers);
  return results;
}
