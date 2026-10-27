import { Minimatch, type MinimatchOptions } from 'minimatch';

export const pathMatcher = (pattern: string, options: MinimatchOptions): Minimatch => {
  const matcher = new Minimatch(pattern, options);
  if (!options.dot)
    matcher.set = matcher.set.filter((row, index) =>
      row.every(
        (part, at) =>
          typeof part !== 'string' ||
          !part.startsWith('.') ||
          matcher.globParts[index]?.[at]?.startsWith('.') ||
          matcher.globParts[index]?.[at]?.startsWith('\\.'),
      ),
    );
  return matcher;
};
