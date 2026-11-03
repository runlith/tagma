export const hostBundle = (name: string): string => `${name}.app`;
export const hostBinary = (name: string): string => `${hostBundle(name)}/Contents/MacOS/Electron`;
export const RELEASE_INSIDE = 'Contents/Resources/release';
