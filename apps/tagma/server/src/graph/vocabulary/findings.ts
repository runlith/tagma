import type { CatalogFinding } from '../contract/wire/tags/findings.js';
import type { UpgradeBlocked } from '../contract/wire/tags/declaration.js';
import type { Forbidden, Stale } from './layers.js';

export type Subject =
  | { readonly kind: 'type'; readonly catalog: string; readonly name: string; readonly key: string; readonly export: string }
  | { readonly kind: 'guidance'; readonly catalog: string; readonly name: string };

const said = (subject: Subject): string =>
  subject.kind === 'type'
    ? `#${subject.key} [[${subject.name}]] of catalog ${subject.catalog}`
    : `Catalog ${subject.catalog} [[${subject.name}]]`;

const forkOf = (subject: Subject, at: string): string =>
  JSON.stringify(subject.kind === 'type' ? { library: subject.catalog, export: subject.export, at } : { at });

export function conflictFinding(subject: Subject, reason: string, shipped: string, revision: string): CatalogFinding {
  const restore =
    subject.kind === 'type'
      ? "give it the shipped declaration back — its shipped fields, edges and gates, and as body the shipped text, optionally followed by this project's part"
      : "write the shipped guidance back, optionally followed by this project's part";
  return {
    catalog: subject.catalog,
    name: subject.name,
    kind: 'migration-conflict',
    text: `${said(subject)} keeps ${subject.kind === 'type' ? 'its local declaration' : 'its local guidance'}: ${reason}; its shipped updates stop. Resolve it one way: ${restore}, which becomes its \`project\` section; or keep it as a fork by setting its fork field to ${forkOf(subject, revision)}. read_tags prints the shipped text.`,
    shipped,
  };
}

export function forkFinding(subject: Subject, at: string, now: string, shipped: string): CatalogFinding {
  return {
    catalog: subject.catalog,
    name: subject.name,
    kind: 'fork',
    text: `${said(subject)} is a fork taken at ${at}, and its shipped ${subject.kind === 'type' ? 'declaration' : 'text'} has changed since. read_tags prints the shipped text: take what this project needs and set its fork field to ${forkOf(subject, now)}, or write the shipped text back.`,
    shipped,
  };
}

export function staleFinding(subject: Subject, stale: readonly Stale[], shipped: string): CatalogFinding {
  const edits = stale.map(
    (one) => `${one.edit}s section "${one.section}", which the shipped text ${one.reason === 'changed' ? 'changed' : 'removed'}`,
  );
  return {
    catalog: subject.catalog,
    name: subject.name,
    kind: 'layer-stale',
    text: `${said(subject)}: its layer ${edits.join('; ')} since the layer was written. Write the layer again over the current section, change it, or write the shipped text back.`,
    shipped,
  };
}

export function closedFinding(subject: Subject, forbidden: readonly Forbidden[], shipped: string, revision: string): CatalogFinding {
  return {
    catalog: subject.catalog,
    name: subject.name,
    kind: 'upgrade-blocked',
    text: `${said(subject)}: its layer edits what the shipped text now closes: ${forbidden.map((one) => one.reason).join('; ')}. The shipped upgrade is refused while it stands: drop those edits from its layer, keep it as a fork by setting its fork field to ${forkOf(subject, revision)}, or write the shipped text back.`,
    shipped,
  };
}

export function blockedFinding(catalog: string, name: string, blocked: UpgradeBlocked): CatalogFinding {
  return {
    catalog,
    name,
    kind: 'upgrade-blocked',
    text: `Catalog ${catalog} [[${name}]]: its automatic upgrade was refused (${blocked.code}): ${blocked.reason}. The previous release stays in force; correct what the reason names, and the next graph start installs the upgrade.`,
  };
}
