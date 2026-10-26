export const RUNLITH_RIPGREP_PATH_ENV = 'RUNLITH_RIPGREP_PATH';

export type RipgrepPathOptions = {
  env?: NodeJS.ProcessEnv;
  path?: string;
};

let packageRipgrepPathPromise: Promise<string> | undefined;

export async function resolveRipgrepPath(options: RipgrepPathOptions = {}): Promise<string> {
  const configured = configuredRipgrepPath(options);
  if (configured) {
    return await requireExistingPath(configured, RUNLITH_RIPGREP_PATH_ENV);
  }

  packageRipgrepPathPromise ??= import('@vscode/ripgrep').then(({ rgPath }) => requireExistingPath(rgPath, '@vscode/ripgrep'));
  return await packageRipgrepPathPromise;
}

export function ripgrepEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const next = { ...env };
  delete next.RIPGREP_CONFIG_PATH;
  return next;
}

function configuredRipgrepPath(options: RipgrepPathOptions): string | undefined {
  const explicit = options.path?.trim();
  if (explicit) return explicit;

  const envValue = options.env?.[RUNLITH_RIPGREP_PATH_ENV]?.trim() || process.env[RUNLITH_RIPGREP_PATH_ENV]?.trim();
  return envValue || undefined;
}

async function requireExistingPath(path: string, source: string): Promise<string> {
  if (await Bun.file(path).exists()) {
    return path;
  }
  throw new Error(`ripgrep binary from ${source} is missing at ${path}.`);
}
