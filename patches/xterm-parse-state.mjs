import { readFileSync, writeFileSync } from 'node:fs';

const [destination] = process.argv.slice(2);
if (!destination) {
  console.error('usage: bun patches/xterm-parse-state.mjs <package-dir>');
  process.exit(2);
}

const edit = (path, find, into) => {
  const text = readFileSync(path, 'utf8');
  const count = text.split(find).length - 1;
  if (count !== 1) throw new Error(`${path}: anchor matched ${count} times, expected 1: ${find.slice(0, 90)}…`);
  writeFileSync(path, text.split(find).join(into));
};

const bundlePath = `${destination}/lib-headless/xterm-headless.js`;
edit(
  bundlePath,
  'get cols(){return this._core.cols}',
  'get cols(){return this._core.cols}' +
    'get parseState(){const e=this._core._inputHandler,t=e._parser;return{rest:0===t.currentState&&0===t._parseStack.state&&0===e._utf8Decoder.interim[0]&&0===e._stringDecoder._interim,printed:0!==t.precedingJoinState}}',
);

const typingsPath = `${destination}/typings/xterm-headless.d.ts`;
edit(
  typingsPath,
  `  export class Terminal implements IDisposable {
`,
  `  /**
   * Where the parser stands between two writes.
   */
  export interface IParseState {
    /**
     * The parser is in its ground state with no partial UTF-8 sequence and no string sequence (OSC,
     * DCS, APC, PM, SOS) open: the next byte is read exactly as a freshly constructed parser reads it,
     * apart from \`printed\`.
     */
    readonly rest: boolean;

    /**
     * The last thing parsed was printable text: the width of a following joining character and a
     * following REP read the character it left behind. Any control, escape or string sequence clears it.
     */
    readonly printed: boolean;
  }

  export class Terminal implements IDisposable {
`,
);
edit(
  typingsPath,
  `    readonly buffer: IBufferNamespace;
`,
  `    readonly buffer: IBufferNamespace;

    /**
     * Where the parser stands now. Optional because it is a capability of THIS build, for the same
     * structural reason as \`dynamicStorage\`.
     */
    readonly parseState?: IParseState;
`,
);
console.log(`patched ${bundlePath} and ${typingsPath}`);
