import { describe, expect, it } from 'vitest';
import { md5 } from '../src/data/wishes/portraits/md5.ts';

describe('md5', () => {
  // RFC 1321 test suite — the whole point of vendoring is that these still hold.
  it.each([
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 'd174ab98d277d9f5a5611c2c9f419d9f'],
    ['12345678901234567890123456789012345678901234567890123456789012345678901234567890', '57edf4a22be3c955ac49da2e2107b67a'],
  ])('hashes %j', (input, expected) => {
    expect(md5(input)).toBe(expected);
  });

  it('hashes multi-byte input as its UTF-8 bytes, not its UTF-16 code units', () => {
    // The bullet is U+2022 → three UTF-8 bytes. Get this wrong and every
    // bullet-bearing HSR name lands in the wrong CDN directory.
    expect(md5('Character_Dan_Heng_•_Imbibitor_Lunae_Icon.png')).toMatch(/^2a/);
    expect(md5('•')).toBe('53fe0881d8553a8d801dfb95b88f4e40');
  });

  it('pads correctly across the 55/56/64-byte block boundaries', () => {
    expect(md5('a'.repeat(55))).toBe('ef1772b6dff9a122358552954ad0df65');
    expect(md5('a'.repeat(56))).toBe('3b0c8ac703f828b04c6c197006d17218');
    expect(md5('a'.repeat(64))).toBe('014842d480b571495a4a0363793f7367');
  });
});
