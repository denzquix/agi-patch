import { AGICel, agiHash, AGILoop, AGIProject, ObjectInfo } from "./agi";
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
      volNumber?: number;
    };
  };
  pictures?: {
    [num: number]: null | {
      data?: BytePatch;
      volNumber?: number;
    };
  };
  sounds?: {
    [num: number]: null | {
      data?: BytePatch;
      volNumber?: number;
    };
  };
  objects?: {
    [num: number]: null | {
      name?: BytePatch;
      startingRoom?: number;
    };
  };
  views?: {
    [num: number]: null | {
      signature?: number;
      loops?: {
        [num: number]: null | {
          cels: {
            [num: number]: null | {
              width?: number;
              height?: number;
              transparencyColor?: number;
              pixelData: BytePatch;
            };
          }
        };
      };
      volNumber?: number;
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
      logicDiff[logic_i] = {bytecode, messages, volNumber:logic2.volNumber};
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
    const volNumberPart = logic1.volNumber === logic2.volNumber ? null : {volNumber:logic2.volNumber};
    if (bytecodePart || messagePart || volNumberPart) {
      logicDiff[logic_i] = {
        ...bytecodePart,
        ...messagePart,
        ...volNumberPart,
      };
    }
  }
  if (Object.keys(logicDiff).length !== 0) {
    patchObject.logic = logicDiff;
  }

  const picture_count = Math.max(srcAGI.pictures.length, dstAGI.pictures.length);
  const pictureDiff: PatchObject['pictures'] = {};
  for (let pic_i = 0; pic_i < picture_count; pic_i++) {
    const pic1 = srcAGI.pictures[pic_i], pic2 = dstAGI.pictures[pic_i];
    if (!pic2 || pic2.type !== 'raw-resource') {
      if (pic1 && pic1.type === 'raw-resource') {
        pictureDiff[pic_i] = null;
      }
      continue;
    }
    const pic1Data = pic1 && pic1.type === 'raw-resource' ? pic1.data : null;
    const pic2Data = pic2.data;
    const dataPart = pic1Data == null || !byteArraysEqual(pic1Data, pic2Data) ? {data:dataDiff(pic1Data, pic2Data)} : null;
    const volNumberPart = pic1 && pic1.volNumber !== pic2.volNumber ? {volNumber:pic2.volNumber} : null;
    if (dataPart || volNumberPart) {
      pictureDiff[pic_i] = {
        ...dataPart,
        ...volNumberPart,
      };
    }
  }
  if (Object.keys(pictureDiff).length !== 0) {
    patchObject.pictures = pictureDiff;
  }

  const sound_count = Math.max(srcAGI.sounds.length, dstAGI.sounds.length);
  const soundDiff: PatchObject['sounds'] = {};
  for (let snd_i = 0; snd_i < sound_count; snd_i++) {
    const snd1 = srcAGI.sounds[snd_i], snd2 = dstAGI.sounds[snd_i];
    if (!snd2 || snd2.type !== 'raw-resource') {
      if (snd1 && snd1.type === 'raw-resource') {
        soundDiff[snd_i] = null;
      }
      continue;
    }
    const snd1Data = snd1 && snd1.type === 'raw-resource' ? snd1.data : null;
    const snd2Data = snd2.data;
    const dataPart = snd1Data == null || !byteArraysEqual(snd1Data, snd2Data) ? {data:dataDiff(snd1Data, snd2Data)} : null;
    const volNumberPart = snd1 && snd1.volNumber !== snd2.volNumber ? {volNumber:snd2.volNumber} : null;
    if (dataPart || volNumberPart) {
      soundDiff[snd_i] = {
        ...dataPart,
        ...volNumberPart,
      };
    }
  }
  if (Object.keys(soundDiff).length !== 0) {
    patchObject.sounds = soundDiff;
  }

  const view_count = Math.max(srcAGI.views.length, dstAGI.views.length);
  const viewDiff: PatchObject['views'] = {};
  for (let view_i = 0; view_i < view_count; view_i++) {
    const view1 = srcAGI.views[view_i], view2 = dstAGI.views[view_i];
    if (!view2 || view2.type !== 'view') {
      if (view1 && view1.type === 'view') {
        viewDiff[view_i] = null;
      }
      continue;
    }
    const newSignature = (view1 && view1.type === 'view' && view1.signature === view2.signature) ? null : view2.signature;
    const loop_count = view2.loops.length;
    const loops: {
      [num: number]: null | {
        cels: {
          [num: number]: null | {
            width?: number;
            height?: number;
            transparencyColor?: number;
            pixelData: BytePatch;
          };
        }
      };
    } = {};
    const loops1 = view1 && view1.type === 'view' ? view1.loops : [];
    for (let loop_i = 0; loop_i < view2.loops.length; loop_i++) {
      const cels1 = loops1[loop_i] && loops1[loop_i].cels || [];
      const cels2 = view2.loops[loop_i].cels;
      const cels: {
        [num: number]: null | {
          width?: number;
          height?: number;
          transparencyColor?: number;
          pixelData: BytePatch;
        };
      } = {};
      for (let cel_i = 0; cel_i < cels2.length; cel_i++) {
        const cel1 = cels1[cel_i], cel2 = cels2[cel_i];
        if (!cel1) {
          cels[cel_i] = {
            width: cel2.width,
            height: cel2.height,
            transparencyColor: cel2.transparencyColor,
            pixelData: dataDiff(null, cel2.pixelData),
          };
        }
        else {
          const newWidth = (cel1.width === cel2.width) ? null : cel2.width;
          const newHeight = (cel1.height === cel2.height) ? null : cel2.height;
          const newTransp = (cel1.transparencyColor === cel2.transparencyColor) ? null : cel2.transparencyColor;
          let pixelDiff: string | null;
          if (byteArraysEqual(cel1.pixelData, cel2.pixelData)) {
            pixelDiff = null;
          }
          else {
            const srcData = new Uint8Array(cel2.width * cel2.height);
            srcData.fill(cel1.transparencyColor);
            for (let y = 0; y < Math.min(cel1.height, cel2.height); y++) {
              srcData.set(cel1.pixelData.subarray(cel1.width * y, cel1.width * y + Math.min(cel1.width, cel2.width)), cel2.width * y);
            }
            pixelDiff = dataDiff(srcData, cel2.pixelData);
          }
          if (newWidth != null || newHeight != null || newTransp != null || pixelDiff != null) {
            cels[cel_i] = {
              ... newWidth != null ? {width:newWidth} : null,
              ... newHeight != null ? {height:newHeight} : null,
              ... newTransp != null ? {transparencyColor:newTransp} : null,
              pixelData: pixelDiff || ('='+cel1.pixelData.length),
            };
          }
        }
      }
      for (let cel_i = cels2.length; cel_i < cels1.length; cel_i++) {
        cels[cel_i] = null;
      }
      loops[loop_i] = {cels};
    }
    for (let loop_i = view2.loops.length; loop_i < loops1.length; loop_i++) {
      loops[loop_i] = null;
    }
    const anyLoops = Object.keys(loops).length > 0;
    const volNumberPart = view1 && view1.volNumber === view2.volNumber ? null : {volNumber:view2.volNumber};
    if (newSignature != null || anyLoops) {
      viewDiff[view_i] = {
        ...(newSignature != null) ? {signature:newSignature} : null,
        ...anyLoops ? {loops} : null,
        ...volNumberPart,
      };
    }
  }
  if (Object.keys(viewDiff).length !== 0) {
    patchObject.views = viewDiff;
  }

  const object_count = dstAGI.objects.objects.length;
  const objectDiff: PatchObject['objects'] = {};
  for (let obj_i = 0; obj_i < object_count; obj_i++) {
    const obj1 = srcAGI.objects.objects[obj_i], obj2 = dstAGI.objects.objects[obj_i];
    const name1 = obj1 ? obj1.name : new Uint8Array(0);
    const room1 = obj1 && obj1.startingRoom || 0;
    const name2 = obj2.name;
    const room2 = obj2.startingRoom || 0;
    const nameDiff = byteArraysEqual(name1, name2) ? null : dataDiff(name1, name2);
    const roomDiff = room1 !== room2 ? room2 : null;
    if (nameDiff != null || roomDiff != null) {
      objectDiff[obj_i] = {
        ...nameDiff != null ? {name:nameDiff} : null,
        ...roomDiff != null ? {room:roomDiff} : null,
      };
    }
  }
  for (let obj_i = dstAGI.objects.objects.length; obj_i < srcAGI.objects.objects.length; obj_i++) {
    objectDiff[obj_i] = null;
  }
  if (Object.keys(objectDiff).length !== 0) {
    patchObject.objects = objectDiff;
  }

  return {
    json: patchContainer,
    bytepool: new Blob(chunks),
  };
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
          volNumber: logicEntry.volNumber ?? existingLogic?.volNumber ?? 0,
        };
      }
    }

    if (patch.objects) {
      const objectList: Array<ObjectInfo | null> = objects.objects.slice();
      for (const [obj_i_str, objEntry] of Object.entries(patch.objects)) {
        const obj_i = Number(obj_i_str);
        if (obj_i >= objectList.length) {
          objectList.length = obj_i+1;
        }
        if (objEntry == null) {
          objectList[obj_i] = null;
          continue;
        }
        if (!objectList[obj_i]) {
          if (!objEntry.name) {
            throw new Error('object with undefined name');
          }
          const name = applyDiff(new Uint8Array(0), bytepool, objEntry.name);
          objectList[obj_i] = {name, startingRoom:objEntry.startingRoom || 0};
        }
        else {
          const name = objEntry.name ? applyDiff(objectList[obj_i].name, bytepool, objEntry.name) : objectList[obj_i].name;
          objectList[obj_i] = {name, startingRoom:objEntry.startingRoom ?? objectList[obj_i].startingRoom};
        }
      }
      while (objectList.length > 0 && objectList[objectList.length-1] == null) {
        objectList.length--;
      }
      for (let i = 0; i < objectList.length; i++) {
        if (objectList[i] == null) {
          throw new Error('gaps in object list');
        }
      }
      objects.objects = objectList as ObjectInfo[];
    }

    if (patch.pictures) {
      for (const [pic_i_str, picEntry] of Object.entries(patch.pictures)) {
        const pic_i = Number(pic_i_str);
        if (pic_i >= pictures.length) pictures.length = pic_i + 1;
        if (picEntry === null) {
          pictures[pic_i] = null;
          continue;
        }
        const existingPic = (srcAGI.pictures[pic_i]?.type === 'raw-resource') ? srcAGI.pictures[pic_i].data : new Uint8Array(0);
        pictures[pic_i] = {
          type: 'raw-resource',
          resourceType: 'picture',
          data: picEntry.data ? applyDiff(existingPic, bytepool, picEntry.data) : existingPic,
          wasCompressed: false,
          volNumber: picEntry.volNumber ?? srcAGI.pictures[pic_i]?.volNumber ?? 0,
        };
      }
    }

    if (patch.sounds) {
      for (const [snd_i_str, sndEntry] of Object.entries(patch.sounds)) {
        const snd_i = Number(snd_i_str);
        if (snd_i >= sounds.length) sounds.length = snd_i + 1;
        if (sndEntry === null) {
          sounds[snd_i] = null;
          continue;
        }
        const existingSnd = (srcAGI.sounds[snd_i]?.type === 'raw-resource') ? srcAGI.sounds[snd_i].data : new Uint8Array(0);
        sounds[snd_i] = {
          type: 'raw-resource',
          resourceType: 'sound',
          data:sndEntry.data ? applyDiff(existingSnd, bytepool, sndEntry.data) : existingSnd,
          wasCompressed: false,
          volNumber: sndEntry.volNumber ?? srcAGI.sounds[snd_i]?.volNumber ?? 0,
        };
      }
    }

    if (patch.views) {
      for (const [view_i_str, viewEntry] of Object.entries(patch.views)) {
        const view_i = Number(view_i_str);
        if (view_i >= views.length) views.length = view_i + 1;
        if (viewEntry == null) {
          views[view_i] = null;
          continue;
        }
        const existingView = (srcAGI.views[view_i]?.type === 'view') ? srcAGI.views[view_i] : null;
        const existingSignature = existingView ? existingView.signature : 0x0101;
        const loops: Array<AGILoop | null> = existingView ? existingView.loops.slice() : [];
        for (const [loop_i_str, loopEntry] of Object.entries(viewEntry.loops || {})) {
          const loop_i = Number(loop_i_str);
          if (loop_i >= loops.length) loops.length = loop_i + 1;
          if (loopEntry === null) {
            loops[loop_i] = null;
          }
          else {
            const cels: Array<AGICel | null> = loops[loop_i] ? loops[loop_i].cels.slice() : [];
            for (const [cel_i_str, celEntry] of Object.entries(loopEntry.cels)) {
              const cel_i = Number(cel_i_str);
              if (cel_i >= cels.length) {
                cels.length = cel_i + 1;
              }
              if (celEntry == null) {
                cels[cel_i] = null;
                continue;
              }
              if (!cels[cel_i]) {
                if (typeof celEntry.width !== 'number' || typeof celEntry.height !== 'number' || typeof celEntry.transparencyColor !== 'number') {
                  throw new Error('insufficient data for cel');
                }
                cels[cel_i] = {
                  width: celEntry.width!,
                  height: celEntry.height!,
                  transparencyColor: celEntry.transparencyColor!,
                  pixelData: applyDiff(new Uint8Array(0), bytepool, celEntry.pixelData),
                };
              }
              else {
                let srcPixels = cels[cel_i].pixelData;
                const celWidth = celEntry.width ?? cels[cel_i].width;
                const celHeight = celEntry.height ?? cels[cel_i].height;
                if (celWidth !== cels[cel_i].width || celHeight !== cels[cel_i].height) {
                  srcPixels = new Uint8Array(celWidth * celHeight);
                  srcPixels.fill(cels[cel_i].transparencyColor);
                  for (let y = 0; y < Math.min(celHeight, cels[cel_i].height); y++) {
                    srcPixels.set(cels[cel_i].pixelData.subarray(y * cels[cel_i].width, (y+1) * cels[cel_i].width), y * celWidth);
                  }
                }
                cels[cel_i] = {
                  width: celWidth,
                  height: celHeight,
                  transparencyColor: celEntry.transparencyColor ?? cels[cel_i].transparencyColor,
                  pixelData: applyDiff(srcPixels, bytepool, celEntry.pixelData),
                };
              }
            }
            while (cels.length > 0 && cels[cels.length-1] == null) {
              cels.length--;
            }
            if (cels.some(v => v == null)) throw new Error('gap in cels');
            loops[loop_i] = {cels: cels as AGICel[]};
          }
        }
        while (loops.length > 0 && loops[loops.length-1] == null) {
          loops.length--;
        }
        if (loops.some(v => v == null)) throw new Error('gap in loops')
        views[view_i] = {
          type: 'view',
          signature: viewEntry.signature == null ? existingSignature : viewEntry.signature,
          loops: loops as AGILoop[],
          volNumber: viewEntry.volNumber ?? existingView?.volNumber ?? 0,
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
