import { agiHash, AGIProject } from "./agi";
import { diffBytes } from "./diff";

export type BytePatch = string;

export interface PatchObject {
  type: 'agi';
  hashOriginal: string;
  hashPatched: string;
  words?: {
    [word: string]: number | null;
  };
  logic?: {
    [num: number]: null | {
      bytecode?: BytePatch;
      messages?: {
        [num: number]: BytePatch | null;
      };
    };
  };
}

export interface PatchContainer {
  formatVersion: number;
  patches: PatchObject[];
}

const byteArraysEqual = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v,i) => b[i] === v);

function applyDiff(a: Uint8Array, bytepool: Uint8Array, diff: string) {
  const steps = diff.matchAll(/\s*([@\+\-=~])\s*([0-9a-fA-F]+)/g);
  let aOffset = 0, bOffset = 0;
  const output: number[] = [];
  for (const [, symbol, numStr] of steps) {
    const num = parseInt(numStr, 16);
    switch(symbol) {
      case '@': bOffset = num; break;
      case '-': aOffset += num; break;
      case '=':
        for (let i = 0; i < num; i++) {
          output.push(a[aOffset++]);
        }
        if (aOffset > a.length) {
          throw new Error('read past end of input');
        }
        break;
      case '+':
        for (let i = 0; i < num; i++) {
          output.push(bytepool[bOffset++]);
        }
        if (bOffset > bytepool.length) {
          throw new Error('read past end of input');
        }
        break;
      case '~':
        for (let i = 0; i < num; i++) {
          output.push(a[aOffset++] ^ bytepool[bOffset++]);
        }
        if (aOffset > a.length || bOffset > bytepool.length) {
          throw new Error('read past end of input');
        }
        break;
    }
  }
  return new Uint8Array(output);
}

export function createAGIPatch(srcAGI: AGIProject, dstAGI: AGIProject): {json:PatchContainer, bytepool:Blob} {
  const patchObject: PatchObject = {
    type: 'agi',
    hashOriginal: agiHash(srcAGI).toString(16).padStart(8, '0'),
    hashPatched: agiHash(dstAGI).toString(16).padStart(8, '0'),
  };
  const patchContainer: PatchContainer = {
    formatVersion: 1,
    patches: [patchObject],
  };


  const chunks: Uint8Array[] = [];
  let chunkPos = 0;
  const writeChunk = (chunk: Uint8Array) => {
    let startPos = chunkPos;
    chunks.push(chunk);
    chunkPos += chunk.length;
    return startPos;
  };

  const dataDiff = (chunk1: Uint8Array | null, chunk2: Uint8Array) => {
    if (!chunk1) {
      const start = writeChunk(chunk2);
      return `@${start.toString(16)} +${chunk2.length.toString(16)}`;
    }
    const parts = diffBytes(chunk1, chunk2);
    const diffStringParts: string[] = [];
    let startPos = -1;
    let chunk1_pos = 0, chunk2_pos = 0;
    for (let part_i = 0; part_i < parts.length; part_i++) {
      const part = parts[part_i];
      switch (part.type) {
        case 'delete':
          diffStringParts.push('-' + part.count.toString(16));
          chunk1_pos += part.count;
          break;
        case 'insert':
          if (startPos === -1) startPos = writeChunk(part.bytes);
          else writeChunk(part.bytes);
          diffStringParts.push('+' + part.bytes.length.toString(16));
          chunk2_pos += part.bytes.length;
          break;
        case 'same':
          diffStringParts.push('=' + part.count.toString(16));
          chunk1_pos += part.count;
          chunk2_pos += part.count;
          break;
        case 'replace':
          diffStringParts.push('~' + part.bytes.length.toString(16));
          const xorChunk = new Uint8Array(part.bytes.length);
          for (let i = 0; i < xorChunk.length; i++) {
            xorChunk[i] = chunk1[chunk1_pos++] ^ chunk2[chunk2_pos++];
          }
          if (startPos === -1) startPos = writeChunk(xorChunk);
          else writeChunk(xorChunk);
          break;
        }
    }
    return (startPos===-1?'':`@${startPos.toString(16)} `) + diffStringParts.join(' ');
  };

  const wordsDiff: {[word: string]: number | null} = {};

  const words1 = srcAGI.words;
  const words2 = dstAGI.words;

  const combinedWords = new Set([...words1.words.keys(), ...words2.words.keys()]);

  for (const word of combinedWords) {
    const v1 = words1.words.get(word), v2 = words2.words.get(word);
    if (v1 === v2) continue;
    wordsDiff[word] = typeof v2 === 'undefined' ? null : v2;
  }

  if (Object.keys(wordsDiff).length !== 0) {
    patchObject.words = wordsDiff;
  }

  const logic_count = Math.max(srcAGI.logic.length, dstAGI.logic.length);
  const logicDiff: PatchObject['logic'] = {};
  for (let logic_i = 0; logic_i < logic_count; logic_i++) {
    const logic1 = srcAGI.logic[logic_i], logic2 = dstAGI.logic[logic_i];
    if (!logic2) {
      if (logic1 && logic1.type === 'logic') {
        logicDiff[1] = null;
      }
      continue;
    }
    if (logic2.type !== 'logic') {
      throw new Error('Target logic ' + logic_i + ' is invalid');
    }
    if (!logic1 || logic1.type !== 'logic') {
      const bytecode = dataDiff(null, logic2.bytecode);
      const messages: {[num: number]: string} = {};
      for (let i = 0; i < logic2.messages.length; i++) {
        const msgBytes = logic2.messages[i];
        if (msgBytes) {
          messages[i] = dataDiff(null, msgBytes);
        }
      }
      logicDiff[logic_i] = {bytecode, messages};
      continue;
    }
    let bytecode: string | undefined = undefined;
    if (!byteArraysEqual(logic1.bytecode, logic2.bytecode)) {
      bytecode = dataDiff(logic1.bytecode, logic2.bytecode);
    }
    let messages: {[num: number]: string | null} = {};
    for (let i = 0; i < Math.max(logic1.messages.length, logic2.messages.length); i++) {
      const msg1 = logic1.messages[i], msg2 = logic2.messages[i];
      if (!msg1) {
        if (msg2) {
          messages[i] = dataDiff(null, msg2);
        }
      }
      else if (!msg2) {
        messages[i] = null;
      }
      else if (!byteArraysEqual(msg1, msg2)) {
        messages[i] = dataDiff(msg1, msg2);
      }
    }
    const bytecodePart = bytecode ? {bytecode} : null;
    const messagePart = Object.keys(messages).length !== 0 ? {messages} : null;
    if (bytecodePart || messagePart) {
      logicDiff[logic_i] = {
        ...bytecodePart,
        ...messagePart,
      };
    }
  }
  if (Object.keys(logicDiff).length !== 0) {
    patchObject.logic = logicDiff;
  }

  return {
    json: patchContainer,
    bytepool: new Blob(chunks),
  }
}

export function applyAGIPatch(srcAGI: AGIProject, patchContainer: PatchContainer, bytepool: Uint8Array) {
  const logic = [...srcAGI.logic];
  const objects = {...srcAGI.objects};
  const packedDirs = srcAGI.packedDirs;
  const pictures = [...srcAGI.pictures];
  const sounds = [...srcAGI.sounds];
  const views = [...srcAGI.views];
  const words = {words: new Map(srcAGI.words.words), suffix:srcAGI.words.suffix};

  const hash = agiHash(srcAGI);

  for (const patch of patchContainer.patches) {
    const originalHash = parseInt(patch.hashOriginal, 16);
    if (originalHash !== hash) {
      continue;
    }

    if (patch.logic) {
      for (const [logic_i_str, logicEntry] of Object.entries(patch.logic)) {
        const logic_i = Number(logic_i_str);
        if (logic_i >= logic.length) logic.length = logic_i + 1;
        if (logicEntry === null) {
          logic[logic_i] = null;
          continue;
        }
        const existingLogic = logic[logic_i] && logic[logic_i].type === 'logic' ? logic[logic_i] : null;
        const existingBytecode = existingLogic ? existingLogic.bytecode : new Uint8Array(0);
        const bytecode = logicEntry.bytecode ? applyDiff(existingBytecode, bytepool, logicEntry.bytecode) : existingBytecode;
        const messages = existingLogic ? [...existingLogic.messages] : [];
        for (const [msg_i_str, msgDiff] of Object.entries(logicEntry.messages || {})) {
          const msg_i = Number(msg_i_str);
          if (msg_i >= messages.length) {
            messages.length = msg_i + 1;
          }
          if (msgDiff === null) {
            messages[msg_i] = null;
          }
          else {
            const existingMsg = messages[msg_i] || new Uint8Array(0);
            messages[msg_i] = applyDiff(existingMsg, bytepool, msgDiff);
          }
        }
        logic[logic_i] = {
          type: 'logic',
          bytecode,
          messages,
        };
      }
    }
  
    if (patch.words) {
      for (const [word, id] of Object.entries(patch.words)) {
        if (id == null) {
          words.words.delete(word);
        }
        else {
          words.words.set(word, id);
        }
      }
    }
  
    const newAGI: AGIProject = {
      logic,
      objects,
      packedDirs,
      pictures,
      sounds,
      views,
      words,
    };

    const finalHash = agiHash(newAGI);
    if (finalHash !== parseInt(patch.hashPatched, 16)) {
      throw new Error('hash check failed');
    }
  
    return newAGI;
  
  }
  throw new Error('no matching patch found');

}
