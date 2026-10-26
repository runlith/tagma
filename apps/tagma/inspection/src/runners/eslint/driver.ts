import { versionProblem } from '../files/version.js';

export type DriverSide = { readonly side: 'tree' | 'base'; readonly dir: string; readonly files: readonly string[] };

export type DriverInput = {
  readonly env: string;
  readonly config: string | null;
  readonly minimumVersion: string;
  readonly rules: Readonly<Record<string, unknown>>;
  readonly sides: readonly DriverSide[];
};

export const DRIVER = String.raw`const versionProblem = ${versionProblem.toString()};
const said = (value) => process.stdout.write(JSON.stringify(value));
const refusal = (path, config) => {
  if (config === undefined) return path + ' matches no object of the config';
  if (config.processor !== undefined && config.processor.meta?.name !== 'eslint-plugin-svelte') {
    return path + ' runs through the processor ' + (config.processor.meta?.name ?? 'without a name') + ', which may drop messages after the rules ran';
  }
  const options = config.languageOptions?.parserOptions ?? {};
  if (options.project || options.projectService) return path + ' is parsed with type information, which reads files beyond the one judged';
  if (config.languageOptions?.parser?.meta?.name === 'svelte-eslint-parser' && !options.svelteConfig) {
    return path + ' is parsed by svelte-eslint-parser without a parserOptions.svelteConfig object, so it would search svelte.config.js above the file, which the files layout does not hold';
  }
  return null;
};
const environment = async (config) => {
  if (config === null) return [];
  const loaded = (await import(Bun.pathToFileURL(config).href)).default;
  return (Array.isArray(loaded) ? loaded.flat(Infinity) : [loaded]).map(({ rules, ...rest }) => rest);
};
const drive = async () => {
  const input = JSON.parse(await Bun.stdin.text());
  const manifest = await Bun.file(Bun.resolveSync('eslint/package.json', input.env)).json();
  const unsupported = versionProblem('ESLint', manifest.version, input.minimumVersion);
  if (unsupported !== null) return { failure: unsupported };
  const api = await import(Bun.pathToFileURL(Bun.resolveSync('eslint', input.env)).href);
  const overrideConfig = [...await environment(input.config), { rules: input.rules }];
  const governed = new Set(Object.keys(input.rules));
  const files = [];
  for (const side of input.sides) {
    const cwd = side.dir === '.' ? process.cwd() : process.cwd() + '/' + side.dir;
    const eslint = new api.ESLint({
      cwd, overrideConfigFile: true, overrideConfig, ignore: false,
      ruleFilter: ({ ruleId }) => governed.has(ruleId),
    });
    for (const path of side.files) {
      const absolute = cwd + '/' + path;
      const refused = refusal(path, await eslint.calculateConfigForFile(absolute));
      if (refused !== null) return { failure: 'the ' + side.side + ' side: ' + refused };
      const [result] = await eslint.lintText(await Bun.file(absolute).text(), { filePath: absolute, warnIgnored: true });
      if (result === undefined) return { failure: 'ESLint answered nothing for ' + path };
      files.push({
        side: side.side, path,
        messages: result.messages.map((one) => ({ id: one.ruleId, line: one.line ?? 0, message: one.message, fatal: one.fatal === true })),
      });
    }
  }
  return { version: api.ESLint.version, files };
};
try {
  said(await drive());
} catch (error) {
  said({ failure: error instanceof Error ? error.message : String(error) });
}
`;
