import { expect, test } from 'bun:test';
import type { Tree } from '@runlith/code-facts/tree';
import { checked } from './checks';
import { uiTokens as declared } from './ui-tokens/declaration';
import { uiTokens } from './ui-tokens/implementation';

const params = {
  base: '',
  region: ['src/'],
  files: { extensions: ['.svelte', '.ts', '.css'], exclude: ['**/*.test.ts'] },
  allow: {
    text: ['ui', 'body'],
    textColors: ['foreground'],
    rounded: ['none', 'sm', 'md', 'lg', 'full'],
    shadow: ['none', 'raised', 'float'],
    spacing: ['0', '1', '2', '4', 'auto'],
    icon: ['3', '3.5', '4'],
    stateBackgrounds: ['hover', 'selected', 'hover-danger'],
  },
  icons: ['@lucide/svelte'],
  literals: [{ path: 'src/tokens.css', why: 'token file' }],
  casing: [{ path: 'src/mono/', why: 'monospace identifiers read in capitals' }],
};

const judge = (files: Readonly<Record<string, string>>) => {
  const tree: Tree = { has: (path) => Object.hasOwn(files, path), read: (path) => files[path]! };
  const check = checked(declared.params, uiTokens, params);
  const paths = Object.keys(files).filter((path) => check.selects(path));
  return check.read(tree, paths, [], { get: () => undefined, set: () => undefined }, 'reach').violations;
};

const fingerprints = (files: Readonly<Record<string, string>>) => judge(files).map((one) => one.fingerprint);

test('classes and colours outside the standard refuse with a stable fingerprint, file and line', () => {
  const violations = judge({
    'src/Bad.svelte': [
      '<script lang="ts">',
      "  import X from '@lucide/svelte/icons/x';",
      "  const tone = cn('rounded-xl');",
      '</script>',
      '',
      '<div class="text-[13px] p-2.5 shadow-lg rounded">',
      '  <X />',
      '  <p style="color: #ff0000" class="text-sm">hi</p>',
      '</div>',
      '',
    ].join('\n'),
    'src/panel.css': '.panel { @apply rounded-2xl; background: rgb(1, 2, 3); }\n',
  });
  expect(violations.map((one) => [one.fingerprint, one.file, one.line])).toEqual([
    ['src/Bad.svelte rounded-xl', 'src/Bad.svelte', 3],
    ['src/Bad.svelte text-[13px]', 'src/Bad.svelte', 6],
    ['src/Bad.svelte p-2.5', 'src/Bad.svelte', 6],
    ['src/Bad.svelte shadow-lg', 'src/Bad.svelte', 6],
    ['src/Bad.svelte rounded', 'src/Bad.svelte', 6],
    ['src/Bad.svelte text-sm', 'src/Bad.svelte', 8],
    ['src/Bad.svelte icon X', 'src/Bad.svelte', 7],
    ['src/Bad.svelte colour #ff0000', 'src/Bad.svelte', 8],
    ['src/panel.css rounded-2xl', 'src/panel.css', 1],
    ['src/panel.css colour rgb(1, 2, 3)', 'src/panel.css', 1],
  ]);
});

test('names inside the standard and files outside the region pass', () => {
  expect(
    fingerprints({
      'src/Good.svelte': [
        '<script lang="ts">',
        "  import X from '@lucide/svelte/icons/x';",
        '</script>',
        '',
        '<div class={cn(open && "shadow-raised", "text-ui rounded-md p-4 mx-auto bg-accent hover:bg-hover hover:text-foreground hover:bg-cover data-[state=open]:bg-selected")}>',
        '  <X class="size-3.5" />',
        '</div>',
        '',
      ].join('\n'),
      'outside/Bad.svelte': '<div class="text-[13px] rounded-xl"></div>',
    }),
  ).toEqual([]);
});

test('a palette file holds literals and every other family still applies there', () => {
  expect(fingerprints({ 'src/tokens.css': ':root { --a: #123456; padding: 12px; }\n.x { @apply shadow-xl; }\n' })).toEqual([
    'src/tokens.css shadow-xl',
  ]);
});

const closed: readonly (readonly [string, Readonly<Record<string, string>>, string[]])[] = [
  [
    'literal lengths in stylesheets, style blocks and inline styles',
    {
      'src/Box.svelte':
        '<div style="gap: 8px; margin: 0"></div>\n<style>.a { font-size: 14px; padding: 0 4px; border-radius: var(--radius-md); gap: 1px }</style>\n',
      'src/box.css':
        '.b { box-shadow: 0 4px 12px var(--x); top: calc(var(--spacing) * 2) }\n.r { box-shadow: 0 0 0 2px var(--x), inset 0 0 0 1px var(--y) }\n',
    },
    [
      'src/Box.svelte font-size: 14px',
      'src/Box.svelte padding: 0 4px',
      'src/Box.svelte gap: 8px',
      'src/box.css box-shadow: 0 4px 12px var(--x)',
    ],
  ],
  [
    'class directives',
    { 'src/Dir.svelte': '<div class:rounded class:text-sm={open} class:flex></div>' },
    ['src/Dir.svelte rounded', 'src/Dir.svelte text-sm'],
  ],
  [
    'bare names in class helpers and objects',
    {
      'src/helper.ts':
        "export const a = cn('flex', { rounded: on, 'shadow': off, flex: x });\nexport const b = tv({ base: 'rounded', variants: { rounded: { yes: 'p-2' } } });\n",
    },
    ['src/helper.ts rounded', 'src/helper.ts shadow', 'src/helper.ts rounded #2'],
  ],
  [
    'arbitrary properties',
    { 'src/Arb.svelte': '<div class="[font-size:19px] hover:[padding:7px] [--x:3px] [mask-type:alpha]"></div>' },
    ['src/Arb.svelte [font-size:19px]', 'src/Arb.svelte hover:[padding:7px]'],
  ],
  [
    'unknown text names',
    { 'src/Text.svelte': '<p class="text-h3 text-foreground/70 text-center text-body"></p>' },
    ['src/Text.svelte text-h3'],
  ],
  [
    'palette and named colours',
    {
      'src/Hue.svelte':
        '<p class="bg-red-500 text-black/50 border-white"></p>\n<style>.c { color: red; background: transparent; border: 1px solid currentColor }</style>',
    },
    ['src/Hue.svelte bg-red-500', 'src/Hue.svelte text-black/50', 'src/Hue.svelte border-white', 'src/Hue.svelte color: red'],
  ],
  [
    'namespace icons',
    {
      'src/Ns.svelte': '<script>import * as Icons from \'@lucide/svelte\';</script>\n<Icons.X />\n<Icons.Check class="size-4" />',
    },
    ['src/Ns.svelte icon Icons.X'],
  ],
  [
    'composed class names',
    { 'src/Mix.ts': "export const c = cn(`text-${size}`, 'p-' + n, 'gap-' + g);\n" },
    ['src/Mix.ts text-', 'src/Mix.ts p-', 'src/Mix.ts gap-'],
  ],
  [
    'an icon size read from another attribute',
    {
      'src/Aria.svelte':
        '<script>import X from \'@lucide/svelte/icons/x\';</script>\n<X aria-label="size-4" />\n<X aria-label="size-8" class="size-4" />',
    },
    ['src/Aria.svelte icon X'],
  ],
  [
    'backgrounds outside the state tokens under state variants',
    {
      'src/State.svelte':
        '<div class="bg-accent hover:bg-accent/60 group-hover:bg-muted data-[highlighted]:bg-accent aria-selected:bg-hover/50 dark:data-selected:bg-red-500 hover:bg-hover-danger"></div>',
    },
    [
      'src/State.svelte hover:bg-accent/60',
      'src/State.svelte group-hover:bg-muted',
      'src/State.svelte data-[highlighted]:bg-accent',
      'src/State.svelte aria-selected:bg-hover/50',
      'src/State.svelte dark:data-selected:bg-red-500',
    ],
  ],
  [
    'uppercase and tracking',
    { 'src/Caps.svelte': '<p class="uppercase tracking-wide text-ui hover:tracking-[0.1em]">X</p>' },
    ['src/Caps.svelte uppercase', 'src/Caps.svelte tracking-wide', 'src/Caps.svelte hover:tracking-[0.1em]'],
  ],
  [
    'uppercase and letter spacing in declarations',
    {
      'src/Decl.svelte':
        '<p style="text-transform: uppercase; letter-spacing: 0.05em"></p>\n<style>.a { text-transform: none; letter-spacing: normal; --x--letter-spacing: 1px }</style>',
      'src/decl.css': '.b { letter-spacing: -0.01em; text-transform: uppercase }\n',
      'src/tokens.css': '.c { letter-spacing: 1px }\n',
    },
    [
      'src/Decl.svelte text-transform: uppercase',
      'src/Decl.svelte letter-spacing: 0.05em',
      'src/decl.css letter-spacing: -0.01em',
      'src/decl.css text-transform: uppercase',
      'src/tokens.css letter-spacing: 1px',
    ],
  ],
  ['a hex colour in a declaration value', { 'src/hex.css': '#abc { color: #abc }\n' }, ['src/hex.css colour #abc']],
];

for (const [name, files, expected] of closed) {
  test(`refuses ${name}`, () => {
    expect(fingerprints(files)).toEqual(expected);
  });
}

test('prose, URLs, ids, commented-out rules and variant names pass', () => {
  expect(
    fingerprints({
      'src/prose.ts': [
        "export const note = 'Use text-sm in this example';",
        "export const link = 'https://example.test/p-4/shadow';",
        "export const kind = 'rounded';",
        "export const spaced = 'use rounded here';",
        '',
      ].join('\n'),
      'src/Link.svelte': '<a href="#abc" id="fff">jump</a>\n',
      'src/ids.css': '#abc { color: var(--foreground) }\n/* .x { @apply rounded-xl; padding: 9px } */\n',
    }),
  ).toEqual([]);
});

test('a named casing place may use uppercase and tracking while every other family still applies there', () => {
  expect(
    fingerprints({
      'src/mono/Id.svelte': '<code class="uppercase tracking-wide text-sm"></code>',
      'src/mono/id.css': '.k { text-transform: uppercase; letter-spacing: 0.1em }',
      'src/Caps.svelte': '<p class="uppercase"></p>',
    }),
  ).toEqual(['src/mono/Id.svelte text-sm', 'src/Caps.svelte uppercase']);
});
