import { isBuiltin } from 'node:module';
import { isAbsolute, relative } from 'node:path';

type Reached = { readonly source: string; readonly importer: string };

type GuardContext = {
  resolve(source: string, importer: string, options: { readonly skipSelf: boolean }): Promise<{ readonly id: string } | null>;
  getModuleInfo(id: string): { readonly importers: readonly string[] } | null;
  error(message: string): never;
  readonly environment: { readonly config: { readonly root: string } };
};

export const chainOf = (importer: string, importersOf: (id: string) => readonly string[] | undefined, root: string): string[] => {
  const chain = [importer];
  for (let at = importersOf(importer)?.[0]; at !== undefined && !chain.includes(at); at = importersOf(at)?.[0]) chain.push(at);
  return chain.map((id) => relative(root, id));
};

export function browserGuard() {
  const reached = new Map<string, Reached>();
  return {
    name: 'runlith:browser-guard',
    apply: 'build' as const,
    enforce: 'pre' as const,
    applyToEnvironment: (environment: { readonly config: { readonly consumer: string } }) => environment.config.consumer === 'client',
    buildStart() {
      reached.clear();
    },
    async resolveId(this: GuardContext, source: string, importer: string | undefined) {
      if (importer === undefined || !isBuiltin(source)) return null;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      if (resolved === null || !isAbsolute(resolved.id)) reached.set(`${importer}\0${source}`, { source, importer });
      return resolved;
    },
    buildEnd(this: GuardContext, failure?: Error) {
      if (failure !== undefined || reached.size === 0) return;
      const root = this.environment.config.root;
      const lines = [...reached.values()].map(({ source, importer }) => {
        const chain = chainOf(importer, (id) => this.getModuleInfo(id)?.importers, root);
        return `  ${source} is imported by ${chain[0]}\n    chain to the page: ${chain.join(' <- ')}`;
      });
      this.error(`The browser bundle reaches a Node built-in; Vite would ship an empty stub that throws at runtime:\n${lines.join('\n')}`);
    },
  };
}
