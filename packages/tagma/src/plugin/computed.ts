import ts from 'typescript';

const isMetaRequire = (node: ts.Node): boolean =>
  ts.isPropertyAccessExpression(node) &&
  node.name.text === 'require' &&
  ts.isMetaProperty(node.expression) &&
  node.expression.keywordToken === ts.SyntaxKind.ImportKeyword;

export const computedImports = (code: string): number => {
  const source = ts.createSourceFile('bundle.js', code, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const requires = new Set<string>();
  const aliases = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined && isMetaRequire(node.initializer))
      requires.add(node.name.text);
    ts.forEachChild(node, aliases);
  };
  aliases(source);
  let computed = 0;
  const calls = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const loads =
        callee.kind === ts.SyntaxKind.ImportKeyword || isMetaRequire(callee) || (ts.isIdentifier(callee) && requires.has(callee.text));
      const [specifier] = node.arguments;
      if (loads && (specifier === undefined || !ts.isStringLiteralLike(specifier))) computed += 1;
    }
    ts.forEachChild(node, calls);
  };
  calls(source);
  return computed;
};
