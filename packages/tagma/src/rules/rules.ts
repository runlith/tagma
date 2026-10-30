import type { BUILTINS } from '@tagma/inspection/builtins';
import type { FACT_KINDS, FactSide, ProgramFinding } from '@tagma/inspection/program';
import type { CONCERNS } from '@tagma/inspection/rule';

export type ModulesParams = (typeof BUILTINS)['modules']['params']['Encoded'];
export type LoadsParams = (typeof BUILTINS)['loads']['params']['Encoded'];
export type ReexportsParams = (typeof BUILTINS)['reexports']['params']['Encoded'];
export type SizeParams = (typeof BUILTINS)['size']['params']['Encoded'];
export type Concern = (typeof CONCERNS)[number];
export type FactKind = (typeof FACT_KINDS)[number];
export type Finding = (typeof ProgramFinding)['Encoded'];
export type Facts = (typeof FactSide)['Encoded'];

export type Argv = readonly [string, ...string[]];

export type Builtin<Id extends string, Params extends object> = { readonly builtin: Id; readonly params: Params };

export type Reach = { readonly files?: readonly string[] };

export type ProgramInspection = {
  readonly program: string;
  readonly name: string;
  readonly concern: Concern;
  readonly needs?: readonly FactKind[];
  readonly params: object;
  readonly files?: readonly string[];
};

export type NamedTool = {
  readonly tool: 'eslint' | 'oxlint' | 'ruff' | 'semgrep' | 'ast-grep';
  readonly config?: string;
  readonly argv?: Argv;
};

export type SarifCommand = { readonly tool: 'command'; readonly argv: Argv; readonly output: 'sarif' };

export type FindingsCommand = { readonly tool: 'command'; readonly argv: Argv; readonly output: 'findings' };

export type LinterInspection =
  | { readonly linter: NamedTool | SarifCommand; readonly rule: string; readonly files?: readonly string[] }
  | { readonly linter: FindingsCommand; readonly files?: readonly string[] };

export type Inspection = Builtin<string, object> | ProgramInspection | LinterInspection;

export type FormatCommand = {
  readonly run: Argv;
  readonly files: readonly string[];
  readonly ok?: readonly number[];
  readonly reads?: 'tree' | 'nearby';
  readonly on?: 'commit';
};

export type Config = {
  readonly inspections?: { readonly [key: string]: Inspection };
  readonly format?: { readonly [key: string]: FormatCommand };
};

export const defineConfig = (config: Config): Config => config;

export const Imports = {
  modules: (options: ModulesParams = {}): Builtin<'modules', ModulesParams> => ({ builtin: 'modules', params: options }),
};

export const Loading = {
  forbid: (params: LoadsParams): Builtin<'loads', LoadsParams> => ({ builtin: 'loads', params }),
};

export const Code = {
  noReexports: (options: ReexportsParams = {}): Builtin<'reexports', ReexportsParams> => ({ builtin: 'reexports', params: options }),
};

export type Threshold = SizeParams['thresholds'][number];

export type MaxLines = {
  readonly base?: SizeParams['base'];
  readonly files?: SizeParams['files'];
  readonly by?: readonly Threshold[];
};

export const Files = {
  maxLines: (lines: number, { by = [], ...selection }: MaxLines = {}): Builtin<'size', SizeParams> => ({
    builtin: 'size',
    params: { ...selection, thresholds: [{ glob: '**', lines }, ...by] },
  }),
  tests: ['**/*.test.*', '**/*.itest.*', '**/*.e2e.*', '**/*.stest.*', '**/*.spec.*', '**/*.bench.*', '**/*.fixture.*'] as const,
};

export type Linter = { readonly rule: (id: string, reach?: Reach) => LinterInspection };

const linter = (tool: NamedTool | SarifCommand): Linter => ({ rule: (rule, reach = {}) => ({ linter: tool, rule, ...reach }) });

function command(options: { readonly argv: Argv; readonly output: 'sarif' }): Linter;
function command(options: { readonly argv: Argv; readonly output: 'findings' }, reach?: Reach): LinterInspection;
function command(options: { readonly argv: Argv; readonly output: 'sarif' | 'findings' }, reach: Reach = {}): Linter | LinterInspection {
  return options.output === 'sarif'
    ? linter({ tool: 'command', argv: options.argv, output: 'sarif' })
    : { linter: { tool: 'command', argv: options.argv, output: 'findings' }, ...reach };
}

export type ToolOptions = { readonly config?: string; readonly argv?: Argv };

export const Linters = {
  command,
  eslint: (options: ToolOptions = {}): Linter => linter({ tool: 'eslint', ...options }),
  oxlint: (options: ToolOptions = {}): Linter => linter({ tool: 'oxlint', ...options }),
  ruff: (options: ToolOptions = {}): Linter => linter({ tool: 'ruff', ...options }),
  semgrep: (options: ToolOptions = {}): Linter => linter({ tool: 'semgrep', ...options }),
  astGrep: (options: ToolOptions = {}): Linter => linter({ tool: 'ast-grep', ...options }),
};

export const Format = {
  command: (command: FormatCommand): FormatCommand => command,
};

export type ProgramDeclaration = {
  readonly program: string;
  readonly name: string;
  readonly concern: Concern;
  readonly needs?: readonly FactKind[];
};

export type DeclaredInspection<Params extends object> = (params: Params, reach?: Reach) => ProgramInspection;

export const defineInspection =
  <Params extends object>(declaration: ProgramDeclaration): DeclaredInspection<Params> =>
  (params, reach = {}) => ({ ...declaration, params, ...reach });

export type Side = {
  readonly commit: string;
  readonly paths: readonly string[];
  readonly whole: boolean;
  readonly read: (path: string) => Promise<string | null>;
  readonly facts: Facts | null;
};

export type InspectionInput<Params extends object> = { readonly params: Params; readonly tree: Side; readonly base: Side | null };

export type Reading = { readonly findings: readonly Finding[]; readonly covered?: 'paths' | 'reach' | readonly string[] };

export type Answer = { readonly tree: Reading; readonly base?: Reading };

export type Program<Params extends object> = (input: InspectionInput<Params>) => Answer | Promise<Answer>;

export const defineProgram = <Params extends { readonly [name: string]: object }>(programs: {
  readonly [Name in keyof Params]: Program<Params[Name]>;
}) => programs;
