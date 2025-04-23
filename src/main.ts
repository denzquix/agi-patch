import { AGIProject, eachAGIProject } from "./agi";
import { diffBytes } from "./diff";
import { FileMap, makeFileReceiver } from "./drag-drop";
import { PatchJSON } from "./patch-format";
import { VFSVolume, VFSDirectoryEntry, VFSDirectory, VFSFile } from "./virtual-file-system";
import { readZip } from "./zip";

function getTabContext(el: Element) {
  for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.hasAttribute('data-tab-context')) return ancestor;
  }
  return null;
}

type VolumeHolder = {volume?: VFSVolume};

const byteArraysEqual = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v,i) => b[i] === v);

window.addEventListener('DOMContentLoaded', function() {
  try {

    document.querySelectorAll<HTMLElement>('[data-tab-context]').forEach(tabContext => {
      tabContext.addEventListener('click', e => {
        const targetEl = e.target as HTMLElement;
        if (targetEl.hasAttribute('data-tab')) {
          e.stopPropagation();
          tabContext.querySelectorAll<HTMLElement>('[data-tab]').forEach(tabButton => {
            if (getTabContext(tabButton) !== tabContext) return;
            tabButton.classList.toggle('active', tabButton.dataset.tab === targetEl.dataset.tab);
          });
          tabContext.querySelectorAll<HTMLElement>('[data-tab-content]').forEach(tabContent => {
            if (getTabContext(tabContent) !== tabContext) return;
            tabContent.classList.toggle('active', tabContent.dataset.tabContent === targetEl.dataset.tab);
          });
        }
      });
    });

    document.querySelectorAll<HTMLElement>('[data-action=create-patch]').forEach(el => {
      el.onclick = async () => {
        const fromVolume = (document.querySelector('[data-volume=original-files]') as VolumeHolder)?.volume;
        const toVolume = (document.querySelector('[data-volume=modified-files]') as VolumeHolder)?.volume;
        
        if (fromVolume && toVolume) {

          async function getAllAGIs(rootVolume: VFSVolume) {
            const allFromVolumes = await Promise.all(
              [...rootVolume.root.eachFile('**/*.zip')]
              .map(file => file.getContent().then(readZip))
            );
            allFromVolumes.unshift(rootVolume);
            const agis: AGIProject[] = [];
            for (const volume of allFromVolumes) {
              for await (const agi of eachAGIProject(volume.root)) {
                agis.push(agi);
              }
            }
            return agis;
          }

          const srcAGIs = await getAllAGIs(fromVolume);
          const dstAGIs = await getAllAGIs(toVolume);
          if (srcAGIs.length !== 1 || dstAGIs.length !== 1) {
            alert('Expected exactly 1 AGI project in Original and Modified\n\nFound ' + srcAGIs.length + ' in Original and ' + dstAGIs.length + ' in Modified');
          }

          const srcAGI = srcAGIs[0], dstAGI = dstAGIs[0];

          const patchJSONObject: PatchJSON = {
            formatVersion: 1,
            type: 'agi',
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
              return `@${start.toString(16)} +${chunk2.length}`;
            }
            const parts = diffBytes(chunk1, chunk2);
            const diffStringParts: string[] = [];
            let startPos = -1;
            for (const part of parts) {
              switch (part.type) {
                case 'delete': diffStringParts.push('-' + part.count.toString(16)); break;
                case 'insert':
                  if (startPos === -1) startPos = writeChunk(part.bytes);
                  diffStringParts.push('+' + part.bytes.length.toString(16));
                  break;
                case 'same': diffStringParts.push('=' + part.count.toString(16)); break;
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
            patchJSONObject.words = wordsDiff;
          }

          const logic_count = Math.max(srcAGI.logic.length, dstAGI.logic.length);
          const logicDiff: PatchJSON['logic'] = {};
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
            patchJSONObject.logic = logicDiff;
          }

          console.log(patchJSONObject);
        }
      };
    });

    async function addVolumeToElement(volume: VFSVolume, targetVolumeContainer: HTMLElement) {
      (targetVolumeContainer as VolumeHolder).volume = volume;
      const entryToElement = new Map<VFSDirectoryEntry, HTMLElement>();
      entryToElement.set(volume.root, targetVolumeContainer);
      async function createDir(dir: VFSDirectory) {
        const parentEl = entryToElement.get(dir.parentDirectory);
        if (parentEl) {
          const folderContainer = document.createElement('div');
          folderContainer.classList.add('tree-item', 'folder');
          const folderTitle = document.createElement('div');
          folderTitle.classList.add('title');
          folderTitle.textContent = dir.name;
          folderContainer.appendChild(folderTitle);
          const folderContents = document.createElement('div');
          folderContents.classList.add('tree-children', 'expanded');
          entryToElement.set(dir, folderContents);
          folderContainer.appendChild(folderContents);
          parentEl.appendChild(folderContainer);
        }
        else {
          console.warn('No element found for ' + dir.parentDirectory.getPath().join('/'));
        }
      }
      async function createFile(file: VFSFile) {
        const dirEl = entryToElement.get(file.parentDirectory);
        if (dirEl) {
          const fileContainer = document.createElement('div');
          entryToElement.set(file, fileContainer);
          fileContainer.classList.add('tree-item', 'file');
          const fileTitle = document.createElement('div');
          fileTitle.classList.add('title');
          fileTitle.textContent = file.name;
          fileContainer.appendChild(fileTitle);
          dirEl.appendChild(fileContainer);
          if (/\.zip$/i.test(file.name)) {
            const zipVolume = await readZip(await file.getContent());
            fileContainer.classList.add('archive');
            const archiveContents = document.createElement('div');
            archiveContents.classList.add('tree-children', 'expanded');
            addVolumeToElement(zipVolume, archiveContents);
            fileContainer.appendChild(archiveContents);  
          }
        }
        else {
          console.warn('No element found for ' + file.parentDirectory.getPath().join('/'));
        }
      }
      for (const entry of volume.root.eachEntry('**')) {
        if (entry.isDirectory()) {
          createDir(entry);
        }
        else if (entry.isFile()) {
          createFile(entry);
        }
      }
      volume.events.subscribe(async e => {
        switch (e.type) {
          case 'directory-created': {
            createDir(e.directory);
            break;
          }
          case 'file-created': {
            createFile(e.file);
            break;
          }
        }
      });
    }

    document.querySelectorAll<HTMLElement>('.dropzone').forEach(dropzone => {
      const targetVolume = dropzone.dataset.targetVolume;
      if (!targetVolume) return;
      const targetVolumeContainer = document.querySelector<HTMLElement>('[data-volume="'+targetVolume+'"]');
      if (!targetVolumeContainer) return;
      const volume = new VFSVolume();
      addVolumeToElement(volume, targetVolumeContainer);
      makeFileReceiver({
        dropTarget: dropzone,
        button: dropzone,
        targetDirectory: volume.root,
      });
    });

  }
  catch (e) {
    console.error(e);
    alert('Failed to initialize');
  }
});

export {};
