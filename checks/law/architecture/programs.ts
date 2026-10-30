import { defineProgram } from '@runlith/tagma/rules';
import type { CouplingParams, VendorParams } from './inspections';
import { couplingFindings, measuresOf } from './coupling';
import { moduleOwners } from './snapshot';
import { vendorIndex } from './vendors';
import { indexes } from './indexes';

const held = new Map<string, ReturnType<typeof indexes>>();
const indexAt = (revision: string): ReturnType<typeof indexes> => {
  let index = held.get(revision);
  if (index === undefined) {
    index = indexes(process.cwd(), revision);
    held.set(revision, index);
  }
  return index;
};

export default defineProgram<{
  'vendor-ids': VendorParams;
  coupling: CouplingParams;
}>({
  'vendor-ids': (input) => {
    const read = vendorIndex(process.cwd(), input.tree.commit, input.params, indexAt(input.tree.commit));
    const base = input.base === null ? null : read(input.base);
    const tree = read(input.tree);
    return {
      tree: { covered: 'reach', findings: tree.findings },
      base: base === null ? undefined : { covered: 'reach', findings: base.findings },
    };
  },
  coupling: (input) => {
    const index = indexAt(input.tree.commit);
    const prior = input.base === null ? null : index.coupling(input.base, input.params.aliases);
    const base = prior === null ? null : measuresOf(prior.totals);
    const tree = index.coupling(input.tree, input.params.aliases);
    const paths = new Map<string, string>();
    const owners = [moduleOwners(tree.modules), moduleOwners(prior?.modules ?? [])];
    const cards = new Map(
      [...(prior?.modules ?? []), ...tree.modules].filter((one) => one.card !== undefined).map((one) => [one.card!, one.id]),
    );
    const metadata = input.tree.paths.find(
      (path) => path === 'package.json' || path.endsWith('/package.json') || path.startsWith('.tagma/'),
    );
    for (const path of input.tree.paths) {
      for (const owner of owners) {
        const module = owner(path);
        if (module !== undefined && !paths.has(module.id)) paths.set(module.id, path);
      }
      const id = cards.get(path);
      if (id !== undefined) paths.set(id, path);
    }
    const findings = couplingFindings(measuresOf(tree.totals), input.params, base).map((one) => {
      if (!/:(?:modules|share)-(?:increase|ceiling)$/.test(one.fingerprint)) return one;
      const id = one.fingerprint.slice('coupling:'.length, one.fingerprint.lastIndexOf(':'));
      const path = paths.get(id) ?? metadata;
      return path === undefined ? one : { ...one, path };
    });
    return {
      tree: { covered: 'reach', findings },
      base: base === null ? undefined : { covered: 'reach', findings: couplingFindings(base, input.params, null) },
    };
  },
});
