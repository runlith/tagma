export type Declaration = { readonly property: string; readonly value: string; readonly line: number };

const DECLARATION = /(?<![\w.#:@&-])(--?[a-z][\w-]*|[a-z][\w-]*)\s*:\s*([^;{}]*)/gi;

const SPACING =
  /^(?:(?:padding|margin)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|gap|row-gap|column-gap|inset(?:-(?:inline|block)(?:-(?:start|end))?)?|top|right|bottom|left)$/;

const RADIUS = /^border-(?:(?:top|bottom|start|end)-(?:left|right|start|end)-)?radius$/;

const COLOURED =
  /^(?:color|background|background-color|border(?:-(?:top|right|bottom|left|inline|block)[\w-]*)?(?:-color)?|outline(?:-color)?|fill|stroke|box-shadow|text-decoration(?:-color)?|caret-color|accent-color|column-rule(?:-color)?)$/;

const LENGTH = /(?<![\w.#-])(\d*\.?\d+)(px|rem|em|pt|ch|ex|vh|vw|vmin|vmax|svh|dvh|lvh|lh|rlh|cqw|cqh|cqi|cqb)(?![\w])/gi;

const NAMED: ReadonlySet<string> = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen`.split(
    ' ',
  ),
);

const lineAt = (text: string, index: number, first: number): number => first + (text.slice(0, index).match(/\n/g)?.length ?? 0);

export const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));

export const declarationsOf = (text: string, first: number): readonly Declaration[] =>
  [...text.matchAll(DECLARATION)].map((match) => ({
    property: match[1]!.toLowerCase(),
    value: match[2]!.replace(/\s+/g, ' ').trim(),
    line: lineAt(text, match.index, first),
  }));

export const governed = (property: string): boolean =>
  SPACING.test(property) || RADIUS.test(property) || property === 'font-size' || property === 'box-shadow';

export const declarationIssues = (property: string, value: string): readonly string[] => {
  const issues: string[] = [];
  if (governed(property)) {
    const unit = SPACING.test(property) || property === 'box-shadow';
    const ring = property === 'box-shadow' ? 2 : 1;
    for (const match of value.matchAll(LENGTH)) {
      const size = Number(match[1]);
      if (size === 0 || (size >= 1 && size <= ring && Number.isInteger(size) && match[2]!.toLowerCase() === 'px' && unit)) continue;
      issues.push(`literal length \`${match[0]}\` in \`${property}\` is outside the tokens`);
    }
  }
  if (COLOURED.test(property)) {
    for (const word of value.replace(/url\([^)]*\)/g, '').split(/[^A-Za-z-]+/)) {
      if (NAMED.has(word.toLowerCase())) issues.push(`named colour \`${word}\` in \`${property}\` is outside the tokens`);
    }
  }
  return issues;
};
