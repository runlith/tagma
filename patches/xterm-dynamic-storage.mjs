// Writes the patched `@xterm/headless` bundle from the pristine one. This file is the READABLE source
// of `@xterm%2Fheadless@6.1.0-beta.302.patch`: the published package ships a minified bundle, so the
// patch itself is one enormous line and the only way to review the change is to read the replacements
// below and re-run this against the pristine package.
//
//   bun patches/xterm-dynamic-storage.mjs <pristine-package-dir> <destination-dir>
//
// The pristine copy is bun's own: `$(bun pm cache)/@xterm/headless@6.1.0-<hash>@@@1`. Every anchor
// must match exactly the number of times it declares, or the run refuses — the bundle is minified, so
// a silently missed anchor would leave a store nobody bounds.
//
// WHAT IT ADDS. The engine retains three things that grow with what the child writes and that no
// public option bounds: the combined-character string a cell holds when a grapheme cluster lands on
// it, the extended-attribute entry a cell holds for an underline style, colour or link, and the OSC 8
// link data the terminal keeps while a line still carries it. `addCodepointToCell` appends to a cell's
// cluster with no end, and `OscLinkService.registerLink` retains a URI per entry with no end, so a
// child that writes them writes into the host's memory. The patch gives the terminal one accountant:
//
//   new Terminal({ dynamicStorage: { lineBytes, linkBytes } })   what one line and the links may hold
//   terminal.dynamicStorage                                      { lineBytes, linkBytes, refusal }
//   terminal.trimHistory(rows)                                   drop that many of the oldest rows
//
// `lineBytes` is a RUNNING total — the sum over every line both buffers hold — so a host reads what a
// terminal retains after each chunk without walking its lines. Every line charges its own account
// against it as entries are put and dropped, and the ring the buffer keeps its lines in charges as a
// line enters or leaves a slot: those are the only two ways the sum can move.
//
// `trimHistory` drops the oldest rows of the normal buffer's history. It exists because the published
// road — lowering `options.scrollback` — cannot be it: `Buffer.resize` resets `scrollTop` to 0, which
// corrupts an application holding a scroll region with no resize for it to redraw on, and
// `CircularList.trimStart` moves its start index while the trimmed line objects stay referenced by the
// ring until it wraps. This patch fixes the second in the ring itself: a slot the ring lets go is
// nulled, so what leaves the buffer leaves memory.
//
// A line carries its own account, so a line that is cleared, filled, resized or recycled releases what
// it held by the same code that drops the entries — there is no separate release path to leak. Link
// data is charged when an entry or a line marker is created and released when the marker's line leaves
// the buffer and when the entry loses its last line. Past a declared limit the store refuses, the
// refusal is final, and `InputHandler.parse` interprets nothing further: the screen stands where the
// refusal found it rather than continuing as a guess.
//
// The charges are ACCOUNTING UNITS with a stated basis, not allocator measurements: in JavaScriptCore
// an indexed property slot is one 8-byte JSValue, a plain object is a 16-byte header with 8-byte
// inline slots, and a 16-bit string is a 16-byte StringImpl plus two bytes a unit. Each charge rounds
// that basis up, so the account is an upper bound on what the store retains.

import { mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';

const [pristine, destination] = process.argv.slice(2);
if (!pristine || !destination) {
  console.error('usage: bun patches/xterm-dynamic-storage.mjs <pristine-package-dir> <destination-dir>');
  process.exit(2);
}

mkdirSync(destination, { recursive: true });
cpSync(pristine, destination, { recursive: true });
for (const entry of readdirSync(destination)) {
  if (entry.startsWith('.bun-tag-')) rmSync(`${destination}/${entry}`);
}

const browser = JSON.parse(readFileSync(`${pristine}/package.json`, 'utf8')).name === '@xterm/xterm';
const bundlePath = `${destination}/${browser ? 'lib/xterm.js' : 'lib-headless/xterm-headless.js'}`;
let bundle = readFileSync(bundlePath, 'utf8');

const replace = (find, into, expect = 1) => {
  if (!browser) {
    const count = bundle.split(find).length - 1;
    if (count !== expect) throw new Error(`bundle anchor matched ${count} times, expected ${expect}: ${find.slice(0, 90)}…`);
    bundle = bundle.split(find).join(into);
    return;
  }
  const names = new Set();
  const source = find.split(/([A-Za-z_$][\w$]*)/).map((token, index, tokens) => {
    if (/^[etisrnaol]$/.test(token) && !tokens[index - 1]?.endsWith('.')) {
      if (names.has(token)) return `\\k<${token}>`;
      names.add(token);
      return `(?<${token}>[A-Za-z_$][\\w$]*)`;
    }
    return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  const pattern = new RegExp(source, 'g');
  const matches = [...bundle.matchAll(pattern)];
  if (matches.length !== expect) throw new Error(`browser anchor matched ${matches.length} times, expected ${expect}: ${find.slice(0, 90)}…`);
  bundle = bundle.replace(pattern, (...args) => {
    const groups = args.at(-1);
    return into.replace(/[A-Za-z_$][\w$]*/g, (token, offset) => {
      if (into[offset - 1] === '.' || !names.has(token)) return token;
      return groups[token];
    });
  });
};

// ── the accountant, at the bundle's own top scope so every module reaches it by name ──────────────
//
// `admitLine` DECIDES and nothing else; `lineBytes` is moved by whoever holds the line — the line as
// its own account changes, the ring as the line enters or leaves a slot. Keeping the decision and the
// sum apart is what lets a line be charged exactly once per slot it stands in, including the instant
// during a reflow or a splice when one line stands in two.
const ACCOUNTANT = `"use strict";
/* runlith: bounded dynamic terminal storage — patches/xterm-dynamic-storage.mjs */
const __runlithCombinedBytes=32,__runlithExtendedBytes=48,__runlithLinkEntryBytes=96,__runlithLinkMarkerBytes=512;
class __runlithStorage{
constructor(e){this._options=e,this.lineBytes=0,this.linkBytes=0,this.refusal=void 0}
get lineLimit(){return this._options.rawOptions.dynamicStorage.lineBytes||0}
get linkLimit(){return this._options.rawOptions.dynamicStorage.linkBytes||0}
admitLine(e,t){const i=this.lineLimit;return!(i>0&&e>i&&e>t)||(this.refuse("line",e,i),!1)}
admitLink(e){const t=this.linkLimit;return t>0&&this.linkBytes+e>t?(this.refuse("link",this.linkBytes+e,t),!1):(this.linkBytes+=e,!0)}
releaseLink(e){this.linkBytes=Math.max(0,this.linkBytes-e)}
refuse(e,t,i){void 0===this.refusal&&(this.refusal={store:e,bytes:t,limit:i})}
}
`;
replace('(()=>{"use strict";var e={', `(()=>{${ACCOUNTANT}var e={`);

// The option, so a declared budget survives OptionsService's own filter over unknown keys, and a
// caller that clears it gets the unbounded default rather than a terminal that throws on its first
// line — `windowsPty` is guarded the same way in the same switch.
replace('quirks:{},vtExtensions:{}};', 'quirks:{},vtExtensions:{},dynamicStorage:{}};');
replace('case"windowsPty":i=i??{}}return i}', 'case"windowsPty":case"dynamicStorage":i=i??{}}return i}');

// REP repeats the preceding grapheme by allocating four bytes per repeated codepoint BEFORE anything
// is parsed, and its parameter reaches 0x7FFFFFFF: `CSI 50000000 b` asks the host for 200 MB that no
// budget here or anywhere else covers. It is bounded by what the engine may hold in one parse — the
// same 131072 codepoints the parse buffer is capped at — and a demand past that refuses the screen by
// name instead of being quietly repeated fewer times.
replace(
  'a=new Uint32Array(n.length*i);let o=0;',
  'a=n.length*i>131072?null:new Uint32Array(n.length*i);if(null===a){this._bufferService.dynamicStorage.refuse("repeat",n.length*i,131072);return!0}let o=0;',
);

// One accountant per terminal, born before the buffers whose lines it holds.
replace(
  'this.rows=Math.max(e.rawOptions.rows||0,1),this.buffers=this._register(new a.BufferSet(e,this,t))',
  'this.rows=Math.max(e.rawOptions.rows||0,1),this.dynamicStorage=new __runlithStorage(e),this.buffers=this._register(new a.BufferSet(e,this,t))',
);

// ── BufferLine: its own account, and the four doors every sparse-map write goes through ───────────
replace(
  'class l{constructor(e,t,i=!1){this.isWrapped=i,this._combined={},this._extendedAttrs={},',
  'class l{constructor(e,t,i=!1,__st=void 0){this.isWrapped=i,this._storage=__st,this._dynamicBytes=0,this._slots=0,this._combined={},this._extendedAttrs={},',
);
// Both doors REFUSE: no write past the cap on any path, so the cap is a cap and not a report. A cell
// whose entry was refused has the flag that would read that entry cleared in the same act — a cell
// flagged combined with no string behind it, or extended with no entry, is a broken buffer — so what a
// refusal leaves is an empty cell of the right width on a screen the refusal has already condemned.
// `-4194304` clears the combined flag AND the codepoint field, which a combined cell holds its own
// index in; `-268435457` clears the extended flag.
//
// `_charge` is the ONE door onto `_dynamicBytes`, and it carries the change into the terminal's total
// once per slot this line stands in. A line that is not in a buffer moves no total: a blank line born
// with an extended attribute on every cell — which is what a shell erasing under an underline writes —
// is counted when the ring takes it, not when it is built. `__enter` and `__leave` are that ring's
// side, so the total answers the same question a walk of both buffers would.
replace(
  'for(let t=0;t<e;++t)this.setCell(t,s);this.length=e}',
  'for(let t=0;t<e;++t)this.setCell(t,s);this.length=e}' +
    '_charge(e){void 0!==this._storage&&(this._storage.lineBytes+=(e-this._dynamicBytes)*this._slots),this._dynamicBytes=e}' +
    '__enter(){this._slots++,void 0!==this._storage&&(this._storage.lineBytes+=this._dynamicBytes)}' +
    '__leave(){this._slots--,void 0!==this._storage&&(this._storage.lineBytes-=this._dynamicBytes)}' +
    '_putCombined(e,t){const s=this._combined[e],r=this._dynamicBytes-(void 0===s?0:__runlithCombinedBytes+2*s.length)+__runlithCombinedBytes+2*t.length;return(void 0===this._storage||this._storage.admitLine(r,this._dynamicBytes))&&(this._charge(r),this._combined[e]=t,this._cache="",!0)}' +
    '_putExtended(e,t){if(void 0!==this._extendedAttrs[e])return this._extendedAttrs[e]=t,!0;const i=this._dynamicBytes+__runlithExtendedBytes;return(void 0===this._storage||this._storage.admitLine(i,this._dynamicBytes))&&(this._charge(i),this._extendedAttrs[e]=t,!0)}' +
    '_dropCombined(e){const t=this._combined[e];void 0!==t&&(this._charge(this._dynamicBytes-__runlithCombinedBytes-2*t.length),delete this._combined[e],this._cache="")}' +
    '_dropExtended(e){void 0!==this._extendedAttrs[e]&&(this._charge(this._dynamicBytes-__runlithExtendedBytes),delete this._extendedAttrs[e])}',
);

// set(): a CharData carrying a combined string. Refused, the cell is written empty rather than flagged
// combined over a string the line was not allowed to hold.
replace(
  'this._data[3*e+1]=t[n.CHAR_DATA_ATTR_INDEX],t[n.CHAR_DATA_CHAR_INDEX].length>1?(this._combined[e]=t[1],this._data[3*e+0]=2097152|e|t[n.CHAR_DATA_WIDTH_INDEX]<<22)',
  'this._data[3*e+1]=t[n.CHAR_DATA_ATTR_INDEX],t[n.CHAR_DATA_CHAR_INDEX].length>1?this._data[3*e+0]=(this._putCombined(e,t[1])?2097152|e:0)|t[n.CHAR_DATA_WIDTH_INDEX]<<22',
);

// setCell() and setCellFromCodepoint(): a cell written over another. A cell that carries no cluster
// and no extended attributes DROPS what the index held — stock leaves both entries standing, because
// only the flag decides whether they are ever read again, and a line that is scrolled, inserted into,
// deleted from or erased with `CSI K` is written cell by cell exactly this way. Left charged, an
// ordinary redraw loop would spend a line's whole budget on strings the screen no longer shows. No
// reader reaches either map without testing its flag first, so dropping them is invisible.
replace(
  'setCell(e,t){this._cacheValid=!1,2097152&t.content&&(this._combined[e]=t.combinedData),268435456&t.bg&&(this._extendedAttrs[e]=t.extended),this._data[3*e+0]=t.content,this._data[3*e+1]=t.fg,this._data[3*e+2]=t.bg}',
  'setCell(e,t){this._cacheValid=!1;let __ct=t.content,__bg=t.bg;2097152&__ct?this._putCombined(e,t.combinedData)||(__ct&=-4194304):this._dropCombined(e),268435456&__bg?this._putExtended(e,t.extended)||(__bg&=-268435457):this._dropExtended(e),this._data[3*e+0]=__ct,this._data[3*e+1]=t.fg,this._data[3*e+2]=__bg}',
);
replace(
  'setCellFromCodepoint(e,t,i,s){this._cacheValid=!1,268435456&s.bg&&(this._extendedAttrs[e]=s.extended);const r=3*e;this._data[r+0]=t|i<<22,this._data[r+1]=s.fg,this._data[r+2]=s.bg}',
  'setCellFromCodepoint(e,t,i,s){this._cacheValid=!1;let __bg=s.bg;268435456&__bg?this._putExtended(e,s.extended)||(__bg&=-268435457):this._dropExtended(e);const r=3*e;this._data[r+0]=t|i<<22,this._data[r+1]=s.fg,this._data[r+2]=__bg}',
);

// addCodepointToCell(): the one store with no end of its own — a combining mark appended to a cell
// that already holds a cluster. Refused, the cell keeps the cluster it had and the flags stay as they
// were, so the buffer is consistent at the byte the refusal fell on.
replace(
  '2097152&s?this._combined[e]+=(0,a.stringFromCodePoint)(t):2097151&s?(this._combined[e]=(0,a.stringFromCodePoint)(2097151&s)+(0,a.stringFromCodePoint)(t),s&=-2097152,s|=2097152):s=t|1<<22',
  '2097152&s?this._putCombined(e,this._combined[e]+(0,a.stringFromCodePoint)(t)):2097151&s?this._putCombined(e,(0,a.stringFromCodePoint)(2097151&s)+(0,a.stringFromCodePoint)(t))&&(s&=-2097152,s|=2097152):s=t|1<<22',
);

// resize() shrinking: entries cut off the right of the line are released.
replace('s>=e&&delete this._combined[s]', 's>=e&&this._dropCombined(s)');
replace('i>=e&&delete this._extendedAttrs[i]', 'i>=e&&this._dropExtended(i)');

// fill() and copyFrom(blank): both maps are replaced wholesale, so the account goes with them. This is
// the release an erased screen and a recycled scrollback line take.
replace(
  'else{this._combined={},this._extendedAttrs={};for(let t=0;t<this.length;++t)this.setCell(t,e)}',
  'else{this._combined={},this._extendedAttrs={},this._charge(0),this._cache="";for(let t=0;t<this.length;++t)this.setCell(t,e)}',
);

// The line's own text cache holds a copy of everything the line renders to, and stock only marks it
// invalid — the string stays alive until the line is recycled. It is dropped where the content it
// copied is dropped, so an erased or resized line retains nothing it no longer shows.
replace('resize(e,t){if(this._cacheValid=!1,e===this.length)', 'resize(e,t){if(this._cache="",this._cacheValid=!1,e===this.length)');
replace(
  't?(this._combined={},this._extendedAttrs={}):this._copySparseMapsFrom(e)',
  't?(this._combined={},this._extendedAttrs={},this._charge(0)):this._copySparseMapsFrom(e)',
);

// clone(): the copy answers to the same accountant as the line it came from.
replace('clone(e){const t=new l(0,void 0,!1);', 'clone(e){const t=new l(0,void 0,!1,this._storage);');

// The per-cell and whole-line copies reflow, insert and delete go through.
// Reflow, insert and delete move cells between lines. The destination answers to its own account like
// any other write, and a cell it may not hold arrives empty rather than pointing at an entry that is
// not there: the caller has already copied the cell's data, so the flags are cleared here.
replace(
  '_copyCellMapsFrom(e,t,i){const s=3*t;2097152&e._data[s+0]&&(this._combined[i]=e._combined[t]),268435456&e._data[s+2]&&(this._extendedAttrs[i]=e._extendedAttrs[t])}',
  '_copyCellMapsFrom(e,t,i){const s=3*t;2097152&e._data[s+0]?this._putCombined(i,e._combined[t])||(this._data[3*i+0]&=-4194304):this._dropCombined(i),268435456&e._data[s+2]?this._putExtended(i,e._extendedAttrs[t])||(this._data[3*i+2]&=-268435457):this._dropExtended(i)}',
);
replace(
  '_copySparseMapsFrom(e){this._combined={},this._extendedAttrs={};',
  '_copySparseMapsFrom(e){this._combined={},this._extendedAttrs={},this._charge(0);',
);

// Every line the buffer makes is handed the terminal's accountant.
replace(
  'getBlankLine(e,t){return new o.BufferLine(this._bufferService.cols,this.getNullCell(e),t)}',
  'getBlankLine(e,t){return new o.BufferLine(this._bufferService.cols,this.getNullCell(e),t,this._bufferService.dynamicStorage)}',
);
replace('new o.BufferLine(e,i,!1)', 'new o.BufferLine(e,i,!1,this._bufferService.dynamicStorage)', browser ? 3 : 2);
if (!browser) replace('new o.BufferLine(e,s,!1)', 'new o.BufferLine(e,s,!1,this._bufferService.dynamicStorage)');

// ── CircularList: the ring the buffer keeps its lines in, and therefore the one place a line enters
// or leaves a buffer ───────────────────────────────────────────────────────────────────────────────
//
// Every road a line takes out of a buffer ends here: the ring is overwritten (scrolling a region,
// inserting or deleting a line, rearranging a reflow), its window shrinks (a resize popping rows, a
// reflow unwrapping them), or its start moves (the scrollback filling, a trim). So this is where the
// running total is kept, and keeping it anywhere else would leave one of those roads uncounted — a
// total that climbs by a line's account every time a full-screen application scrolls.
//
// `__put` is the ONE write into the backing array: it releases what stood in the slot and admits what
// takes it, which telescopes correctly through a move — a line written into a second slot before the
// first is cleared is charged for both while it stands in both. `__drop` is the window shrinking, and
// it NULLS what it releases: a slot the ring has let go holds a line that no reader can reach and the
// allocator cannot free, which is the second reason `options.scrollback` is not the trim door.
replace(
  'get(e){return this._array[this._getCyclicIndex(e)]}set(e,t){this._array[this._getCyclicIndex(e)]=t}',
  'get(e){return this._array[this._getCyclicIndex(e)]}' +
    '__put(e,t){const i=this._getCyclicIndex(e),s=this._array[i];s&&s.__leave&&s.__leave(),t&&t.__enter&&t.__enter(),this._array[i]=t}' +
    '__drop(e,t){for(let i=0;i<t;i++)this.__put(e+i,void 0)}' +
    '__releaseAll(){this.__drop(0,this._length)}' +
    'set(e,t){this.__put(e,t)}',
);
// push() writes the slot at the end and only then decides whether the ring wrapped: when it did, the
// slot it wrote is the one the start index leaves behind, so the line that fell off the top is the one
// this write released.
replace(
  'push(e){this._array[this._getCyclicIndex(this._length)]=e,',
  'push(e){this.__put(this._length,e),',
);
replace(
  'pop(){return this._array[this._getCyclicIndex(this._length---1)]}',
  'pop(){const e=this._array[this._getCyclicIndex(this._length-1)];return this.__drop(this._length-1,1),this._length--,e}',
);
// The grow branch keeps stock's raw index — the caller that grows the window rewrites every slot right
// after, which is what makes it harmless — but it releases whatever it nulls, so the total follows the
// array rather than the window.
replace(
  'set length(e){if(e>this._length)for(let t=this._length;t<e;t++)this._array[t]=void 0;this._length=e}',
  'set length(e){if(e>this._length)for(let t=this._length;t<e;t++){const i=this._array[t];i&&i.__leave&&i.__leave(),this._array[t]=void 0}else this.__drop(e,this._length-e);this._length=e}',
);
// A shorter ring carries only what fits; the rest is released here rather than left in an array the
// next line will drop.
replace(
  'set maxLength(e){if(this._maxLength===e)return;const t=new Array(e);for(let i=0;i<Math.min(e,this.length);i++)t[i]=this._array[this._getCyclicIndex(i)];',
  'set maxLength(e){if(this._maxLength===e)return;const s=Math.min(e,this.length);this.__drop(s,this.length-s);const t=new Array(e);for(let i=0;i<s;i++)t[i]=this._array[this._getCyclicIndex(i)];',
);
// splice() shifts the survivors down over the deleted ones and then shortens the window: the tail it
// shortens past holds duplicates of lines that are still in the buffer, so those slots are dropped
// before the length moves, not left to be counted twice.
replace(
  'splice(e,t,...i){if(t){for(let i=e;i<this._length-t;i++)this._array[this._getCyclicIndex(i)]=this._array[this._getCyclicIndex(i+t)];this._length-=t,this.onDeleteEmitter.fire({index:e,amount:t})}for(let t=this._length-1;t>=e;t--)this._array[this._getCyclicIndex(t+i.length)]=this._array[this._getCyclicIndex(t)];for(let t=0;t<i.length;t++)this._array[this._getCyclicIndex(e+t)]=i[t];',
  'splice(e,t,...i){if(t){for(let i=e;i<this._length-t;i++)this.__put(i,this._array[this._getCyclicIndex(i+t)]);this.__drop(this._length-t,t),this._length-=t,this.onDeleteEmitter.fire({index:e,amount:t})}for(let t=this._length-1;t>=e;t--)this.__put(t+i.length,this._array[this._getCyclicIndex(t)]);for(let t=0;t<i.length;t++)this.__put(e+t,i[t]);',
);
// The rows a trim takes leave the ring entirely: released, and their slots nulled, so a heap census
// after a trim no longer finds them.
replace(
  'trimStart(e){e>this._length&&(e=this._length),this._startIndex+=e,',
  'trimStart(e){e>this._length&&(e=this._length),this.__drop(0,e),this._startIndex+=e,',
);
replace(
  'if(s>0)for(this._length+=s;this._length>this._maxLength;)this._length--,this._startIndex++,this.onTrimEmitter.fire(1)',
  'if(s>0)for(this._length+=s;this._length>this._maxLength;)this.__drop(0,1),this._length--,this._startIndex++,this.onTrimEmitter.fire(1)',
);

// ── the buffer: the account follows its lines, and the trim door ──────────────────────────────────
//
// A buffer that is cleared or disposed drops every line it holds at once — the alternate screen on the
// way back to the normal one, and both buffers when a reset builds new ones — and the account goes
// with them.
replace(
  'this._register((0,r.toDisposable)(()=>this.clearAllMarkers()))}',
  'this._register((0,r.toDisposable)(()=>{this.clearAllMarkers(),this.lines.__releaseAll()}))}',
);
// `trimHistory` moves `ybase`, `ydisp` and `savedY` exactly as `resize` moves them when the scrollback
// shrinks, and touches NOTHING else: the scroll region an application set stands, which is the whole
// reason this door exists instead of lowering `options.scrollback`. Markers on the trimmed rows are
// disposed by the ring's own `onTrim`, so the OSC 8 entries holding them release with the lines.
replace(
  'clear(){this.ydisp=0,this.ybase=0,this.y=0,this.x=0,this.lines=new s.CircularList(this._getCorrectBufferLength(this._rows)),this.scrollTop=0,this.scrollBottom=this._rows-1,this.setupTabStops()}',
  'clear(){this.lines.__releaseAll(),this.ydisp=0,this.ybase=0,this.y=0,this.x=0,this.lines=new s.CircularList(this._getCorrectBufferLength(this._rows)),this.scrollTop=0,this.scrollBottom=this._rows-1,this.setupTabStops()}' +
    'trimHistory(e){const t=Math.max(0,Math.min(Math.floor(e),this.ybase));return t>0&&(this.lines.trimStart(t),this.ybase-=t,this.ydisp=Math.max(this.ydisp-t,0),this.savedY=Math.max(this.savedY-t,0)),t}',
);

// ── OSC 8 links: charged when an entry or a line marker is created, released when the marker's line
// leaves the buffer and when the entry loses its last line ────────────────────────────────────────
replace(
  'registerLink(e){const t=this._bufferService.buffer;if(void 0===e.id){const i=t.addMarker(t.ybase+t.y),s={data:e,id:this._nextId++,lines:[i]};',
  'registerLink(e){const t=this._bufferService.buffer;if(void 0===e.id){const __b=__runlithLinkEntryBytes+__runlithLinkMarkerBytes+2*e.uri.length;if(!this._bufferService.dynamicStorage.admitLink(__b))return 0;const i=t.addMarker(t.ybase+t.y),s={data:e,id:this._nextId++,lines:[i],bytes:__b};',
);
replace(
  'const n=t.addMarker(t.ybase+t.y),a={id:this._nextId++,key:this._getEntryIdKey(i),data:i,lines:[n]};',
  'const __b=__runlithLinkEntryBytes+__runlithLinkMarkerBytes+2*s.length+2*i.uri.length;if(!this._bufferService.dynamicStorage.admitLink(__b))return 0;const n=t.addMarker(t.ybase+t.y),a={id:this._nextId++,key:this._getEntryIdKey(i),data:i,lines:[n],bytes:__b};',
);
replace(
  'if(i&&i.lines.every(e=>e.line!==t)){const e=this._bufferService.buffer.addMarker(t);',
  'if(i&&i.lines.every(e=>e.line!==t)){if(!this._bufferService.dynamicStorage.admitLink(__runlithLinkMarkerBytes))return;i.bytes+=__runlithLinkMarkerBytes;const e=this._bufferService.buffer.addMarker(t);',
);
replace(
  '_removeMarkerFromLink(e,t){const i=e.lines.indexOf(t);-1!==i&&(e.lines.splice(i,1),0===e.lines.length&&(void 0!==e.data.id&&this._entriesWithId.delete(e.key),this._dataByLinkId.delete(e.id)))}',
  '_removeMarkerFromLink(e,t){const i=e.lines.indexOf(t);-1!==i&&(e.lines.splice(i,1),e.bytes-=__runlithLinkMarkerBytes,this._bufferService.dynamicStorage.releaseLink(__runlithLinkMarkerBytes),0===e.lines.length&&(this._bufferService.dynamicStorage.releaseLink(e.bytes),e.bytes=0,void 0!==e.data.id&&this._entriesWithId.delete(e.key),this._dataByLinkId.delete(e.id)))}',
);

// ── the write buffer answers each chunk once, from wherever it stands ─────────────────────────────
//
// Two defects of the stock write loop, both reachable by any consumer that acts on the terminal from
// the callback its own write was given — which is what "await the parse before the next act" means:
//
//   `_innerWrite` calls the callback while the entry is still in `_callbacks` and `_bufferOffset` has
//   not advanced, so a callback that flushes the buffer (every `resize` does, through `flushSync`)
//   finds the chunk it just finished still queued. It is parsed a second time and its callback called
//   a second time; and when the loop resumes it clears the buffer, discarding a chunk the callback
//   queued — whose callback therefore never fires and whose caller waits forever.
//
//   `flushSync` shifts from the FRONT of the buffer, ignoring `_bufferOffset`, so everything already
//   parsed is parsed again; it then leaves `_bufferOffset` at 2147483647, a sentinel no later write
//   recovers from except by the buffer emptying.
//
// The fix is the ordering, not a scheduler around it: retire the callback and advance the offset
// BEFORE invoking it, and flush from the offset the loop actually stands at, leaving it at zero.
// Behaviour for a consumer that does not re-enter is unchanged — same callbacks, same order, same
// counts.
replace(
  'const r=this._callbacks[this._bufferOffset];if(r&&r(),this._bufferOffset++,this._pendingData-=e.length,performance.now()-i>=12)break',
  'const r=this._callbacks[this._bufferOffset];if(this._callbacks[this._bufferOffset]=void 0,this._bufferOffset++,this._pendingData-=e.length,r&&r(),performance.now()-i>=12)break',
);
replace(
  'let e;this._isSyncWriting=!0;let t=!1;for(;e=this._writeBuffer.shift();){t=!0,this._action(e);const i=this._callbacks.shift();i&&i()}this._pendingData=0,this._bufferOffset=2147483647,this._writeBuffer.length=0,this._callbacks.length=0,this._isSyncWriting=!1,t&&this._onWriteParsed.fire()',
  'this._isSyncWriting=!0;let t=!1;for(;this._bufferOffset<this._writeBuffer.length;){const e=this._writeBuffer[this._bufferOffset],i=this._callbacks[this._bufferOffset];this._callbacks[this._bufferOffset]=void 0,this._bufferOffset++,t=!0,this._action(e),i&&i()}this._pendingData=0,this._bufferOffset=0,this._writeBuffer.length=0,this._callbacks.length=0,this._isSyncWriting=!1,t&&this._onWriteParsed.fire()',
);

// A refused store fences the parser: nothing more is interpreted into a screen that is already gone.
// The write callback still runs, so the consumer that fed the chunk is answered rather than parked.
replace(
  'parse(e,t){let i,s=this._activeBuffer.x,r=this._activeBuffer.y,n=0;',
  'parse(e,t){if(this._bufferService.dynamicStorage.refusal)return;let i,s=this._activeBuffer.x,r=this._activeBuffer.y,n=0;',
);

// The public read: what the stores hold now, and the refusal that ended interpretation. `lineBytes` is
// the running sum over both buffers, so a consumer asking after every chunk pays a field read rather
// than a walk of the scrollback.
//
// `trimHistory` is the normal buffer's, whichever screen is active: an application on the alternate
// screen still has scrollback behind it, and that is exactly the history worth taking. It answers how
// many rows actually went, which is never more than the history standing above the viewport.
replace(
  'get rows(){return this._core.rows}get cols(){return this._core.cols}',
  'get rows(){return this._core.rows}get cols(){return this._core.cols}' +
    'get dynamicStorage(){const e=this._core._bufferService.dynamicStorage;return{lineBytes:e.lineBytes,linkBytes:e.linkBytes,refusal:e.refusal}}' +
    'trimHistory(e){return this._verifyIntegers(e),this._core._bufferService.buffers.normal.trimHistory(e)}',
);

writeFileSync(bundlePath, bundle);

// ── the typings, where a consumer reads the contract ──────────────────────────────────────────────
const typingsPath = `${destination}/typings/${browser ? 'xterm.d.ts' : 'xterm-headless.d.ts'}`;
let typings = readFileSync(typingsPath, 'utf8');
const declare = (find, into) => {
  const count = typings.split(find).length - 1;
  if (count !== 1) throw new Error(`typings anchor matched ${count} times: ${find.slice(0, 60)}…`);
  typings = typings.split(find).join(into);
};

declare(
  `  export interface ITerminalOptions {
`,
  `  export interface ITerminalOptions {
    /**
     * What one terminal may retain in the stores that grow with the application's own output. Omitted
     * or zero, a store grows until the process runs out of memory.
     */
    dynamicStorage?: IDynamicStorageLimits;

`,
);

declare(
  `  export class Terminal implements IDisposable {
`,
  `  /**
   * What one terminal may retain in the stores that grow with output: the combined-character strings
   * and extended-attribute entries a buffer line holds, and the OSC 8 link data of the whole
   * terminal. Both are charged in accounting units over the retained values — an indexed slot is one
   * 8-byte JSValue, an object a 16-byte header with 8-byte inline slots, a 16-bit string a 16-byte
   * header plus two bytes a unit — and not measured from the allocator.
   */
  export interface IDynamicStorageLimits {
    /**
     * Bytes one buffer line may retain in its combined-character and extended-attribute maps. The
     * whole buffer is bounded by this times the lines it keeps: its rows, its scrollback and the
     * alternate screen. A line releases its account when it is cleared, filled, shrunk or recycled.
     */
    lineBytes?: number;

    /**
     * Bytes the terminal may retain in OSC 8 link data: the entries, their URIs and the markers that
     * hold them to their lines. Released as each marker's line leaves the buffer.
     */
    linkBytes?: number;
  }

  /**
   * The store that refused, what it would have held and what it was allowed to hold. A line store is
   * one buffer line's combined-character and extended-attribute storage, a link store the terminal's
   * OSC 8 link data, and a repeat store a REP demanding more than one parse may allocate.
   */
  export interface IDynamicStorageRefusal {
    readonly store: 'line' | 'link' | 'repeat';
    readonly bytes: number;
    readonly limit: number;
  }

  /**
   * What the terminal's dynamic stores hold now.
   */
  export interface IDynamicStorageState {
    /**
     * Bytes retained in the combined-character and extended-attribute maps of every line both buffers
     * hold, kept as a running sum: reading it costs a field read rather than a walk of the buffers.
     */
    readonly lineBytes: number;

    /** Bytes retained in OSC 8 link data. */
    readonly linkBytes: number;
    /**
     * Set when a declared limit was reached, and never cleared: the terminal interprets nothing
     * further, so the screen stands where the refusal found it instead of continuing as a guess.
     */
    readonly refusal: IDynamicStorageRefusal | undefined;
  }

  export class Terminal implements IDisposable {
`,
);

declare(
  `    readonly buffer: IBufferNamespace;
`,
  `    readonly buffer: IBufferNamespace;

    /**
     * What the dynamic stores hold, and the refusal that ended interpretation if one stands. Optional
     * because it is a capability of THIS build: a consumer reads it to learn whether the terminal it
     * holds bounds those stores at all, and an addon written against another xterm package stays
     * structurally compatible with this one.
     */
    readonly dynamicStorage?: IDynamicStorageState;

    /**
     * Drops up to \`rows\` of the OLDEST rows of the normal buffer's history and answers how many rows
     * actually went — never more than the history standing above the viewport, and 0 when there is
     * none. The scroll region, the cursor and the screen the application sees are untouched: what
     * moves is what \`resize\` moves when the scrollback shrinks, so an application holding a scroll
     * region is not corrupted by a trim it has no way to learn about.
     *
     * Optional for the same reason as \`dynamicStorage\`, and the reason is a compiler one: an addon
     * typed against \`@xterm/xterm\` declares \`activate(terminal: Terminal)\` of ITS Terminal, and a
     * required member here would make this build's Terminal unassignable to that one.
     */
    trimHistory?(rows: number): number;
`,
);

writeFileSync(typingsPath, typings);
if (browser) {
  const entry = `${destination}/lib/storage-entry.mjs`;
  writeFileSync(entry, 'import engine from "./xterm.js"; export const Terminal = engine.Terminal;');
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'browser',
    format: 'esm',
    minify: true,
    sourcemap: 'external',
    outdir: `${destination}/lib`,
    naming: 'xterm.mjs',
  });
  rmSync(entry);
  if (!result.success) throw new AggregateError(result.logs, 'the browser terminal did not build');
}
console.log(`patched ${bundlePath} (${bundle.length} bytes) and ${typingsPath} (${typings.length} bytes)`);
