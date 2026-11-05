import { join } from 'node:path';
import { Context, Effect, Result, Stream } from 'effect';
import { ProjectPolicy } from '../graph/contract/service/serving.js';
import { FORMAT_FILE } from '../graph/contract/wire/storage.js';
import { GRAPH_STEPS } from '../graph/steps/sequence.js';
import { resolveStorageLayout, storageHomes } from '../graph/storage/layout.js';
import { markerStep, readMarker } from '../graph/tree/marker.js';
import { previousRelease } from '../installation/closure/versions.js';
import type { NextInstallation } from '../installation/contract/service/next.js';
import type { GraphMarks } from '../installation/contract/service/steps.js';
import type { NextFrame } from '../installation/contract/wire/next.js';
import { stepsCarried } from '../installation/process/returning.js';
import { Projects } from '../projects/contract/service/registry.js';

export const graphMarksOf = (graph: Context.Context<Projects | ProjectPolicy>, storePath: string): GraphMarks => {
  const projects = Context.get(graph, Projects);
  const policy = Context.get(graph, ProjectPolicy);
  const { appHome } = storageHomes(storePath);
  return {
    steps: GRAPH_STEPS.map((step) => step.id),
    marks: Effect.gen(function* () {
      const rows = yield* projects.list();
      const policies = yield* policy.read(rows.map((row) => row.id));
      const marks = yield* Effect.forEach([...policies.values()], (row) =>
        resolveStorageLayout({ mode: row.storage, projectId: row.id, appHome, worktree: row.rootPath }).pipe(
          Effect.flatMap((layout) => readMarker(join(layout.treeRoot, FORMAT_FILE))),
          Effect.map((marker) => [{ project: row.name, step: markerStep(marker) }]),
          Effect.catchTag('StorageLayoutInvalid', () => Effect.succeed([])),
        ),
      );
      return marks.flat();
    }),
  };
};

export const withBackGraphs = (
  next: NextInstallation['Service'],
  installations: string,
  graphs: GraphMarks,
): NextInstallation['Service'] => {
  const carried = new Map<string, ReadonlySet<string>>();
  const named = (frame: NextFrame): Effect.Effect<NextFrame> => {
    const back = frame.back;
    const version = previousRelease(installations);
    if (back === null || version === null) return Effect.succeed(frame);
    const root = join(installations, version);
    const known = carried.get(root) ?? stepsCarried(root, graphs.steps);
    carried.set(root, known);
    return Effect.map(Effect.result(graphs.marks), (read) => {
      if (Result.isFailure(read)) {
        console.error(`[tagma] the step back names no read-only graph: the projects could not be read: ${String(read.failure)}`);
        return frame;
      }
      const readOnlyGraphs = read.success
        .filter((mark) => mark.step !== null && graphs.steps.includes(mark.step) && !known.has(mark.step))
        .map((mark) => mark.project);
      return { ...frame, back: { ...back, readOnlyGraphs } };
    });
  };
  return {
    ...next,
    reading: Effect.flatMap(next.reading, named),
    check: Effect.flatMap(next.check, named),
    changes: Stream.mapEffect(next.changes, named),
  };
};
