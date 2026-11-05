export type Target = { readonly os: string; readonly arch: 'arm64' | 'x64' };

export const targetName = (target: Target): string => `${target.os}-${target.arch}`;
