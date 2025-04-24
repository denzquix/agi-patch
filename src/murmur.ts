
const rotl = (value: number, bits: number): number => (
  (value << bits) | (value >>> (32 - bits))
) >>> 0;

const c1 = 0xcc9e2d51;
const c2 = 0x1b873593;
const r1 = 15;
const r2 = 13;
const m = 5;
const n = 0xe6546b64;

const mix = (hash: number, k: number): number => {
  k = Math.imul(k, c1);
  k = rotl(k, r1);
  k = Math.imul(k, c2);

  hash ^= k;
  hash = rotl(hash, r2);
  hash = Math.imul(hash, m) + n;

  return hash >>> 0;
};

export class MurmurHash3 {
  private tail: number[] = [];
  private totalLength = 0;
  private hash: number;

  constructor(seed = 0) {
    this.hash = seed >>> 0;
  }

  add(data: Uint8Array): void {
    let pos = 0;
    let { hash } = this;

    if (this.tail.length > 0) {
      while (this.tail.length < 4 && pos < data.length) {
        this.tail.push(data[pos++]);
      }
      if (this.tail.length < 4) {
        return;
      }
      const k =
        (this.tail[0] |
          (this.tail[1] << 8) |
          (this.tail[2] << 16) |
          (this.tail[3] << 24)) >>> 0;
      hash = mix(hash, k);
      this.tail = [];
    }

    while (pos + 4 <= data.length) {
      const k =
        (data[pos] |
          (data[pos + 1] << 8) |
          (data[pos + 2] << 16) |
          (data[pos + 3] << 24)) >>> 0;
      hash = mix(hash, k);
      pos += 4;
    }

    while (pos < data.length) {
      this.tail.push(data[pos++]);
    }

    this.totalLength += data.length;
    this.hash = hash;
  }

  digest(): number {
    let { hash } = this;
    let k1 = 0;

    switch (this.tail.length) {
      case 3:
        k1 ^= this.tail[2] << 16;
        // fall through:
      case 2:
        k1 ^= this.tail[1] << 8;
        // fall through:
      case 1:
        k1 ^= this.tail[0];
        k1 = Math.imul(k1, c1);
        k1 = rotl(k1, r1);
        k1 = Math.imul(k1, c2);
        hash ^= k1;
        break;
    }

    hash ^= this.totalLength;
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x85ebca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2ae35);
    hash ^= hash >>> 16;

    return hash >>> 0;
  }
}
