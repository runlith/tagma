import { declare } from './contribution.js';

type Modules = Record<string, Record<string, unknown>>;

export const declared = declare({
  commands: import.meta.glob<Modules[string]>('../**/*.commands.ts', { eager: true }),
  tools: import.meta.glob<Modules[string]>('../**/*.tools.ts', { eager: true }),
  kinds: import.meta.glob<Modules[string]>('../**/*.kinds.{ts,svelte}', { eager: true }),
  composer: import.meta.glob<Modules[string]>('../**/*.composer.svelte', { eager: true }),
  feed: import.meta.glob<Modules[string]>('../**/*.feed.svelte', { eager: true }),
});
