import { AGIProject } from "./agi";

export type BytePatch = string;

export interface PatchJSON {
  formatVersion: number;
  type: 'agi';
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

export function applyAGIPatch(srcAGI: AGIProject, patch: PatchJSON, bytepool: Uint8Array) {
  const logic = [...srcAGI.logic];
  const objects = {...srcAGI.objects};
  const packedDirs = srcAGI.packedDirs;
  const pictures = [...srcAGI.pictures];
  const sounds = [...srcAGI.sounds];
  const views = [...srcAGI.views];
  const words = {words: new Map(srcAGI.words.words), suffix:srcAGI.words.suffix};

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

  return newAGI;
}
