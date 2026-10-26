export const artifactOf = (arch: string) =>
  ({
    platform: { os: 'darwin', arch },
    endpoint: { transport: 'unix', path: 'host.sock' },
    library: 'libexecution_platform.dylib',
    holder: 'execution-holder',
  }) as const;

export const artifact = artifactOf(process.arch);

export const RUST_TRIPLES: Readonly<Record<string, string>> = { arm64: 'aarch64-apple-darwin', x64: 'x86_64-apple-darwin' };
