import { isManifest, listedPackages, type Package, packageOf, productionOf, type Reach, type WholeCorpus } from './corpus';
import type { Facts } from './facts';
import { factsOf } from './read';

export type Sources = Readonly<Record<string, string>> | ReadonlyMap<string, string>;

export const corpusOf = (sources: Sources, reach: Reach): WholeCorpus => {
  const production = productionOf(reach);
  const facts = new Map<string, Facts>();
  const packages: Package[] = [];
  for (const [path, text] of sources instanceof Map ? sources : Object.entries(sources)) {
    if (isManifest(path)) {
      const found = packageOf(path, text);
      if (found !== undefined) packages.push(found);
    } else if (production(path)) facts.set(path, factsOf(path, text));
  }
  return { facts, packages: listedPackages(packages) };
};
