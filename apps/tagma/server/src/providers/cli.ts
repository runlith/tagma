import type { AuthCli } from './cli/auth.js';

export const providersVerbs = (binding: () => Promise<AuthCli>) => ({
  auth: async () => {
    const [{ auth }, port] = await Promise.all([import('./cli/auth.js'), binding()]);
    return { auth: auth(port) };
  },
});
