import { VFSDirectory, VFSFile } from "./virtual-file-system";

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

export interface AGILogic {
  type: 'logic';
  bytecode: Uint8Array;
  messages: Array<Uint8Array | null>;
  maskMessages?: boolean;
}

export interface AGIProject {
  words: AGIWordsFile;
  objects: ObjectFile;
  packedDirs: {basename:'dir' | 'dirs', prefix:string, suppressVolPrefix?:boolean} | false;
  logic: Array<AGILogic | InvalidLogic | InvalidResource | null>;
  pictures: Array<RawResource<'picture'> | InvalidResource | null>;
  sounds: Array<RawResource<'sound'> | InvalidResource | null>;
  views: Array<RawResource<'view'> | InvalidResource | null>;
}

export async function loadAGIProject(folder: VFSDirectory): Promise<AGIProject | null> {

  const wordsFile = folder.getFile('words.tok');
  if (!wordsFile) return null;
  const words = unpackWords(new Uint8Array(await (await wordsFile.getContent()).arrayBuffer()));

  const objectFile = folder.getFile('object');
  if (!objectFile) return null;
  const objects = unpackObjects(new Uint8Array(await (await objectFile.getContent()).arrayBuffer()));

  const logdirFile = folder.getFile('logdir');
  let prefix = '';
  let logdir: Uint8Array, viewdir: Uint8Array, picdir: Uint8Array, snddir: Uint8Array;
  let packedDirs: AGIProject['packedDirs'];
  let useCompression: boolean;
  if (logdirFile) {
    const viewdirFile = folder.getFile('viewdir');
    const picdirFile = folder.getFile('picdir');
    const snddirFile = folder.getFile('snddir');
    if (!(viewdirFile && picdirFile && snddirFile)) {
      return null;
    }
    logdir = new Uint8Array(await (await logdirFile.getContent()).arrayBuffer());
    viewdir = new Uint8Array(await (await viewdirFile.getContent()).arrayBuffer());
    picdir = new Uint8Array(await (await picdirFile.getContent()).arrayBuffer());
    snddir = new Uint8Array(await (await snddirFile.getContent()).arrayBuffer());
    packedDirs = false;
    useCompression = false;
  }
  else {
    let dirsFile: VFSFile | null = null;
    for (const dirFile of folder.eachFile('*dir*')) {
      const m = dirFile.name.match(/^(.*)dirs?$/i);
      if (!m) continue;
      dirsFile = dirFile;
      prefix = m[1];
    }
    if (!dirsFile) {
      return null;
    }
    packedDirs = !prefix || folder.getFile(prefix+'vol.0') ? {basename:/s$/i.test(dirsFile.name)?'dirs':'dir', prefix} : {basename:/s$/i.test(dirsFile.name)?'dirs':'dir', prefix, suppressVolPrefix:true};
    const dirsData = new Uint8Array(await (await dirsFile.getContent()).arrayBuffer());
    const dirsDV = new DataView(dirsData.buffer, dirsData.byteOffset, dirsData.byteLength);
    const logdirOffset = dirsDV.getUint16(0, true);
    const viewdirOffset = dirsDV.getUint16(2, true);
    const picdirOffset = dirsDV.getUint16(4, true);
    const snddirOffset = dirsDV.getUint16(6, true);
    logdir = dirsData.subarray(logdirOffset, viewdirOffset);
    viewdir = dirsData.subarray(viewdirOffset, picdirOffset);
    picdir = dirsData.subarray(picdirOffset, snddirOffset);
    snddir = dirsData.subarray(snddirOffset);
    useCompression = true;
  }
  function readDir(dir: Uint8Array) {
    const array: Array<{volNumber: number, offset: number} | null> = [];
    for (let pos = 0; pos < dir.length; pos += 3) {
      const combo = (dir[pos] << 16) | (dir[pos + 1] << 8) | dir[pos + 2];
      if (combo === 0xffffff) {
        array.push(null);
      }
      else {
        const volNumber = combo >>> 20;
        const offset = combo & ((1 << 20)-1);
        array.push({volNumber, offset});
      }
    }
    return array;
  }
  const volCache: Map<number, Promise<Uint8Array>> = new Map();
  function getVol(volNumber: number): Promise<Uint8Array | null> {
    const cached = volCache.get(volNumber);
    if (cached) return cached;
    const volFile = folder.getFile(prefix+'vol.'+volNumber);
    if (!volFile) return Promise.resolve(null);
    const awaitVol = volFile.getContent().then(blob => blob.arrayBuffer()).then(ab => new Uint8Array(ab));
    volCache.set(volNumber, awaitVol);
    return awaitVol;
  }
  async function loadEntry<T extends 'picture' | 'view' | 'logic' | 'sound'>({volNumber, offset}: {volNumber:number, offset:number}, type: T): Promise<RawResource<T> | InvalidResource> {
    const vol = await getVol(volNumber);
    if (!vol) {
      return {
        type: 'invalid-resource',
        problem: 'missing-vol-file',
        volNumber,
        offset,
      };
    }
    if (vol[offset] !== 0x12 || vol[offset+1] !== 0x34) {
      throw new Error('signature not found');
    }
    if (useCompression) {
      const picCompression = Boolean(vol[offset+2] & 0x80);
      const checkVolNumber = vol[offset+2] & 0x7f;
      if (checkVolNumber !== volNumber) {
        return {
          type: 'invalid-resource',
          problem: 'vol-number-mismatch',
          volNumber,
          offset,
        }
      }
      const decompressedLength = vol[offset + 3] | (vol[offset + 4] << 8);
      const compressedLength = vol[offset + 5] | (vol[offset + 6] << 8);
      let decompressed: Uint8Array;
      if (decompressedLength === compressedLength) {
        decompressed = vol.subarray(offset + 7, offset + 7 + decompressedLength);
      }
      else {
        const compressed = vol.subarray(offset + 7, offset + 7 + compressedLength);
        decompressed = new Uint8Array(decompressedLength);
        try {
          decompressLZW(compressed, decompressed);
        }
        catch {
          return {
            type: 'invalid-resource',
            problem: 'compression-error',
            volNumber,
            offset,
          };
        }
      }
      if (picCompression) {
        decompressed = decompressPIC(decompressed);
      }
      return {
        type: 'raw-resource',
        resourceType: type,
        data: decompressed,
      };
    }
    else {
      const checkVolNumber = vol[offset+2];
      if (checkVolNumber !== volNumber) {
        return {
          type: 'invalid-resource',
          problem: 'vol-number-mismatch',
          volNumber,
          offset,
        }
      }
      const length = vol[offset + 3] | (vol[offset + 4] << 8);
      return {
        type: 'raw-resource',
        resourceType: type,
        data: vol.subarray(offset + 5, offset + 5 + length),
      };
    }
  }
  return {
    words,
    objects,
    packedDirs,
    logic: await Promise.all(readDir(logdir).map(v => v ? loadEntry(v, 'logic').then(x => x.type === 'raw-resource' ? unpackLogic(x.data, !useCompression) : x) : null)),
    views: await Promise.all(readDir(viewdir).map(v => v ? loadEntry(v, 'view') : null)),
    pictures: await Promise.all(readDir(picdir).map(v => v ? loadEntry(v, 'picture') : null)),
    sounds: await Promise.all(readDir(snddir).map(v => v ? loadEntry(v, 'sound') : null)),
  };
}

export async function *eachAGIProject(rootFolder: VFSDirectory) {
  for (const wordsFile of rootFolder.eachFile('**/words.tok')) {
    const project = await loadAGIProject(wordsFile.parentDirectory);
    if (project) yield project;
  }
}

// code based on xv3.pas by Lance Ewing
// http://www.agidev.com/articles/agispec/examples/files/xv3.pas
function decompressLZW(input: Uint8Array, output: Uint8Array): Uint8Array {
  const MAX_BITS = 12;
  const TABLE_SIZE = 18041;
  const START_BITS = 9;
  
  let bits = 0;
  let maxValue = 0;
  let maxCode = 0;
  let inputBitCount = 0;
  let inputBitBuffer = 0;
  
  const prefixCode = new Uint16Array(TABLE_SIZE);
  const appendCharacter = new Uint8Array(TABLE_SIZE);
  
  function setBits(value: number) {
    if (value === MAX_BITS) return;
    bits = value;
    maxValue = (1 << bits) - 1;
    maxCode = maxValue - 1;
  }
  
  function decodeString(code: number): number[] {
    const stack: number[] = [];
    let i = 0;
    while (code > 255) {
      stack.push(appendCharacter[code]);
      code = prefixCode[code];
      if (++i > 4000) throw new Error('Fatal error during code expansion');
    }
    stack.push(code);
    return stack.reverse();
  }

  let inputPos = 0;
  
  function inputCode(): number {
    while (inputBitCount <= 24 && inputPos < input.length) {
      inputBitBuffer |= input[inputPos++] << inputBitCount;
      inputBitCount += 8;
    }
    const result = inputBitBuffer & ((1 << bits) - 1);
    inputBitBuffer >>= bits;
    inputBitCount -= bits;
    if (inputPos >= input.length) return maxValue;
    return result;
  }

  let outPos = 0;

  setBits(START_BITS);
  let nextCode = 257;

  let oldCode = inputCode();
  let character = oldCode;
  let newCode = inputCode();

  while (outPos < output.length) {
    if (newCode === 0x100) {
      nextCode = 258;
      setBits(START_BITS);
      oldCode = inputCode();
      character = oldCode;
      output[outPos++] = character;
      newCode = inputCode();
      continue;
    }

    let decoded: number[];
    if (newCode >= nextCode) {
      decoded = decodeString(oldCode);
      decoded.push(character);
    } 
    else {
      decoded = decodeString(newCode);
    }

    character = decoded[decoded.length - 1];
    for (let i = 0; i < decoded.length && outPos < output.length; i++) {
      output[outPos++] = decoded[i];
    }

    if (nextCode <= maxCode) {
      prefixCode[nextCode] = oldCode;
      appendCharacter[nextCode] = character;
      nextCode++;
    } 
    else {
      setBits(bits + 1);
    }

    oldCode = newCode;
    newCode = inputCode();
  }

  return output;
}

function decompressPIC(pic: Uint8Array) {
  let bytePos = 0;
  let halfByte = false;
  const output: number[] = [];

  function readHalfByte(): number {
    if (halfByte) {
      halfByte = false;
      return pic[bytePos++] & 0x0f;
    }
    else {
      halfByte = true;
      return pic[bytePos] >>> 4;
    }
  }

  function readByte(): number {
    if (halfByte) {
      const high = pic[bytePos++] & 0x0f;
      const low = pic[bytePos] >>> 4;
      return (high << 4) | low;
    }
    else {
      return pic[bytePos++];
    }
  }

  while (bytePos < pic.length) {
    if (halfByte && bytePos === pic.length-1) break;
    const b = readByte();
    output.push(b);
    if (b === 0xf0 || b === 0xf2) {
      output.push(readHalfByte());
    }
  }

  return new Uint8Array(output);
}

function unpackLogic(buf: Uint8Array, maskMessages: boolean): AGILogic | InvalidLogic {
  const textOffset = 2 + (buf[0] | (buf[1] << 8));
  if (textOffset+3 >= buf.byteLength) {
    return {
      type: 'invalid-logic',
      problem: 'truncated',
      data: buf,
    };
  }
  const messageCount = buf[textOffset];
  const textBlock = buf.subarray(textOffset+1);
  const textBlockSize = textBlock[0] | (textBlock[1] << 8);
  if (textBlock.length < textBlockSize) {
    return {
      type: 'invalid-logic',
      problem: 'truncated',
      data: buf,
    };
  }
  const messageBlock = textBlock.subarray(2 + messageCount*2);
  if (maskMessages) avisDurgan(messageBlock);
  const messages = new Array<Uint8Array | null>(messageCount + 1);
  messages[0] = null;
  for (let i = 1; i < messages.length; i++) {
    const ptr = textBlock[i*2] | (textBlock[i*2 + 1] << 8);
    if (ptr === 0) {
      messages[i] = null;
    }
    else {
      if (ptr >= textBlock.byteLength) {
        return {
          type: 'invalid-logic',
          problem: 'truncated',
          data: buf,
        };
      }
      const endOffset = textBlock.indexOf(0, ptr);
      if (endOffset === -1) {
        return {
          type: 'invalid-logic',
          problem: 'truncated',
          data: buf,
        };
      }
      messages[i] = textBlock.subarray(ptr, endOffset);
    }
  }
  return {
    type: 'logic',
    bytecode: buf.subarray(2, textOffset),
    messages,
    maskMessages,
  };
}

function packLogic(logic: AGILogic): Uint8Array {
  const len = 2 + logic.bytecode.length + 1 + logic.messages.length*2 + logic.messages.reduce((total, msg) => total + (msg?msg.length+1:0), 0);
  const bytes = new Uint8Array(len);
  bytes[0] = logic.bytecode.length & 0xff;
  bytes[1] = logic.bytecode.length >>> 8;
  bytes.set(logic.bytecode, 2);
  bytes[2 + logic.bytecode.length] = logic.messages.length;
  const textBlock = bytes.subarray(2 + logic.bytecode.length + 1);
  let pos = logic.messages.length*2;
  for (let i = 0; i < logic.messages.length; i++) {
    const message = logic.messages[i];
    if (!message) continue;
    textBlock[i*2] = pos & 0xff;
    textBlock[i*2 + 1] = pos >>> 8;
    textBlock.set(message, pos);
    pos += message.length + 1;
  }
  if (logic.maskMessages) avisDurgan(textBlock.subarray(logic.messages.length*2));
  return bytes;
}

export interface InvalidResource {
  type: 'invalid-resource';
  problem:'missing-vol-file' | 'past-eof' | 'invalid-signature' | 'truncated' | 'compression-error' | 'vol-number-mismatch';
  volNumber:number;
  offset:number;
  recordData?: Uint8Array | null;
}

export interface RawResource<T extends 'logic' | 'sound' | 'picture' | 'view' = 'logic' | 'sound' | 'picture' | 'view'> {
  type: 'raw-resource';
  resourceType: T;
  data: Uint8Array;
}

export interface InvalidLogic {
  type: 'invalid-logic';
  problem: 'truncated';
  data: Uint8Array;
}
