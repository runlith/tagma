import { createHash } from 'node:crypto';
import type { Finding, Side } from '@runlith/tagma/rules';
import { changesBetween, GOOD_ENOUGH, prepare } from '../declarations/index';
import { present } from '../git';
import { lastVendors, readVendors, saveVendors, versionAt, type VendorIndex } from './cache';
import type { indexes } from './indexes';
import type { VendorParams } from './inspections';
import { indexLiterals, literalCandidates } from './literals';
import { production, selectSources, type Snapshot } from './snapshot';
import { isVendorSource, vendorFindings } from './strings';

const wordOf = (finding: Finding): string => finding.fingerprint.slice(7, finding.fingerprint.indexOf(':', 7));
const ordered = (findings: readonly Finding[]): readonly Finding[] =>
  [...findings].sort((a, b) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0) || a.fingerprint.localeCompare(b.fingerprint));

export const vendorIndex = (root: string, revision: string, params: VendorParams, index: ReturnType<typeof indexes>) => {
  const version = versionAt(root, revision);
  const signature = createHash('sha256')
    .update(JSON.stringify([params.source, params.exclude]))
    .digest('hex');
  const prefix = `architecture:${version}:vendors:${signature}`;
  const known = new Map<string, VendorIndex>();
  let recent: VendorIndex | undefined;
  const scan = (snapshot: Snapshot, words: readonly string[]): readonly Finding[] =>
    snapshot.paths.flatMap((path) => {
      const file = selectSources(snapshot, [path]);
      indexLiterals(root, version, file, params);
      return vendorFindings(file, params, words);
    });
  return (side: Side): VendorIndex => {
    const key = `${prefix}:${side.commit}`;
    const held = known.get(key) ?? (side.whole ? undefined : readVendors(root, key));
    if (held !== undefined) {
      recent = held;
      return held;
    }
    if (side.whole) {
      prepare(root, side.commit, null);
      const words = index.words(side);
      const findings = ordered(scan(index.snapshot(side, [params.source]), words));
      const result = { revision: side.commit, words, findings };
      saveVendors(root, prefix, result);
      known.set(key, result);
      recent = result;
      return result;
    }
    const previous = recent ?? lastVendors(root, prefix);
    if (previous === undefined || !present(root, [previous.revision]).has(previous.revision))
      throw new Error(
        'vendor-ids has no revision index; run check_rules over all with inspection vendor-ids to remeasure before judging a change',
      );
    const changes = changesBetween(root, previous.revision, side.commit);
    if (changes.filter((one) => production(one.path)).length > Math.max(GOOD_ENOUGH, side.paths.filter(production).length))
      throw new Error(
        'vendor-ids has no nearby revision index; run check_rules over all with inspection vendor-ids to remeasure before judging a change',
      );
    prepare(root, side.commit, previous.revision);
    const paths = changes.map((one) => one.path);
    const words = index.words({ ...side, paths }, previous.revision);
    const beforeWords = new Set(previous.words);
    const nowWords = new Set(words);
    const added = words.filter((word) => !beforeWords.has(word));
    const removed = new Set(previous.words.filter((word) => !nowWords.has(word)));
    const affected = new Set(paths.filter((path) => production(path) && isVendorSource(path, params)));
    if (affected.size > 0) {
      const changed = index.snapshot({ ...side, paths: [...affected], whole: false });
      for (const path of changed.paths) indexLiterals(root, version, selectSources(changed, [path]), params);
    }
    for (const path of literalCandidates(root, version, side.commit, added))
      if (production(path) && isVendorSource(path, params)) affected.add(path);
    for (const finding of previous.findings) if (removed.has(wordOf(finding))) affected.add(finding.path);
    const retained = previous.findings.filter((one) => !affected.has(one.path));
    const fresh = affected.size === 0 ? [] : scan(index.snapshot({ ...side, paths: [...affected], whole: false }), words);
    const findings = ordered([...retained, ...fresh]);
    const result = { revision: side.commit, words, findings };
    saveVendors(root, prefix, result);
    known.set(key, result);
    recent = result;
    return result;
  };
};
