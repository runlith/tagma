import type { Coverage, Covered } from './coverage.ts';
import { acts, editOf, script, type Edit } from './edits.ts';
import { sourceFile, testFile, type Graph } from './graph.ts';

export type Verdict = { readonly keep: boolean; readonly why: string };

export class Narrowing {
  private readonly closures = new Map<string, ReadonlySet<string>>();
  private readonly threads = new Map<string, ReadonlySet<string>>();
  private readonly open = new Map<string, boolean>();
  private readonly edits = new Map<string, Edit>();
  private readonly acting = new Map<string, boolean>();
  private readonly ranges = new Map<string, readonly (readonly [number, number])[]>();

  constructor(
    private readonly graph: Graph,
    private readonly coverage: Coverage,
  ) {}

  private current(path: string): string | undefined {
    return this.graph.files.has(path) ? this.graph.text(path) : undefined;
  }

  private closure(file: string): ReadonlySet<string> {
    let closure = this.closures.get(file);
    if (closure === undefined) {
      closure = new Set(this.graph.closure(file).inputs.filter(sourceFile));
      this.closures.set(file, closure);
    }
    return closure;
  }

  private unsettled(main: string): boolean {
    let unsettled = this.open.get(main);
    if (unsettled === undefined) {
      unsettled = !this.graph.files.has(main) || this.graph.closure(main).uncertain.length > 0;
      this.open.set(main, unsettled);
    }
    return unsettled;
  }

  private offThread(file: string): ReadonlySet<string> {
    let threaded = this.threads.get(file);
    if (threaded === undefined) {
      threaded = this.graph.offThread(file);
      this.threads.set(file, threaded);
    }
    return threaded;
  }

  private edit(path: string, stamp: string): Edit | undefined {
    const key = `${path}\0${stamp}`;
    let edit = this.edits.get(key);
    if (edit === undefined) {
      const before = this.coverage.text(stamp);
      if (before === undefined) return undefined;
      edit = editOf(path, before, this.current(path));
      this.edits.set(key, edit);
    }
    return edit;
  }

  private acts(path: string, text: string | undefined): boolean {
    const key = `${path}\0${text === undefined ? '' : Bun.hash(text)}`;
    let acting = this.acting.get(key);
    if (acting === undefined) {
      acting = text === undefined || acts(path, text);
      this.acting.set(key, acting);
    }
    return acting;
  }

  private executed(lines: string): readonly (readonly [number, number])[] {
    let ranges = this.ranges.get(lines);
    if (ranges === undefined) {
      ranges =
        lines === ''
          ? []
          : lines.split(',').map((part) => {
              const [from, to] = part.split('-').map(Number) as [number, number | undefined];
              return [from, to ?? from] as const;
            });
      this.ranges.set(lines, ranges);
    }
    return ranges;
  }

  private hit(lines: string, edit: Edit): string | undefined {
    if (edit.kind === 'inert') return undefined;
    if (edit.kind === 'load') return `line ${edit.at}: ${edit.why}`;
    const ranges = this.executed(lines);
    for (const span of edit.spans) {
      let low = 0;
      let high = ranges.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (ranges[middle]![1] < span.from) low = middle + 1;
        else high = middle;
      }
      if (low < ranges.length && ranges[low]![0] <= span.to) return `line ${span.at} changed where this file executed`;
    }
    return undefined;
  }

  judge(test: string, reached: readonly string[]): Verdict {
    const covered = this.coverage.of(test);
    if (covered === undefined) return { keep: true, why: 'no coverage map' };
    return (
      this.within(test, covered, reached) ?? {
        keep: false,
        why: `coverage map of ${new Date(covered.at).toISOString()} (run ${covered.run.slice(0, 8)}) executed none of the changed lines`,
      }
    );
  }

  private within(test: string, covered: Covered, reached: readonly string[]): Verdict | undefined {
    for (const path of reached) if (!script(path)) return { keep: true, why: `${path} is not a JS or TS source` };
    for (const path of reached) if (this.offThread(test).has(path)) return { keep: true, why: `${path} runs in a Worker this file starts` };
    if (reached.length > 0 && covered.opaque.length > 0)
      return { keep: true, why: `a child process ran ${covered.opaque[0]}, which the map cannot see into` };
    for (const path of reached)
      if (covered.bundled.has(path)) return { keep: true, why: `${path} is bundled into code a child process ran` };
    for (const main of covered.mains) {
      const reach = this.graph.files.has(main) ? this.closure(main) : undefined;
      const path = reached.find((one) => reach === undefined || reach.has(one) || this.unsettled(main));
      if (path !== undefined) return { keep: true, why: `${path} may load in a child process running ${main}` };
    }
    const now = this.closure(test);
    for (const path of reached)
      if (!testFile(path) && !now.has(path) && !covered.closure.has(path) && !covered.loaded.has(path))
        return { keep: true, why: `${path} is outside this file's import closure, so the map cannot tell how the file uses it` };
    const named = new Set(reached);
    const order = [...covered.loaded].sort(([left], [right]) => Number(named.has(right)) - Number(named.has(left)));
    for (const [path, { stamp, lines }] of order) {
      if (this.graph.files.has(path) && this.graph.stamp(path) === stamp) continue;
      const edit = this.edit(path, stamp);
      const hit = edit === undefined ? 'the text the map ran is no longer stored' : this.hit(lines, edit);
      if (hit === undefined) continue;
      return named.has(path) ? { keep: true, why: `${path} ${hit}` } : { keep: true, why: `stale coverage map: ${path} ${hit}` };
    }
    for (const [path, { stamp }] of covered.loaded)
      if (covered.closure.has(path) && !now.has(path) && this.acts(path, this.coverage.text(stamp)))
        return { keep: true, why: `${path} left the import closure and acted at load` };
    for (const path of now)
      if (!covered.closure.has(path) && this.acts(path, this.current(path)))
        return { keep: true, why: `import closure gained ${path}, which acts at load` };
    return undefined;
  }
}
