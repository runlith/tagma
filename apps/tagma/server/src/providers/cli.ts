import type { AuthCli } from './cli/auth.js';

type VerbSource = () => Promise<Record<string, unknown>>;

export const providersVerbs = (binding: () => Promise<AuthCli>): Readonly<{ auth: VerbSource; adapter: VerbSource }> => ({
  auth: async () => {
    const [{ auth }, port] = await Promise.all([import('./cli/auth.js'), binding()]);
    return { auth: auth(port) };
  },
  adapter: async () => {
    const [{ adapter }, port] = await Promise.all([import('./cli/adapter.js'), binding()]);
    return { adapter: adapter(port) };
  },
});
