import type { Wording } from './closure';
import type { Door } from './doors';

const listed = (entries: readonly string[]): string => entries.map((one) => `\`${one}\``).join(', ');

const away = (platform: string): string =>
  `this load out of what ${platform} starts reach, or behind a door whose \`exports\` give ${platform} a file of its own`;

export const platformRefused = (platform: string, request: string, doors: readonly string[]): Wording => ({
  message: `loads \`${request}\`, which ${platform} refuses`,
  fix: doors.length === 0 ? `Move ${away(platform)}.` : `Load ${listed(doors)} instead, or move ${away(platform)}.`,
});

export const unprovided = (platform: string, request: string, builtin: string): Wording => ({
  message: `loads the built-in \`${builtin}\`, which the ${platform} runtime does not provide`,
  fix: `Move ${away(platform)}; name \`${request}\` in \`allows.${platform}\` only where ${platform} truly provides it.`,
});

export const originRefused = (platform: string, request: string, origin: string): Wording => ({
  message: `loads \`${request}\`, which package \`${origin}\` refuses on ${platform}`,
  fix: `Keep \`${request}\` out of what the starts of \`${origin}\` reach on ${platform}: move the load into code those starts do not load.`,
});

export const doorless = (platform: string, request: string, door: Door): Wording => ({
  message: `loads \`${request}\`${request === door.id ? '' : ` through \`${door.id}\``}, whose \`exports\` declare no ${platform} condition`,
  fix: `Give the \`exports\` entry \`${door.entry}\` of \`${door.manifest}\` a \`${platform}\` condition, or load a door of \`${door.package}\` that declares one.`,
});

export const undeclared = (name: string, manifest: string): Wording => ({
  message: `imports \`${name}\`, which \`${manifest}\` does not declare`,
  fix: `Declare \`${name}\` in the \`dependencies\` of \`${manifest}\`, then run the package manager's install.`,
});

export const named = (specifier: string, owner: string): Wording => ({
  message: `names \`${specifier}\`, which package \`${owner}\` refuses`,
  fix: `Remove \`${specifier}\` from this source, types included: \`packages.${owner}.names\` refuses it.`,
});

export const markerFix = (door: Door): string =>
  `Make the \`${door.platform}\` condition of the \`exports\` entry \`${door.entry}\` of \`${door.manifest}\` name the file its runtime selects.`;

export const doorMissingFix = (door: Door): string =>
  `Point the \`exports\` entry \`${door.entry}\` of \`${door.manifest}\` at a file the tree holds, or name \`${door.package}\` in \`compiled\` where its build emits it.`;

export const programMissingFix = (entry: string, manifest: string, owner: string | undefined): string =>
  `Point \`${entry}\` in \`${manifest}\` at a file the tree holds${owner === undefined ? '' : `, or name \`${owner}\` in \`compiled\` where its build emits it`}.`;

export const routesFix = (app: string, at: string, pages: readonly string[]): string =>
  `Add a page named ${pages.length === 0 ? 'as the rule declares' : listed(pages)} under \`${at}\`, or correct \`routes.at\` of the app \`${app}\`.`;

export const WORKSPACE_FIX = 'Give the repository a root `package.json` whose `workspaces` declares the packages, written as valid JSON.';

export const UNREADABLE_FIX = 'Make the file valid UTF-8 source that parses, or name it in `files.exclude`.';

export const NON_LITERAL_FIX =
  "Load a literal specifier; a file loading code installed outside the tree goes into `loaders` with its why, one whose functions run inside a page into its app's `injected`.";

export const RELATIVE_GLOB_FIX = 'Write each glob pattern relative to this file, opening with `./` or `../`.';

export const OUTSIDE_FIX =
  'Load a relative path, a workspace package or a tsconfig alias; declare a bundler query in `leaves` or `workers`, a toolchain prefix in `internal`.';

export const NO_PACKAGE_FIX = 'Point the specifier at a package, a tsconfig alias the tree resolves, or a prefix `internal` declares.';

export const AMBIGUOUS_FIX = 'Write the specifier with its extension, so one file resolves it.';

export const landing = (absent: readonly string[], otherwise: string): string =>
  absent.length === 0
    ? otherwise
    : `Land ${absent.length === 1 ? '' : 'one of '}${listed(absent)} with this change, or point the import at a file the tree holds.`;
