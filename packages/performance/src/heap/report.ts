import * as Schema from 'effect/Schema';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { HeapReadOptions } from '../HeapReader.js';
import { heapSummarySchema, type HeapClass, type HeapGrowth, type HeapReport, type HeapSummary } from '../HeapSummary.ts';

export class ReportUnreadable extends Error {}

function previousSummary(file: string): HeapSummary {
  let contents: unknown;
  try {
    contents = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new ReportUnreadable('the previous heap summary file could not be read');
  }
  const decoded = Schema.decodeUnknownResult(heapSummarySchema)(contents);
  if (decoded._tag === 'Failure') throw new ReportUnreadable('the previous heap summary is invalid');
  const summary = decoded.success;
  const names = new Set<string>();
  let count = 0;
  let size = 0;
  for (const row of summary.classes) {
    if (names.has(row.name)) throw new ReportUnreadable('the previous heap summary is invalid');
    names.add(row.name);
    count += row.count;
    size += row.sizeBytes;
  }
  if (count !== summary.objectCount || size !== summary.sizeBytes || summary.detachedNodes > count) {
    throw new ReportUnreadable('the previous heap summary is invalid');
  }
  return summary;
}

export function reportSummary(summary: HeapSummary, options: HeapReadOptions): HeapReport {
  if (!Number.isSafeInteger(options.limit) || options.limit < 1)
    throw new ReportUnreadable('the heap report limit must be a positive integer');
  const previous = options.previous === undefined ? undefined : previousSummary(options.previous);
  const baseline = previous === undefined ? undefined : new Map(previous.classes.map((row) => [row.name, row]));
  const growth: HeapGrowth[] = [];
  const compare = (row: HeapClass): HeapGrowth => {
    const earlier = baseline?.get(row.name);
    return {
      ...row,
      countDelta: baseline === undefined ? null : row.count - (earlier?.count ?? 0),
      sizeDelta: baseline === undefined ? null : row.sizeBytes - (earlier?.sizeBytes ?? 0),
    };
  };
  if (baseline !== undefined) {
    for (const row of summary.classes) {
      const change = compare(row);
      if (change.countDelta! > 0 || change.sizeDelta! > 0) growth.push(change);
    }
    growth.sort((a, b) => b.sizeDelta! - a.sizeDelta! || b.countDelta! - a.countDelta! || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  const partial = `${options.sidecar}.partial`;
  try {
    writeFileSync(partial, JSON.stringify(summary));
    renameSync(partial, options.sidecar);
  } catch {
    try {
      rmSync(partial, { force: true });
    } catch {
      throw new ReportUnreadable('the partial heap summary sidecar could not be removed');
    }
    throw new ReportUnreadable('the heap summary sidecar could not be written');
  }
  return {
    sizeBytes: summary.sizeBytes,
    objectCount: summary.objectCount,
    detachedNodes: summary.detachedNodes,
    classCount: summary.classes.length,
    classes: summary.classes.slice(0, options.limit).map(compare),
    growth: growth.slice(0, options.limit),
  };
}
