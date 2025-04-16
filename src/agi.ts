
export interface AGIWordsFile {
  words: Map<string, number>;
  suffix?: Uint8Array;
}

const commonPrefixLen = (a: string, b: string) => {
  const minLen = Math.min(a.length, b.length);
  let i = 0;
  while (i < minLen && a[i] === b[i]) i++;
  return i;
};

const AVIS_DURGAN = new Uint8Array([...'Avis Durgan'].map(v => v.charCodeAt(0)));

const avisDurgan = (b: Uint8Array) => {
  for (let i = 0; i < b.length; i++) {
    b[i] ^= AVIS_DURGAN[i % AVIS_DURGAN.length];
  }
  return b;
};

export function unpackWords(wordsData: Uint8Array): AGIWordsFile {
  let pos = 26 * 2;
  if (pos >= wordsData.length) return {words:new Map()};
  let lastWord = '';
  const words = new Map<string, number>();
  while (pos < wordsData.length) {
    if (wordsData[pos] === 0 && pos+1 === wordsData.length) {
      return {words};
    }
    const startPos = pos;
    if (wordsData[pos] > lastWord.length) {
      throw new Error('invalid prefix');
    }
    let word = lastWord.slice(0, wordsData[pos++]);
    let byte: number;
    do {
      byte = wordsData[pos++];
      if (pos >= wordsData.length) break;
      word += String.fromCharCode((byte & 0x7f) ^ 0x7f);
    } while ((byte & 0x80) === 0);
    if ((pos+2) > wordsData.length || word < lastWord) {
      return {words, suffix:wordsData.subarray(startPos)};
    }
    const wordNum = (wordsData[pos] << 8) | wordsData[pos + 1];
    pos += 2;
    words.set(word, wordNum);
    lastWord = word;
  }
  return {words, suffix: new Uint8Array(0)};
}

export function packWords({words, suffix = new Uint8Array([0])}: AGIWordsFile) {
  const wordList = [...words.keys()].sort();
  if (wordList.some(w => /[^\x00-\x7f]/.test(w))) {
    throw new Error('word list must not contain only ASCII-7 characters');
  }
  const encoded = wordList.map((word, i, a) => {
    const prefixLen = i === 0 ? 0 : Math.min(255, commonPrefixLen(word, a[i-1]));
    if (prefixLen === word.length) {
      throw new Error('word list must contain only unique words');
    }
    const codes = [prefixLen];
    for (let i = prefixLen; i < word.length; i++) {
      codes.push(word.charCodeAt(i) ^ 0x7f);
    }
    codes[codes.length-1] |= 0x80;
    const num = words.get(word)! & 0xffff;
    codes.push(num >>> 8, num & 0xff);
    return codes;
  });
  const bufSize = 26 * 2 + encoded.reduce((total, codes) => total + codes.length, 0) + suffix.length;
  const bytes = new Uint8Array(bufSize);
  let pos = 26 * 2;
  let lastFirstLetter = '';
  for (let i = 0; i < encoded.length; i++) {
    bytes.set(encoded[i], pos);
    const firstLetter = wordList[i][0];
    if (firstLetter !== lastFirstLetter) {
      const letterIndex = firstLetter.charCodeAt(0) - 'a'.charCodeAt(0);
      if (letterIndex >= 0 && letterIndex < 26) {
        if (pos > 0xffff) {
          throw new Error('words file too big');
        }
        bytes[letterIndex*2] = pos >> 8;
        bytes[letterIndex*2 + 1] = pos & 0xff;
        lastFirstLetter = firstLetter;
      }
    }
    pos += encoded[i].length;
  }
  bytes.set(suffix, pos);
  return bytes;
}

interface ObjectInfo {
  name: Uint8Array;
  startingRoom?: number;
}

interface ObjectFile {
  objects: ObjectInfo[];
  masked: boolean;
  recordLen: 3 | 4;
  suppressFinalTerminator?: boolean;
}

export function unpackObjects(objectsData: Uint8Array): ObjectFile {
  let recordLen: 3 | 4 = 4, masked = true;
  masked = (objectsData[0] | (objectsData[1] << 8)) > objectsData.length;
  if (masked) {
    objectsData = avisDurgan(objectsData.slice());
    console.log(objectsData);
  }
  if (objectsData[3] !== 0) recordLen = 3;
  let objects: ObjectInfo[] = [];
  let pos = 0;
  let stopPos = Infinity;
  let suppressFinalTerminator = false;
  while ((pos+recordLen) <= stopPos) {
    const offset = recordLen + (objectsData[pos] | (objectsData[pos+1] << 8));
    stopPos = Math.min(stopPos, offset);
    let endOffset = objectsData.indexOf(0, offset);
    if (endOffset === -1) {
      endOffset = objectsData.length;
      suppressFinalTerminator = true;
    }
    const name = objectsData.subarray(offset, endOffset), startingRoom = objectsData[pos + 2];
    objects.push(startingRoom ? {name, startingRoom} : {name});
    pos += recordLen;
  }
  return { objects, masked, recordLen, suppressFinalTerminator, };
}

export function packObjects({ recordLen, objects, masked, suppressFinalTerminator }: ObjectFile): Uint8Array {
  const buf = new Uint8Array(recordLen * objects.length + objects.reduce((total, object) => total + object.name.length + 1, 0));
  let pos = recordLen * objects.length;
  const posCache = new Map<string, number>();
  for (let i = 0; i < objects.length; i++) {
    const name = String.fromCharCode(...objects[i].name);
    if (posCache.has(name)) {
      const cached = posCache.get(name)!;
      buf[i*recordLen] = cached & 0xff;
      buf[i*recordLen + 1] = (cached >>> 8);
    }
    else {
      const encPos = pos - recordLen;
      posCache.set(name, encPos);
      buf[i*recordLen] = encPos & 0xff;
      buf[i*recordLen + 1] = (encPos >>> 8);
      buf.set(objects[i].name, pos);
      pos += objects[i].name.length + 1;
    }
    buf[i*recordLen + 2] = objects[i].startingRoom || 0;
  }
  if (masked) avisDurgan(buf);
  return buf.subarray(0, pos + (suppressFinalTerminator?-1:0));
}
