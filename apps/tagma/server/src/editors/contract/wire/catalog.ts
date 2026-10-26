export type EditorBundle = {
  readonly ids: readonly string[];
  readonly cli?: readonly string[];
};

export type EditorEntry = {
  readonly id: string;
  readonly name: string;
  readonly args: readonly string[];
  readonly link?: string;
  readonly mac?: EditorBundle;
  readonly commands?: readonly string[];
};

export const ROOT = '{root}';
export const FILE = '{file}';
export const LINE = '{line}';

const VSCODE_ARGS = [ROOT, '-g', `${FILE}:${LINE}`];
const PATH_ARGS = [ROOT, `${FILE}:${LINE}`];
const JETBRAINS_ARGS = [ROOT, '--line', LINE, FILE];

const jetbrains = (id: string, name: string, bundles: readonly string[], command: string): EditorEntry => ({
  id,
  name,
  args: JETBRAINS_ARGS,
  mac: { ids: bundles },
  commands: [command],
});

export const EDITORS: readonly EditorEntry[] = [
  {
    id: 'vscode',
    name: 'VS Code',
    args: VSCODE_ARGS,
    link: `vscode://file${FILE}:${LINE}`,
    mac: { ids: ['com.microsoft.VSCode'], cli: ['Contents/Resources/app/bin/code'] },
    commands: ['code'],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    args: VSCODE_ARGS,
    link: `cursor://file${FILE}:${LINE}`,
    mac: { ids: ['com.todesktop.230313mzl4w4u92'], cli: ['Contents/Resources/app/bin/cursor'] },
    commands: ['cursor'],
  },
  {
    id: 'devin',
    name: 'Devin',
    args: VSCODE_ARGS,
    link: `devin://file${FILE}:${LINE}`,
    mac: { ids: ['com.exafunction.windsurf'], cli: ['Contents/Resources/app/bin/devin-desktop', 'Contents/Resources/app/bin/windsurf'] },
    commands: ['devin-desktop', 'windsurf'],
  },
  {
    id: 'zed',
    name: 'Zed',
    args: PATH_ARGS,
    mac: { ids: ['dev.zed.Zed', 'dev.zed.Zed-Preview'], cli: ['Contents/MacOS/cli'] },
    commands: ['zed', 'zeditor'],
  },
  {
    id: 'sublime',
    name: 'Sublime Text',
    args: PATH_ARGS,
    mac: { ids: ['com.sublimetext.4', 'com.sublimetext.3'], cli: ['Contents/SharedSupport/bin/subl'] },
    commands: ['subl'],
  },
  jetbrains('idea', 'IntelliJ IDEA', ['com.jetbrains.intellij', 'com.jetbrains.intellij.ce'], 'idea'),
  jetbrains('webstorm', 'WebStorm', ['com.jetbrains.WebStorm'], 'webstorm'),
  jetbrains('phpstorm', 'PhpStorm', ['com.jetbrains.PhpStorm'], 'phpstorm'),
  jetbrains('pycharm', 'PyCharm', ['com.jetbrains.pycharm', 'com.jetbrains.pycharm.ce'], 'pycharm'),
  jetbrains('goland', 'GoLand', ['com.jetbrains.goland'], 'goland'),
  jetbrains('rustrover', 'RustRover', ['com.jetbrains.rustrover'], 'rustrover'),
  jetbrains('clion', 'CLion', ['com.jetbrains.CLion'], 'clion'),
  jetbrains('rider', 'Rider', ['com.jetbrains.rider'], 'rider'),
  jetbrains('rubymine', 'RubyMine', ['com.jetbrains.rubymine'], 'rubymine'),
  jetbrains('android-studio', 'Android Studio', ['com.google.android.studio'], 'studio'),
  {
    id: 'xcode',
    name: 'Xcode',
    args: ['--line', LINE, FILE],
    mac: { ids: ['com.apple.dt.Xcode'], cli: ['Contents/Developer/usr/bin/xed'] },
  },
];

export const EDITOR_IDS = EDITORS.map((entry) => entry.id) as [string, ...string[]];
