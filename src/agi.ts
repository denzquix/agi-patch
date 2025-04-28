import { MurmurHash3 } from "./murmur";
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

export interface ObjectInfo {
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
  volNumber: number;
}

export interface AGIProject {
  words: AGIWordsFile;
  objects: ObjectFile;
  packedDirs: {basename:'dir' | 'dirs', prefix:string, suppressVolPrefix?:boolean} | false;
  logic: Array<AGILogic | InvalidLogic | InvalidResource | null>;
  pictures: Array<RawResource<'picture'> | InvalidResource | null>;
  sounds: Array<RawResource<'sound'> | InvalidResource | null>;
  views: Array<AGIView | InvalidResource | InvalidView | null>;
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
    const picdirFile = folder.getFile('picdir');
    const viewdirFile = folder.getFile('viewdir');
    const snddirFile = folder.getFile('snddir');
    if (!(viewdirFile && picdirFile && snddirFile)) {
      return null;
    }
    logdir = new Uint8Array(await (await logdirFile.getContent()).arrayBuffer());
    picdir = new Uint8Array(await (await picdirFile.getContent()).arrayBuffer());
    viewdir = new Uint8Array(await (await viewdirFile.getContent()).arrayBuffer());
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
    const picdirOffset = dirsDV.getUint16(2, true);
    const viewdirOffset = dirsDV.getUint16(4, true);
    const snddirOffset = dirsDV.getUint16(6, true);
    logdir = dirsData.subarray(logdirOffset, picdirOffset);
    picdir = dirsData.subarray(picdirOffset, viewdirOffset);
    viewdir = dirsData.subarray(viewdirOffset, snddirOffset);
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
    const volFile = folder.getFile((packedDirs && !packedDirs.suppressVolPrefix ? prefix : '')+'vol.'+volNumber);
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
      if (offset+2 > vol.length && !(offset+1 === vol.length && vol[offset] === 0x12)) {
        return {
          type: 'invalid-resource',
          problem: 'truncated',
          volNumber,
          offset,
        };  
      }
      return {
        type: 'invalid-resource',
        problem: 'invalid-signature',
        volNumber,
        offset,
      };
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
      let wasCompressed: boolean;
      if (decompressedLength === compressedLength && !picCompression) {
        decompressed = vol.subarray(offset + 7, offset + 7 + decompressedLength);
        wasCompressed = false;
      }
      else {
        wasCompressed = true;
        const compressed = vol.subarray(offset + 7, offset + 7 + compressedLength);
        try {
          if (picCompression) {
            decompressed = decompressPIC(compressed);
          }
          else {
            decompressed = decompressLZW(compressed);
          }
          if (decompressed.length !== decompressedLength) {
            throw new Error('wrong decompressed length');
          }
        }
        catch (e) {
          return {
            type: 'invalid-resource',
            problem: 'compression-error',
            volNumber,
            offset,
            error: e,
          };
        }
      }
      return {
        type: 'raw-resource',
        resourceType: type,
        data: decompressed,
        wasCompressed,
        volNumber,
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
        wasCompressed: false,
        volNumber,
      };
    }
  }
  return {
    words,
    objects,
    packedDirs,
    logic: await Promise.all(readDir(logdir).map(v => v ? loadEntry(v, 'logic').then(x => x.type === 'raw-resource' ? unpackLogic(x.data, !x.wasCompressed, v.volNumber) : x) : null)),
    views: await Promise.all(readDir(viewdir).map(v => v ? loadEntry(v, 'view').then(x => x.type === 'raw-resource' ? unpackView(x.data, v.volNumber) : x) : null)),
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
function decompressLZW(input: Uint8Array): Uint8Array {
  const INITIAL_BITS = 9;
  const MAX_BITS = 11;
  const LAST_CODE = (1 << MAX_BITS)-1;
  const RESET_CODE = 0x100;
  const STOP_CODE = 0x101;
  const FIRST_DYNAMIC_CODE = STOP_CODE + 1;
  const output: number[] = [];

  let bitBuffer = 0;
  let bitCount = 0;
  let bitPos = 0;

  const readBits = (numBits: number): number => {
    while (bitCount < numBits) {
      if (bitPos >= input.length) return STOP_CODE;
      bitBuffer |= input[bitPos++] << bitCount;
      bitCount += 8;
    }
    const result = bitBuffer & ((1 << numBits) - 1);
    bitBuffer >>>= numBits;
    bitCount -= numBits;
    return result;
  };

  const resetTable = () => {
    const table = new Map<number, number[]>();
    for (let i = 0; i < 256; i++) {
      table.set(i, [i]);
    }
    return table;
  };

  let codeSize = INITIAL_BITS;
  let table = resetTable();
  let nextCode = FIRST_DYNAMIC_CODE;

  let prev: number[] = [];

  while (true) {
    const code = readBits(codeSize);
    if (code === STOP_CODE) break; // end of data
    if (code === RESET_CODE) {
      codeSize = INITIAL_BITS;
      table = resetTable();
      nextCode = FIRST_DYNAMIC_CODE;
      prev = [];
      continue;
    }

    let entry: number[];
    if (table.has(code)) {
      entry = table.get(code)!;
    }
    else if (code >= nextCode && prev.length) {
      entry = [...prev, prev[0]];
    }
    else {
      throw new Error(`Invalid LZW code: ${code}`);
    }

    output.push(...entry);

    if (prev.length && nextCode <= LAST_CODE) {
      table.set(nextCode++, [...prev, entry[0]]);
      if (nextCode === (1 << codeSize) && codeSize < MAX_BITS) {
        codeSize++;
      }
    }

    prev = entry;
  }

  return new Uint8Array(output);
}

function compressLZW(input: Uint8Array): Uint8Array {
  const INITIAL_BITS = 9;
  const MAX_BITS = 11;
  const LAST_CODE = (1 << MAX_BITS) - 1;
  const RESET_CODE = 0x100;
  const STOP_CODE = 0x101;
  const FIRST_DYNAMIC_CODE = STOP_CODE + 1;
  const output: number[] = [];

  let bitBuffer = 0;
  let bitCount = 0;

  let logBuf: string[] = [];

  const writeBits = (code: number, numBits: number) => {
    logBuf.push(numBits + ':' + code);
    bitBuffer |= code << bitCount;
    bitCount += numBits;
    while (bitCount >= 8) {
      output.push(bitBuffer & 0xff);
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  };

  const flushBits = () => {
    if (bitCount > 0) {
      output.push(bitBuffer & 0xff);
      bitBuffer = 0;
      bitCount = 0;
    }
  };

  const resetTable = () => {
    const table = new Map<string, number>();
    for (let i = 0; i < 256; i++) {
      table.set(String.fromCharCode(i), i);
    }
    return table;
  };

  let codeSize = INITIAL_BITS;
  let table = resetTable();
  let nextCode = FIRST_DYNAMIC_CODE;
  let currentString = '';

  writeBits(RESET_CODE, codeSize);

  for (let i = 0; i < input.length; i++) {
    const byte = input[i];
    const newString = currentString + String.fromCharCode(byte);

    if (table.has(newString)) {
      currentString = newString;
    }
    else {
      writeBits(table.get(currentString)!, codeSize);

      if (nextCode <= LAST_CODE) {
        table.set(newString, nextCode++);
        if (nextCode - 1 === (1 << codeSize) && codeSize < MAX_BITS) {
          codeSize++;
        }
      }

      if (nextCode > LAST_CODE) {
        writeBits(RESET_CODE, codeSize);
        codeSize = INITIAL_BITS;
        table = resetTable();
        nextCode = FIRST_DYNAMIC_CODE;
      }

      currentString = String.fromCharCode(byte);
    }
  }

  // Write remaining string
  if (currentString.length > 0) {
    writeBits(table.get(currentString)!, codeSize);
  }

  // Write stop code
  writeBits(STOP_CODE, codeSize);
  flushBits();

  return new Uint8Array(output);
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

function unpackLogic(buf: Uint8Array, maskMessages: boolean, volNumber: number): AGILogic | InvalidLogic {
  const textOffset = 2 + (buf[0] | (buf[1] << 8));
  if (textOffset+3 > buf.byteLength) {
    return {
      type: 'invalid-logic',
      problem: 'truncated',
      data: buf,
      volNumber,
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
      volNumber,
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
          volNumber,
        };
      }
      const endOffset = textBlock.indexOf(0, ptr);
      if (endOffset === -1) {
        return {
          type: 'invalid-logic',
          problem: 'truncated',
          data: buf,
          volNumber,
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
    volNumber,
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
  error?: unknown;
}

export interface RawResource<T extends 'logic' | 'sound' | 'picture' | 'view' = 'logic' | 'sound' | 'picture' | 'view'> {
  type: 'raw-resource';
  resourceType: T;
  data: Uint8Array;
  wasCompressed: boolean;
  volNumber: number;
}

export interface InvalidLogic {
  type: 'invalid-logic';
  problem: 'truncated';
  data: Uint8Array;
  volNumber: number;
}

export interface AGICel {
  width: number;
  height: number;
  transparencyColor: number;
  pixelData: Uint8Array;
}

export interface AGILoop {
  cels: AGICel[];
}

export interface AGIView {
  type: 'view';
  signature: number;
  description?: Uint8Array | null;
  loops: AGILoop[];
  volNumber: number;
}

export interface InvalidView {
  type: 'invalid-view';
  problem: 'truncated-view-data' | 'pixel-data-exceeds-row' | 'unknown-signature';
  rawData: Uint8Array;
  volNumber: number;
}

function unpackView(data: Uint8Array, volNumber: number): AGIView | InvalidResource | InvalidView {
  const signature = data[0] | (data[1] << 8);
  switch (signature) {
    case 0x0100: case 0x0101: case 0x0102: case 0x0200: case 0x0700: case 0x0500: case 0x0103:
    case 0x0201: case 0x0202: case 0x0400: case 0x0401: case 0x0301: case 0x0203: case 0x0601:
    case 0x0501: case 0x0302: {
      break;
    }
    default: {
      return {
        type: 'invalid-view',
        problem: 'unknown-signature',
        rawData: data,
        volNumber,
      };
    }
  }
  const loops = new Array<AGILoop>(data[2]);
  const descriptionPos = data[3] | (data[4] << 8);
  let description: Uint8Array | null;
  if (descriptionPos) {
    let endOffset = data.indexOf(0, descriptionPos);
    if (endOffset === -1) endOffset = data.length;
    description = data.subarray(descriptionPos, endOffset);
  }
  else {
    description = null;
  }
  for (let loop_i = 0; loop_i < loops.length; loop_i++) {
    const loopPos = data[5 + loop_i*2] |(data[5 + loop_i*2 + 1] << 8);
    const cels = new Array<AGICel>(data[loopPos]);
    for (let cel_i = 0; cel_i < cels.length; cel_i++) {
      const celPos = loopPos + (data[loopPos + 1 + cel_i*2] | (data[loopPos + 1 + cel_i*2 + 1] << 8));
      const width = data[celPos];
      const height = data[celPos+1];
      const transpMirror = data[celPos+2];
      const transparencyColor = transpMirror & 0xf;
      const mirror = Boolean(transpMirror & 0x80) && loop_i !== ((transpMirror >>> 4) & 0x7);
      const celData = new Uint8Array(width * height);
      celData.fill(transparencyColor);
      let readPos = celPos + 3;
      for (let y = 0; y < height; y++) {
        let x = 0;
        for (;;) {
          if (readPos >= data.length) {
            return {
              type: 'invalid-view',
              problem: 'truncated-view-data',
              rawData: data,
              volNumber,
            };
          }
          const b = data[readPos++];
          if (b === 0) break;
          const color = b >>> 4;
          const len = b & 0xf;
          celData.fill(color, y*width + x, y*width + x + len);
          x += len;
          if (x > width) {
            return {
              type: 'invalid-view',
              problem: 'pixel-data-exceeds-row',
              rawData: data,
              volNumber,
            };
          }
        }
      }
      if (mirror) {
        for (let y = 0; y < height; y++) {
          celData.subarray(y*width, (y+1)*width).reverse();
        }
      }
      cels[cel_i] = {
        width,
        height,
        transparencyColor,
        pixelData: celData,
      };
    }
    loops[loop_i] = {cels};
  }
  return {
    type: 'view',
    signature,
    description,
    loops,
    volNumber,
  };
}

function areMirroredLoops(loop1: AGILoop, loop2: AGILoop) {
  if (loop1.cels.length !== loop2.cels.length) return false;
  const cel_count = loop1.cels.length;
  for (let cel_i = 0; cel_i < cel_count; cel_i++) {
    const cel1 = loop1.cels[cel_i], cel2 = loop2.cels[cel_i];
    if (cel1.width !== cel2.width
    || cel1.height !== cel2.height
    || cel1.transparencyColor !== cel2.transparencyColor) {
      return false;
    }
    const { width, height } = cel1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x <  width; x++) {
        if (cel1.pixelData[y*width + x] !== cel2.pixelData[(y+1)*width-(1+x)]) {
          return false;
        }
      }
    }
  }
  return true;
}

function packView(view: AGIView): Uint8Array {
  const mirrorLoops = new Array<number>(view.loops.length).fill(-1);
  for (let loop_i = 0; loop_i < Math.min(view.loops.length, 8) - 1; loop_i++) {
    if (mirrorLoops[loop_i] !== -1) continue;
    for (let loop_j = loop_i+1; loop_j < 8; loop_j++) {
      if (mirrorLoops[loop_j] !== -1) continue;
      if (areMirroredLoops(view.loops[loop_i], view.loops[loop_j])) {
        mirrorLoops[loop_i] = loop_j;
        mirrorLoops[loop_j] = loop_i;
        break;
      }
    }
  }
  const buf = new Uint8Array(
    5 + view.loops.length * 2 +
    (view.description ? view.description.length + 1 : 0) +
    view.loops.reduce(
      (total, loop) => (
        total + 1 + loop.cels.length * 2 +
        loop.cels.reduce((total, cel) => total + 3 + (cel.width+1)*cel.height, 0)
      ),
      0
    )
  );
  buf[0] = view.signature & 0xff;
  buf[1] = (view.signature >>> 8) & 0xff;
  buf[2] = view.loops.length;
  let pos = 5 + view.loops.length * 2;
  for (let i = 0; i < view.loops.length; i++) {
    const isMirror = mirrorLoops[i] !== -1;
    if (isMirror && mirrorLoops[i] < i) {
      buf[5 + i*2] = buf[5 + mirrorLoops[i]*2];
      buf[5 + i*2 + 1] = buf[5 + mirrorLoops[i]*2 + 1];
      continue;
    }
    const mirrorCode = isMirror ? 0x80 | (i << 4) : 0x00;
    const loopPos = pos;
    buf[5 + i*2] = loopPos & 0xff;
    buf[5 + i*2 + 1] = (loopPos >> 8) & 0xff;
    const loop = view.loops[i];
    buf[loopPos] = loop.cels.length;
    pos += 1 + loop.cels.length * 2;
    const dataStart = pos;
    for (let cel_i = 0; cel_i < loop.cels.length; cel_i++) {
      const celPos = pos - loopPos;
      buf[loopPos + 1 + cel_i*2] = celPos & 0xff;
      buf[loopPos + 1 + cel_i*2 + 1] = (celPos >>> 8) & 0xff;
      const cel = loop.cels[cel_i];
      buf[pos] = cel.width;
      buf[pos+1] = cel.height;
      buf[pos+2] = mirrorCode | cel.transparencyColor;
      pos += 3;
      for (let y = 0; y < cel.height; y++) {
        let x = 0;
        while (x < cel.width) {
          let color = cel.pixelData[(y * cel.width) + x];
          let x2 = x + 1;
          while (x2 < cel.width && cel.pixelData[(y * cel.width) + x2] === color) {
            x2++;
          }
          if (x2 === cel.width && color === cel.transparencyColor) {
            break;
          }
          let count = x2 - x;
          while (count > 15) {
            buf[pos++] = (color << 4) | 0xf;
            count -= 15;
          }
          buf[pos++] = (color << 4) | count;
          x = x2;
        }
        pos++; // end-of-line code
      }
    }
  }
  if (view.description) {
    buf[3] = pos & 0xff;
    buf[4] = (pos >>> 8) & 0xff;
    buf.set(view.description, pos);
    pos += view.description.length + 1;
  }
  if (pos > buf.length) {
    throw new Error('bad length!');
  }
  return buf.subarray(0, pos);
}

const byteArraysEqual = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v,i) => b[i] === v);

export const agisEqual = (agi1: AGIProject, agi2: AGIProject): boolean => {
  if (agi1.logic.length !== agi2.logic.length) return false;
  for (let i = 0; i < agi1.logic.length; i++) {
    const logic1 = agi1.logic[i], logic2 = agi2.logic[i];
    if (!logic1 || logic1.type !== 'logic') {
      if (logic2 && logic2.type === 'logic') return false;
      continue;
    }
    if (!logic2 || logic2.type !== 'logic') {
      return false;
    }
    if (!byteArraysEqual(logic1.bytecode, logic2.bytecode)) {
      return false;
    }
    if (logic1.messages.length !== logic2.messages.length) {
      return false;
    }
    for (let msg_i = 0; msg_i < logic1.messages.length; msg_i++) {
      const msg1 = logic1.messages[msg_i], msg2 = logic2.messages[msg_i];
      if (!msg1) {
        if (msg2) return false;
      }
      else {
        if (!msg2 || !byteArraysEqual(msg1, msg2)) return false;
      }
    }
  }
  if (agi1.objects.objects.length !== agi2.objects.objects.length) {
    return false;
  }
  for (let obj_i = 0; obj_i < agi1.objects.objects.length; obj_i++) {
    const obj1 = agi1.objects.objects[obj_i], obj2 = agi2.objects.objects[obj_i];
    if (!byteArraysEqual(obj1.name, obj2.name) || ((obj1.startingRoom || 0) !== (obj2.startingRoom || 0))) {
      return false;
    }
  }
  if (agi1.pictures.length !== agi2.pictures.length) {
    return false;
  }
  for (let pic_i = 0; pic_i < agi1.pictures.length; pic_i++) {
    const pic1 = agi1.pictures[pic_i], pic2 = agi2.pictures[pic_i];
    if (!pic1 || pic1.type !== 'raw-resource') {
      if (pic2 && pic2.type === 'raw-resource') {
        return false;
      }
    }
    else {
      if (!pic2 || pic2.type !== 'raw-resource') {
        return false;
      }
      if (!byteArraysEqual(pic1.data, pic2.data)) {
        return false;
      }
    }
  }
  if (agi1.sounds.length !== agi2.sounds.length) {
    return false;
  }
  for (let snd_i = 0; snd_i < agi1.sounds.length; snd_i++) {
    const snd1 = agi1.sounds[snd_i], snd2 = agi2.sounds[snd_i];
    if (!snd1 || snd1.type !== 'raw-resource') {
      if (snd2 && snd2.type === 'raw-resource') {
        return false;
      }
    }
    else {
      if (!snd2 || snd2.type !== 'raw-resource') {
        return false;
      }
      if (!byteArraysEqual(snd1.data, snd2.data)) {
        return false;
      }
    }
  }
  if (agi1.views.length !== agi2.views.length) {
    return false;
  }
  for (let view_i = 0; view_i < agi1.views.length; view_i++) {
    const view1 = agi1.views[view_i], view2 = agi2.views[view_i];
    if (!view1 || view1.type !== 'view') {
      if (view2 && view2.type === 'view') {
        return false;
      }
    }
    else {
      if (!view2 || view2.type !== 'view') {
        return false;
      }
      if (view1.signature !== view2.signature) {
        return false;
      }
      if (view1.description) {
        if (!view2.description || !byteArraysEqual(view1.description, view2.description)) {
          return false;
        }
      }
      else if (view2.description) {
        return false;
      }
      if (view1.loops.length !== view2.loops.length) {
        return false;
      }
      for (let loop_i = 0; loop_i < view1.loops.length; loop_i++) {
        const loop1 = view1.loops[loop_i], loop2 = view2.loops[loop_i];
        if (loop1.cels.length !== loop2.cels.length) {
          return false;
        }
        for (let cel_i = 0; cel_i < loop1.cels.length; cel_i++) {
          const cel1 = loop1.cels[cel_i], cel2 = loop2.cels[cel_i];
          if (cel1.width !== cel2.width || cel1.height !== cel2.height || cel1.transparencyColor !== cel2.transparencyColor || !byteArraysEqual(cel1.pixelData, cel2.pixelData)) {
            return false;
          }
        }
      }
    }
  }
  const words1 = [...agi1.words.words].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const words2 = [...agi2.words.words].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  if (JSON.stringify(words1) !== JSON.stringify(words2)) {
    return false;
  }
  return true;
};

enum AGISection {
  Logic = 1,
  Objects,
  Pictures,
  Sounds,
  Views,
  Words,
}

export const agiHash = (agi: AGIProject): number => {
  const h = new MurmurHash3();
  const vBytes = new Uint8Array(4);
  const v = new DataView(vBytes.buffer);

  const i32 = (num: number) => { v.setInt32(0, num, true); h.add(vBytes); };

  i32(AGISection.Logic);
  for (const [i, logic] of agi.logic.entries()) {
    if (!logic || logic.type !== 'logic') continue;
    i32(i);
    i32(logic.bytecode.length);
    h.add(logic.bytecode);
    for (const [j, message] of logic.messages.entries()) {
      if (message) {
        i32(j);
        i32(message.length);
        h.add(message);   
      }
    }
    i32(-1);
  }
  i32(-1);

  i32(AGISection.Objects);
  for (const [i, obj] of agi.objects.objects.entries()) {
    i32(i);
    i32(obj.startingRoom || 0);
    i32(obj.name.length);
    h.add(obj.name);
  }
  i32(-1);

  i32(AGISection.Pictures);
  for (const [i, pic] of agi.pictures.entries()) {
    if (!pic || pic.type !== 'raw-resource') continue;
    i32(i);
    h.add(pic.data);
  }
  i32(-1);

  i32(AGISection.Sounds);
  for (const [i, snd] of agi.sounds.entries()) {
    if (!snd || snd.type !== 'raw-resource') continue;
    i32(i);
    h.add(snd.data);
  }
  i32(-1);

  i32(AGISection.Views);
  for (const [i, view] of agi.views.entries()) {
    if (!view || view.type !== 'view') continue;
    i32(i);
    i32(view.signature);
    i32(view.loops.length);
    for (const loop of view.loops) {
      i32(loop.cels.length);
      for (const cel of loop.cels) {
        i32(cel.width);
        i32(cel.height);
        i32(cel.transparencyColor);
        h.add(cel.pixelData);
      }
    }
  }
  i32(-1);

  i32(AGISection.Words);
  for (const [word, num] of [...agi.words.words].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) {
    i32(num);
    i32(word.length);
    h.add(new Uint8Array([...word].map(v => v.charCodeAt(0))));
  }
  i32(-1);

  return h.digest();
};
