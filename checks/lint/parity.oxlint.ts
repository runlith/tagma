import { defineConfig } from 'oxlint';
import plugin from './parityPlugin.ts';

export default defineConfig({
  plugins: [],
  categories: { correctness: 'off' },
  options: { respectEslintDisableDirectives: false },
  jsPlugins: ['./parityPlugin.ts'],
  rules: Object.fromEntries(Object.keys(plugin.rules).map((name) => [`runlith-catalog-tags/${name}`, 'error'])),
});
