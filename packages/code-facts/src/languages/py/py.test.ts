import { describe, expect, it } from 'bun:test';
import { UnsupportedSource, type ImportSite } from '../../imports';
import { dependenciesOf, type Tree } from '../../tree';
import { py } from './index';

const listed = (texts: Readonly<Record<string, string>>): Tree => ({
  has: (path) => Object.hasOwn(texts, path),
  read: (path) => texts[path] as string,
  paths: function* (prefix = '') {
    for (const path of Object.keys(texts).sort()) if (prefix === '' || path === prefix || path.startsWith(`${prefix}/`)) yield path;
  },
});

const sites = (text: string) =>
  py.imports(text, 'src/shop/app/service.py').map(
    ({
      specifier,
      line,
      loads,
      forwards,
      kind,
    }): Pick<ImportSite, 'specifier' | 'line' | 'loads' | 'forwards'> & {
      readonly kind?: ImportSite['kind'];
    } => ({ specifier, line, loads, forwards, kind }),
  );

describe('py import sites', () => {
  it('reads every import statement with when it loads: at module load, lazily inside a function, never under TYPE_CHECKING', () => {
    const text = [
      'from __future__ import annotations',
      'import os.path as osp, json',
      'from typing import TYPE_CHECKING',
      'from .models import (',
      '    Order,',
      '    Line as Line,',
      ')',
      'if TYPE_CHECKING:',
      '    from shop.api.routes import Router',
      'else:',
      '    import shop.adapters.db',
      'def handle(name):',
      '    from ..domain import rules',
      '    return importlib.import_module(name)',
      'class Plugin:',
      '    from shop.domain import *',
      'text = "import secret"; """',
      'from nowhere import nothing',
      '"""',
      'loaded = __import__("shop.api")',
      '',
    ].join('\n');
    expect(sites(text)).toEqual([
      { specifier: '__future__:annotations', line: 1, loads: 'with-module', forwards: false },
      { specifier: 'os.path', line: 2, loads: 'with-module', forwards: false },
      { specifier: 'json', line: 2, loads: 'with-module', forwards: false },
      { specifier: 'typing:TYPE_CHECKING', line: 3, loads: 'with-module', forwards: false },
      { specifier: '.models:Order', line: 5, loads: 'with-module', forwards: false },
      { specifier: '.models:Line', line: 6, loads: 'with-module', forwards: true },
      { specifier: 'shop.api.routes:Router', line: 9, loads: 'never', forwards: false },
      { specifier: 'shop.adapters.db', line: 11, loads: 'with-module', forwards: false },
      { specifier: '..domain:rules', line: 13, loads: 'lazily', forwards: false },
      { specifier: 'import_module(name)', line: 14, loads: 'lazily', forwards: false, kind: 'unresolved' },
      { specifier: 'shop.domain', line: 16, loads: 'with-module', forwards: true },
      { specifier: 'shop.api', line: 20, loads: 'lazily', forwards: false },
    ]);
  });

  it('answers the module-level declarations and the metrics a size rule reads', () => {
    const text = [
      'import os',
      'from a import (',
      '  b,',
      ')',
      '',
      '@dataclass',
      'class Order:',
      '    total: int = 0',
      'async def place(): pass',
      '_hidden, shown = 1, 2',
      'LIMIT: int',
      'type Id = int',
      '',
    ].join('\n');
    expect(py.declarations(text, 'src/x.py')).toEqual([
      { name: 'Order', kind: 'class', line: 7, exported: true },
      { name: 'place', kind: 'function', line: 9, exported: true },
      { name: '_hidden', kind: 'variable', line: 10, exported: false },
      { name: 'shown', kind: 'variable', line: 10, exported: true },
      { name: 'LIMIT', kind: 'variable', line: 11, exported: true },
      { name: 'Id', kind: 'type', line: 12, exported: true },
    ]);
    const metrics = py.metrics(text, 'src/x.py');
    expect([metrics.lines, metrics.importLines]).toEqual([12, 4]);
    expect(py.metrics(text.replace('import os', 'import sys'), 'src/x.py').body).toBe(metrics.body);
  });

  it('refuses a text whose string or bracket never closes, naming the line', () => {
    expect(() => py.imports('x = 1\ny = "open\n', 'a.py')).toThrow(UnsupportedSource);
    expect(() => py.imports('x = (1,\n', 'a.py')).toThrow('line');
  });

  it('reads past a formatted string whose expression holds quotes and braces', () => {
    expect(sites('label = f"{order["id"]:{width}} {{import x}}"\nimport shop\n').map(({ specifier }) => specifier)).toEqual(['shop']);
  });

  it('names a computed load through an alias of importlib or import_module, or inside a formatted string', () => {
    const text = [
      'import importlib as il',
      'from importlib import import_module as load',
      'from typing import TYPE_CHECKING as TC',
      'if TC:',
      '    import shop.api',
      'a = il.import_module(name)',
      'b = load(name)',
      'c = f"{__import__(name)}"',
      '',
    ].join('\n');
    expect(
      sites(text)
        .filter(({ kind, loads }) => kind === 'unresolved' || loads === 'never')
        .map(({ specifier, line }) => [specifier, line]),
    ).toEqual([
      ['shop.api', 5],
      ['import_module(name)', 6],
      ['load(name)', 7],
      ['__import__(name)', 8],
    ]);
  });

  it('refuses a bracket closed by another kind, a block with no body and an indent no block opens', () => {
    for (const text of ['x = (]\n', 'def f():\nimport shop\n', 'x = 1\n    y = 2\n', 'if a:\n        x = 1\n    y = 2\n', 'class A:\n']) {
      expect(() => py.imports(text, 'a.py')).toThrow(UnsupportedSource);
    }
  });

  it('declares names bound in module-level control flow, and none bound in a function or class body', () => {
    const text =
      'try:\n    class Service: pass\nexcept ImportError:\n    Service = None\nif ready:\n    def api():\n        inner = 1\nclass Box:\n    field = 1\n';
    expect(py.declarations(text, 'a.py').map(({ name, kind }) => `${kind} ${name}`)).toEqual([
      'class Service',
      'variable Service',
      'function api',
      'class Box',
    ]);
  });
});

describe('py resolution', () => {
  const tree = listed({
    'pyproject.toml': '[project]\nname = "shop"\n',
    'src/shop/__init__.py': '',
    'src/shop/domain/__init__.py': '',
    'src/shop/domain/model.py': '',
    'src/shop/app/service.py': '',
    'src/shop/events/created.py': '',
  });
  const resolver = py.resolver(tree, '', {});
  const resolved = (specifier: string, from = 'src/shop/app/service.py') =>
    py.resolve(specifier, from, tree) ?? resolver.resolve(specifier, from);

  it('resolves relative dots from the importing package, a name to its submodule before its package', () => {
    expect(resolved('..domain:model')).toEqual({ to: 'src/shop/domain/model.py' });
    expect(resolved('..domain:Order')).toEqual({ to: 'src/shop/domain/__init__.py' });
    expect(resolved('..:events')).toEqual({ unlisted: 'src/shop/events' });
    expect(resolved('.missing')).toEqual({ unlisted: 'src/shop/app/missing' });
    expect(resolved('.....far', 'src/shop/x.py')).toEqual({ unlisted: 'far' });
  });

  it('lands on a package before a module file of the same name, as the import system does', () => {
    const both = listed({ 'src/shop/api.py': '', 'src/shop/api/__init__.py': '', 'src/shop/app.py': '' });
    expect(py.resolve('.api', 'src/shop/app.py', both)).toEqual({ to: 'src/shop/api/__init__.py' });
  });

  it('resolves an absolute name under the project source root, leaves a name no root holds outside, and names a missing first-party module unlisted', () => {
    expect(resolved('shop.domain.model:Order')).toEqual({ to: 'src/shop/domain/model.py' });
    expect(resolved('shop.events.created')).toEqual({ to: 'src/shop/events/created.py' });
    expect(resolved('sqlalchemy.orm:Session')).toBeNull();
    expect(resolved('shop.gone')).toEqual({ unlisted: 'src/shop/gone' });
    expect(resolver.traced('shop.gone', 'src/shop/app/service.py').absent).toContain('src/shop/gone.py');
  });

  it('takes the source roots a context declares instead of the project layout', () => {
    const flat = listed({ 'lib/shop/__init__.py': '', 'lib/shop/core.py': '', 'pyproject.toml': '' });
    expect(py.resolver(flat, '', { roots: ['lib'] }).resolve('shop.core', 'lib/shop/x.py')).toEqual({ to: 'lib/shop/core.py' });
    expect(py.resolver(flat, '', {}).resolve('shop.core', 'lib/shop/x.py')).toBeNull();
    expect(() => py.resolver(flat, '', { roots: 'lib' })).toThrow(UnsupportedSource);
  });

  it('answers each dependency with its kind and target, and names a non-literal dynamic import unjudged', () => {
    const text =
      'from ..domain import model\nimport requests\nif TYPE_CHECKING:\n    from shop.domain.model import Order\ndef f(n):\n    return __import__(n)\n';
    const deps = dependenciesOf({ ...tree, read: () => text }, 'src/shop/app/service.py', [py], () => resolver);
    expect(deps.map(({ kind, target }) => [kind, target])).toEqual([
      ['value', { path: 'src/shop/domain/model.py' }],
      ['value', { external: 'requests' }],
      ['type', { path: 'src/shop/domain/model.py' }],
      ['dynamic', { unjudged: 'a specifier that is not a literal' }],
    ]);
  });
});
