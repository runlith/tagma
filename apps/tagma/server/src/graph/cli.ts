import type { BlocksCli } from './cli/blocks.js';
import type { FilesCli } from './cli/files.js';
import type { LawCli } from './cli/law.js';
import type { ListingsCli } from './cli/listings.js';

type VerbSource = () => Promise<Record<string, unknown>>;

export type GraphCli = BlocksCli & FilesCli & LawCli & ListingsCli;

export const graphVerbs = (binding: () => Promise<GraphCli>) => {
  const blocks: VerbSource = async () => {
    const [verbs, port] = await Promise.all([import('./cli/blocks.js'), binding()]);
    return verbs.blocks(port);
  };
  const files: VerbSource = async () => {
    const [verbs, port] = await Promise.all([import('./cli/files.js'), binding()]);
    return { files: verbs.files(port) };
  };
  const law: VerbSource = async () => {
    const [verbs, port] = await Promise.all([import('./cli/law.js'), binding()]);
    return { law: verbs.law(port) };
  };
  const listings: VerbSource = async () => {
    const [verbs, port] = await Promise.all([import('./cli/listings.js'), binding()]);
    return verbs.listings(port);
  };
  return { law, disable: blocks, enable: blocks, files, trash: blocks, edges: listings, sessions: listings } as const;
};
