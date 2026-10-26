export type PaneShell = 'posix' | 'fish';

export type PathInput = { readonly pieces: readonly string[]; readonly refused: number };

const PICTURE = /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i;
const CONTROL = /[\u0000-\u001f\u007f]/;
const POSIX_SPECIAL = /[^a-zA-Z0-9_./@:\-\u0080-￿]/g;
const FISH_SPECIAL = /[ "'$\\*?~%#(){}[\]<>^&|;]/g;

export function paneShell(program: string): PaneShell {
  return (program.split('/').pop() ?? program) === 'fish' ? 'fish' : 'posix';
}

export function shellEscapePath(path: string, shell: PaneShell): string {
  if (/^[a-zA-Z0-9_./@:-]+$/.test(path)) return path;
  const quoted = shell === 'fish' ? path.split('\\').join('\\\\') : path;
  return `'${quoted.split("'").join(`'\\''`)}'`;
}

export function pathInput(paths: readonly string[], shell: PaneShell): PathInput {
  const pieces: string[] = [];
  let refused = 0;
  for (const path of paths) {
    if (CONTROL.test(path)) refused += 1;
    else pieces.push(PICTURE.test(path) ? escapedPicture(path, shell) : shellEscapePath(path, shell));
  }
  return { pieces, refused };
}

function escapedPicture(path: string, shell: PaneShell): string {
  return path.replace(shell === 'fish' ? FISH_SPECIAL : POSIX_SPECIAL, (character) => `\\${character}`);
}
