export const wordsOf = (name: string): readonly string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((one) => one !== '');

const forms = (word: string): readonly string[] => {
  const lowered = word.toLowerCase();
  const found = [lowered];
  if (lowered.length > 3 && lowered.endsWith('ies')) found.push(`${lowered.slice(0, -3)}y`);
  if (lowered.length > 2 && lowered.endsWith('es')) found.push(lowered.slice(0, -2));
  if (lowered.length > 1 && lowered.endsWith('s') && !lowered.endsWith('ss')) found.push(lowered.slice(0, -1));
  return found;
};

export const sameWord = (left: string, right: string): boolean => {
  const mine = forms(left);
  return forms(right).some((one) => mine.includes(one));
};

export const isPlural = (word: string): boolean => {
  const lowered = word.toLowerCase();
  return lowered.length > 2 && lowered.endsWith('s') && !/(ss|us|is)$/.test(lowered);
};

export const stemOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.indexOf('.', 1);
  return dot === -1 ? name : name.slice(0, dot);
};

export const parentOf = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
};

export const lastOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
