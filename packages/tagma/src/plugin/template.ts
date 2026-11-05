import sdk from '../../package.json' with { type: 'json' };

export type PluginTemplateInput = { readonly id: string; readonly title: string };

export type PluginTemplateFile = { readonly path: string; readonly text: string };

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export const pluginTemplate = ({ id, title }: PluginTemplateInput): readonly PluginTemplateFile[] => [
  {
    path: 'package.json',
    text: json({
      name: id,
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: { build: 'tagma-plugin build', dev: 'tagma-plugin dev', test: 'bun test' },
      devDependencies: { '@runlith/tagma': `^${sdk.version}`, '@types/bun': '^1.3.0', zod: '^4.2.0' },
    }),
  },
  {
    path: 'tsconfig.json',
    text: json({
      compilerOptions: {
        target: 'ESNext',
        module: 'Preserve',
        moduleResolution: 'bundler',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        verbatimModuleSyntax: true,
        allowImportingTsExtensions: true,
        types: ['bun'],
      },
      include: ['**/*.ts'],
      exclude: ['node_modules', 'dist'],
    }),
  },
  {
    path: 'plugin.ts',
    text: [
      "import { definePlugin, tool } from '@runlith/tagma/plugin';",
      "import { z } from 'zod';",
      '',
      'export default definePlugin({',
      `  id: ${JSON.stringify(id)},`,
      `  title: ${JSON.stringify(title)},`,
      '  tools: {',
      '    hello: tool({',
      "      description: 'Greet someone by name.',",
      "      audience: 'agents',",
      '      readOnly: true,',
      "      input: z.object({ name: z.string().describe('Who to greet') }),",
      '      run: async ({ name }) => `Hello, ${name}!`,',
      '    }),',
      '  },',
      '});',
      '',
    ].join('\n'),
  },
  {
    path: 'plugin.test.ts',
    text: [
      "import { expect, test } from 'bun:test';",
      "import { testPlugin } from '@runlith/tagma/testing';",
      "import plugin from './plugin';",
      '',
      "test('hello greets by name', async () => {",
      "  expect(await testPlugin(plugin).call('hello', { name: 'Ada' })).toEqual({ text: 'Hello, Ada!', isError: false });",
      '});',
      '',
    ].join('\n'),
  },
  {
    path: '.gitattributes',
    text: ['dist/** linguist-generated=true merge=binary', 'tagma-plugin.json linguist-generated=true merge=binary', ''].join('\n'),
  },
  { path: '.gitignore', text: 'node_modules/\n' },
];
