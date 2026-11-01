/** @type {import('@sveltejs/kit').Config['compilerOptions']} */
export const compilerOptions = {
  runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true),
  experimental: { async: false },
};
