import { createHash } from 'node:crypto';
import { Result, Schema } from 'effect';
import type { Finding, Side } from '@runlith/tagma/rules';
import { ProgramFinding } from '@tagma/inspection/program';
import { isManifest, movedPackages } from '../../declarations/corpus';
import { blobTexts } from '../../git';
import {
  blobsAt,
  changesBetween,
  type Change,
  FAR,
  GOOD_ENOUGH,
  importersByName,
  importersOf,
  manifestsAt,
  prepare,
} from '../../declarations/index';
import { revisionAt, saveRevision } from '../../declarations/memo';
import { versionAt } from '../cache';
import { production, snapshots, within } from '../snapshot';
import { type Analysis, callAnalysis, callFrontier, carrying, type Importers } from './analysis';
import type { CallParams } from './params';
import { inRegion, type World, worldOf } from './world';

const record = Schema.Struct({ findings: Schema.Array(ProgramFinding), carriers: Schema.Array(Schema.String) });
const revisions = Schema.Array(Schema.String);

const KEPT = 6;

const sorted = (findings: readonly Finding[]): readonly Finding[] =>
  [...findings].sort((left, right) => (left.path === right.path ? (left.line ?? 0) - (right.line ?? 0) : left.path < right.path ? -1 : 1));

const side = (commit: string, whole: boolean, paths: readonly string[] = []): Side => ({
  commit,
  whole,
  paths,
  read: async () => null,
  facts: null,
});

export const judgements = (root: string, params: CallParams, versionRevision: string) => {
  const signature = createHash('sha1').update(JSON.stringify(params)).digest('hex').slice(0, 16);
  const prefix = `calls:${versionAt(root, versionRevision)}:${signature}`;
  const snapshot = snapshots(root);
  const recentKey = `${prefix}:recent`;

  const recent = (): readonly string[] => {
    const decoded = Schema.decodeUnknownResult(revisions)(revisionAt(root, recentKey));
    return Result.isFailure(decoded) ? [] : decoded.success;
  };

  const held = (commit: string): Analysis | undefined => {
    const decoded = Schema.decodeUnknownResult(record)(revisionAt(root, `${prefix}:${commit}`));
    return Result.isFailure(decoded) ? undefined : (decoded.success as Analysis);
  };

  const save = (commit: string, one: Analysis): Analysis => {
    saveRevision(root, `${prefix}:${commit}`, one);
    saveRevision(root, recentKey, [commit, ...recent().filter((entry) => entry !== commit)].slice(0, KEPT));
    return one;
  };

  const importersAcross =
    (...revisionsOf: readonly string[]): Importers =>
    (targets) => {
      const found = new Set<string>();
      for (const revision of new Set(revisionsOf))
        for (const one of importersOf(root, revision, targets, manifestsAt(root, revision), params.aliases, production))
          found.add(one.path);
      return [...found];
    };

  const batched = (world: World, revision: string): World => {
    const texts = new Map<string, string | undefined>();
    return {
      ...world,
      prefetch: (wanted) => {
        const need = [...new Set(wanted)].filter((path) => !texts.has(path));
        if (need.length === 0) return;
        const blobs = blobsAt(root, revision, need);
        const loaded = blobTexts(root, [...new Set(blobs.values())]);
        for (const path of need) texts.set(path, blobs.has(path) ? loaded.get(blobs.get(path)!) : undefined);
      },
      read: (path) => (texts.has(path) ? texts.get(path) : world.read(path)),
    };
  };

  const whole = (commit: string): Analysis => {
    const known = held(commit);
    if (known !== undefined) return known;
    prepare(root, commit, null);
    const packages = manifestsAt(root, commit);
    const view = snapshot(side(commit, true), ['']);
    const analysis = callAnalysis(worldOf(view, { packages, aliases: params.aliases }), params, undefined, importersAcross(commit));
    return save(commit, { findings: sorted(analysis.findings), carriers: [...analysis.carriers].sort() });
  };

  const nearest = (commit: string): { readonly revision: string; readonly one: Analysis; readonly changes: readonly Change[] } => {
    let best: { readonly revision: string; readonly one: Analysis; readonly changes: readonly Change[] } | undefined;
    for (const revision of recent()) {
      const one = held(revision);
      if (one === undefined) continue;
      const changes = changesBetween(root, revision, commit);
      if (best === undefined || changes.length < best.changes.length) best = { revision, one, changes };
      if (changes.length < GOOD_ENOUGH) break;
    }
    if (best === undefined || best.changes.length > FAR)
      throw new Error(
        `no cached ask-calls findings within ${FAR} changed files of ${commit}; build them with check_rules over "all" for the ask-calls rule, then judge the change again`,
      );
    return best;
  };

  const derive = (commit: string): Analysis => {
    const { revision, one: standing, changes } = nearest(commit);
    prepare(root, commit, revision);
    const universe = (path: string): boolean => production(path) && (inRegion(path, params) || within(path, 'packages'));
    const touched = changes.filter((change) => universe(change.path));
    const before = manifestsAt(root, revision);
    const after = manifestsAt(root, commit);
    const moved = movedPackages(before, after);
    if (touched.length === 0 && moved.before.length === 0 && moved.after.length === 0 && !changes.some((change) => isManifest(change.path)))
      return save(commit, standing);
    const names = [...new Set([...moved.before, ...moved.after].map((entry) => entry.name))];
    const seeds = new Set(touched.map((change) => change.path));
    if (names.length > 0)
      for (const at of new Set([revision, commit])) for (const entry of importersByName(root, at, names, universe)) seeds.add(entry.path);
    const forced = new Set(touched.filter((change) => change.before === null || change.after === null).map((change) => change.path));
    const view = (at: string, existing: (change: Change) => boolean) => {
      const scope = [...new Set([...seeds, ...touched.filter(existing).map((change) => change.path)])];
      return snapshot(side(at, false, scope), scope.length === 0 ? ['package.json'] : scope);
    };
    const catalogBefore = { packages: before, aliases: params.aliases };
    const catalogAfter = { packages: after, aliases: params.aliases };
    const beforeWorld = batched(
      worldOf(
        view(revision, (change) => change.before !== null),
        catalogBefore,
      ),
      revision,
    );
    const afterWorld = batched(
      worldOf(
        view(commit, (change) => change.after !== null),
        catalogAfter,
      ),
      commit,
    );
    const known = new Set(standing.carriers);
    const affected = callFrontier(beforeWorld, afterWorld, params, [...seeds], importersAcross(revision, commit), forced, known);
    const existing = affected.filter((path) => afterWorld.read(path) !== undefined);
    const judged = existing.filter((path) => inRegion(path, params));
    const relevant = new Set([...known, ...affected]);
    const analysis = callAnalysis({ ...afterWorld, paths: judged }, params, judged, undefined, relevant);
    const moving = new Set(affected);
    const carriers = [...standing.carriers.filter((path) => !moving.has(path)), ...carrying(afterWorld, params, existing, relevant)];
    return save(commit, {
      findings: sorted([...standing.findings.filter((entry) => !moving.has(entry.path)), ...analysis.findings]),
      carriers: [...new Set(carriers)].sort(),
    });
  };

  const at = (commit: string): Analysis => held(commit) ?? derive(commit);

  return { whole, at, save };
};
