/**
 * MD5, vendored — public domain, adapted from the RFC 1321 reference algorithm.
 *
 * Fandom's CDN puts every file under `<h[0]>/<h[0..2]>/` where `h` is the MD5
 * of the stored filename, so deriving a portrait URL offline (see `config.ts`)
 * needs MD5 and nothing else. `crypto.subtle` deliberately doesn't implement
 * MD5, and this repo has zero runtime dependencies — so ~60 lines live here
 * rather than a package in `dependencies`.
 *
 * Hashes the string's **UTF-8 bytes**, not its UTF-16 code units: HSR names
 * carry a literal U+2022 bullet (`Dan Heng • Imbibitor Lunae`), and hashing
 * that as anything but its three UTF-8 bytes lands in the wrong directory.
 *
 * Not for anything security-adjacent — MD5 is broken as a hash and is used
 * here only because it is the address scheme Fandom happens to use.
 */

// Binary integer parts of sin(i + 1), per the RFC. Written out rather than
// computed from Math.sin so the table can't drift on a ULP difference.
const K = new Int32Array([
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
]);

// Per-round left-rotation amounts; four per round, cycling every four steps.
const SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

const HEX = '0123456789abcdef';

function rotateLeft(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits));
}

/** Lowercase hex MD5 of a string's UTF-8 bytes. */
export function md5(input: string): string {
  const message = new TextEncoder().encode(input);

  // Pad to a whole number of 64-byte blocks: 0x80, then zeroes, then the
  // message length in bits as a little-endian u64.
  const padded = new Uint8Array(((message.length + 8) >> 6) * 64 + 64);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = message.length * 8;
  view.setUint32(padded.length - 8, bitLength >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLength / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const block = new Int32Array(16);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      block[i] = view.getInt32(offset + i * 4, true);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let mixed: number;
      let index: number;
      if (i < 16) {
        mixed = (b & c) | (~b & d);
        index = i;
      } else if (i < 32) {
        mixed = (d & b) | (~d & c);
        index = (5 * i + 1) % 16;
      } else if (i < 48) {
        mixed = b ^ c ^ d;
        index = (3 * i + 5) % 16;
      } else {
        mixed = c ^ (b | ~d);
        index = (7 * i) % 16;
      }

      const sum = (mixed + a + K[i] + block[index]) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotateLeft(sum, SHIFTS[(i >> 4) * 4 + (i % 4)])) | 0;
    }

    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  // The digest is the four words little-endian, so each byte's high nibble
  // comes first within the byte but the bytes themselves run low to high.
  let hex = '';
  for (const word of [a0, b0, c0, d0]) {
    for (let byte = 0; byte < 4; byte++) {
      const value = (word >>> (byte * 8)) & 0xff;
      hex += HEX[value >>> 4] + HEX[value & 0x0f];
    }
  }
  return hex;
}
