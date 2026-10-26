export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

export function utf8Order(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const here = left.charCodeAt(index);
    const there = right.charCodeAt(index);
    if (here === there) continue;
    const surrogate = (unit: number) => unit >= 0xd800 && unit <= 0xdfff;
    if (surrogate(here) !== surrogate(there)) return surrogate(here) ? 1 : -1;
    return here - there;
  }
  return left.length - right.length;
}
