import { Schema } from 'effect';
import { PRINTED, type Printed } from '@runlith/utils/printed';

type Piece = { readonly text: string } | { readonly invalid: number };

const visible = (text: string): string =>
  text
    .replace(/\r\n/gu, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, (control) =>
      control === '\u007f' ? '␡' : String.fromCharCode(0x2400 + control.charCodeAt(0)),
    );

const lengthOf = (lead: number): number =>
  lead < 0x80 ? 1 : lead >= 0xc2 && lead <= 0xdf ? 2 : lead >= 0xe0 && lead <= 0xef ? 3 : lead >= 0xf0 && lead <= 0xf4 ? 4 : 0;

const continues = (byte: number | undefined): boolean => byte !== undefined && (byte & 0xc0) === 0x80;

const second = (lead: number, byte: number): boolean =>
  lead === 0xe0
    ? byte >= 0xa0 && byte <= 0xbf
    : lead === 0xed
      ? byte >= 0x80 && byte <= 0x9f
      : lead === 0xf0
        ? byte >= 0x90 && byte <= 0xbf
        : lead === 0xf4
          ? byte >= 0x80 && byte <= 0x8f
          : continues(byte);

const formed = (bytes: Uint8Array, at: number, seen: number): boolean =>
  bytes.subarray(at + 1, at + seen).every((byte, index) => (index === 0 ? second(bytes[at]!, byte) : continues(byte)));

export const windowText = (base64: string): readonly string[] => {
  const raw = atob(base64);
  const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
  const decoder = new TextDecoder();
  let start = 0;
  while (start < Math.min(bytes.length, 3) && continues(bytes[start])) start += 1;
  const pieces: Piece[] = [];
  let invalid = 0;
  let textBytes = 0;
  let from = start;
  let at = start;
  let cut: number | null = null;
  const flush = () => {
    if (at > from) pieces.push({ text: decoder.decode(bytes.subarray(from, at)) });
  };
  while (at < bytes.length) {
    const size = lengthOf(bytes[at]!);
    const tail = bytes.length - at;
    const valid = size > 0 && formed(bytes, at, Math.min(size, tail));
    if (valid && size <= tail) {
      at += size;
      textBytes += size;
      continue;
    }
    if (valid) {
      cut = at;
      break;
    }
    flush();
    const last = pieces[pieces.length - 1];
    if (last !== undefined && 'invalid' in last) pieces[pieces.length - 1] = { invalid: last.invalid + 1 };
    else pieces.push({ invalid: 1 });
    invalid += 1;
    at += 1;
    from = at;
  }
  flush();
  if (invalid > textBytes) return [`${bytes.length} bytes, not text: read the document (json) for them`];
  const marks = [
    ...(start === 0 ? [] : [`‹${start} bytes ending a character the window's start cut›`]),
    ...pieces.map((piece) => ('text' in piece ? visible(piece.text) : `‹${piece.invalid} invalid bytes›`)),
    ...(cut === null ? [] : [`‹${bytes.length - cut} bytes starting a character the window's end cut, at byte ${cut} of the window›`]),
  ];
  const lines = marks.join('').split('\n');
  return lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
};

const printed: Printed = (value) => (typeof value === 'string' ? windowText(value) : [String(value)]);

export const WindowBytes = Schema.String.check(Schema.isBase64()).annotate({ description: 'The bytes, base64.', [PRINTED]: printed });
