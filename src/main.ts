import { agiHash, AGIProject, compressLZW, compressPIC, eachAGIProject, packLogic, packObjects, packView, packWords } from "./agi";
import { clickOnDragHover, FileMap, makeFileReceiver } from "./drag-drop";
import { applyAGIPatch, createAGIPatch, PatchContainer, PatchObject } from "./patch-format";
import { VFSVolume, VFSDirectoryEntry, VFSDirectory, VFSFile } from "./virtual-file-system";
import { readZip, writeZipStream } from "./zip";

function getTabContext(el: Element) {
  for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.hasAttribute('data-tab-context')) return ancestor;
  }
  return null;
}

type VolumeHolder = {volume?: VFSVolume};

declare global {
  interface WindowEventMap {
    'patch-file': CustomEvent<{file: File | null}>;
  }
}

window.addEventListener('DOMContentLoaded', function() {
  const messageBox = document.querySelector<HTMLDialogElement>('dialog.message-box')!;
  const messageBoxText = messageBox.querySelector('p')!;
  const showMessage = (message: string) => {
    messageBoxText.textContent = message;
    messageBox.showModal();
  };
  try {

    let patchFile: File | null = null;
    const setPatchFile = (pf: File | null) => {
      window.dispatchEvent(new CustomEvent('patch-file', {detail:{file:pf}}));
      patchFile = pf;
    };

    document.querySelectorAll<HTMLElement>('.patch-section').forEach(patchSection => {
      patchSection.querySelectorAll<HTMLElement>('.select-list').forEach(patchList => {
        patchList.addEventListener('click', async (e) => {
          if (patchList.classList.contains('loading')) return;
          const targetElement = e.target as HTMLElement;
          const url = targetElement.dataset.url;
          if (url) {
            const absoluteUrl = new URL(url, document.baseURI);
            patchList.classList.add('loading');
            try {
              const response = await fetch(url);
              if (!response.ok) throw new Error('Failed to load '+absoluteUrl.toString());
              const blob = await response.blob();
              const file = new File([blob], absoluteUrl.pathname.match(/[^\/]*$/)![0] || 'unknown.dat');
              setPatchFile(file);
            }
            catch (e) {
              showMessage('Failed to load file!');
            }
            finally {
              patchList.classList.remove('loading');
            }
          }
        });
      });
      patchSection.classList.toggle('patch-selected', patchFile != null);
      patchSection.querySelectorAll<HTMLElement>('.dropzone[data-file-is=patch-file]').forEach(el => {
        el.addEventListener('file-drop', ({detail:{file}}) => {
          setPatchFile(file);
        });
      });
      window.addEventListener('patch-file', ({detail:{file}}) => {
        patchSection.classList.toggle('patch-selected', file != null);
        if (file) patchSection.querySelectorAll<HTMLElement>('.patch-filename').forEach(filenameHolder => {
          filenameHolder.textContent = file.name;
        });
      });
      patchSection.querySelectorAll<HTMLElement>('[data-action=cancel-selected-patch]').forEach(btn => {
        btn.onclick = () => {
          setPatchFile(null);
        };
      });
    });

    document.querySelectorAll<HTMLElement>('[data-tab]').forEach(tab => {
      clickOnDragHover(tab);
    });

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

          const { json: patchJSONObject, bytepool: bytepoolBlob } = createAGIPatch(srcAGI, dstAGI);


          const patchVolume = new VFSVolume();

          patchVolume.root.createFile('patch.json', new Blob([JSON.stringify(patchJSONObject, null, 2)]));
          patchVolume.root.createFile('bytepool.dat', bytepoolBlob);

          const zipChunks: Uint8Array[] = [];
          const ws = new WritableStream<Uint8Array>({
            write(chunk) {
              zipChunks.push(chunk);
            },
          });
          await writeZipStream(patchVolume, ws);
          const zipBlob = new Blob(zipChunks, {type:'application/zip'});
          const link = document.createElement('a');
          link.href = URL.createObjectURL(zipBlob);
          link.download = 'patch.sapp';
          link.text = 'Download SAPP Patch File';
          el.parentElement!.insertAdjacentElement('afterend', link);

          showMessage('Patch created successfully');
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
      if (targetVolume) {
        const targetVolumeContainer = document.querySelector<HTMLElement>('[data-volume="'+targetVolume+'"]');
        if (targetVolumeContainer) {
          const volume = new VFSVolume();
          addVolumeToElement(volume, targetVolumeContainer);
          dropzone.addEventListener('files-drop', ({detail:{files}}) => {
            function processEntry(dir: VFSDirectory, fm: FileMap) {
              for (const [name, entry] of fm) {
                if (entry instanceof File) {
                  dir.createFile(name, entry, entry.lastModified);
                }
                else {
                  const subdir = dir.createDirectory(name);
                  processEntry(subdir, entry);
                }
              }
            }
            processEntry(volume.root, files);
          });
        }
      }
      makeFileReceiver({
        dropTarget: dropzone,
      });
    });

    document.querySelectorAll<HTMLElement>('[data-action=apply-patch]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!patchFile) {
          showMessage('No patch file selected');
          return;
        }
        const fromVolume = (document.querySelector('[data-volume=files-to-patch]') as VolumeHolder)?.volume;
        if (!fromVolume) {
          showMessage('No files to patch!');
          return;
        }
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

        let zip: VFSVolume;
        try {
          zip = await readZip(patchFile);
        }
        catch (e) {
          showMessage('Failed to read patch file');
          return;
        }

        const patchJson = zip.root.getFile('patch.json');
        const bytepoolFile = zip.root.getFile('bytepool.dat');
        if (!patchJson || !bytepoolFile) {
          showMessage('Failed to read patch file');
          return;
        }
        const json = JSON.parse(await (await patchJson.getContent()).text()) as PatchContainer;
        const bytepool = new Uint8Array(await (await bytepoolFile.getContent()).arrayBuffer());

        const patchesByHash = new Map<number, PatchObject>();
        for (const patch of json.patches) {
          patchesByHash.set(parseInt(patch.hashOriginal, 16), patch);
        }

        const srcAGIs = await getAllAGIs(fromVolume);
        let result: {patch: PatchObject, srcAGI:AGIProject} | null = null;
        for (const srcAGI of srcAGIs) {
          const patch = patchesByHash.get(agiHash(srcAGI));
          if (patch) {
            result = {patch, srcAGI};
            break;
          }
        }
        if (!result) {
          showMessage('No matching game was found');
          return;
        }
        const { srcAGI } = result;
        let patchedAGI: AGIProject;
        try {
          patchedAGI = applyAGIPatch(srcAGI, json, bytepool);
        }
        catch (e) {
          showMessage('Patching failed!');
          console.error(e);
          return;
        }
        const vols = new Map<number, {pos: number, data:Uint8Array[]}>();
        const logics = new Array<{volNumber:number, offset:number} | undefined>();
        const pictures = new Array<{volNumber:number, offset:number} | undefined>();
        const sounds = new Array<{volNumber:number, offset:number} | undefined>();
        const views = new Array<{volNumber:number, offset:number} | undefined>();
        const useCompression = Boolean(patchedAGI.packedDirs);
        for (let [logic_i, logic] of patchedAGI.logic.entries()) {
          if (!logic) continue;
          if (logic.type !== 'logic') continue;
          const volNumber = logic.volNumber || 0;
          let vol = vols.get(volNumber);
          if (!vol) {
            vol = {pos:0, data:[]};
            vols.set(volNumber, vol);
          }
          if (logic_i >= logics.length) logics.length = logic_i + 1;
          logics[logic_i] = {volNumber, offset:vol.pos};
          if (useCompression) {
            const unmasked = packLogic(logic, false);
            const compressedUnmasked = compressLZW(unmasked);
            if (compressedUnmasked.length >= unmasked.length) {
              const masked = packLogic(logic, true);
              const header = new Uint8Array([
                0x12, 0x34, volNumber,
                masked.length & 0xff, masked.length >>> 8,
                masked.length & 0xff, masked.length >>> 8,
              ]);
              vol.data.push(header, masked);
              vol.pos += header.length + masked.length;
            }
            else {
              const header = new Uint8Array([
                0x12, 0x34, volNumber,
                unmasked.length & 0xff, unmasked.length >>> 8,
                compressedUnmasked.length & 0xff, compressedUnmasked.length >>> 8,
              ]);
              vol.data.push(header, compressedUnmasked);
              vol.pos += header.length + compressedUnmasked.length;
            }
          }
          else {
            const masked = packLogic(logic, true);
            const header = new Uint8Array([
              0x12, 0x34, volNumber,
              masked.length & 0xff, masked.length >>> 8,
            ]);
            vol.data.push(header, masked);
            vol.pos += header.length + masked.length;
          }
        }
        for (let [picture_i, picture] of patchedAGI.pictures.entries()) {
          if (!picture) continue;
          if (picture.type !== 'raw-resource') continue;
          const volNumber = picture.volNumber || 0;
          let vol = vols.get(volNumber);
          if (!vol) {
            vol = {pos:0, data:[]};
            vols.set(volNumber, vol);
          }
          if (picture_i >= pictures.length) pictures.length = picture_i + 1;
          pictures[picture_i] = {volNumber, offset:vol.pos};
          if (useCompression) {
            const compressed = compressPIC(picture.data);
            if (compressed.length >= picture.data.length) {
              const header = new Uint8Array([
                0x12, 0x34, volNumber,
                picture.data.length & 0xff, picture.data.length >>> 8,
                picture.data.length & 0xff, picture.data.length >>> 8,
              ]);
              vol.data.push(header, picture.data);
              vol.pos += header.length + picture.data.length;
            }
            else {
              const header = new Uint8Array([
                0x12, 0x34, volNumber | 0x80,
                picture.data.length & 0xff, picture.data.length >>> 8,
                compressed.length & 0xff, compressed.length >>> 8,
              ]);
              vol.data.push(header, compressed);
              vol.pos += header.length + compressed.length;
            }
          }
          else {
            const header = new Uint8Array([
              0x12, 0x34, volNumber,
              picture.data.length & 0xff, picture.data.length >>> 8,
            ]);
            vol.data.push(header, picture.data);
            vol.pos += header.length + picture.data.length;
          }
        }
        for (let [sound_i, sound] of patchedAGI.sounds.entries()) {
          if (!sound) continue;
          if (sound.type !== 'raw-resource') continue;
          const volNumber = sound.volNumber || 0;
          let vol = vols.get(volNumber);
          if (!vol) {
            vol = {pos:0, data:[]};
            vols.set(volNumber, vol);
          }
          if (sound_i >= sounds.length) sounds.length = sound_i + 1;
          sounds[sound_i] = {volNumber, offset:vol.pos};
          if (useCompression) {
            const compressed = compressLZW(sound.data);
            if (compressed.length >= sound.data.length) {
              const header = new Uint8Array([
                0x12, 0x34, volNumber,
                sound.data.length & 0xff, sound.data.length >>> 8,
                sound.data.length & 0xff, sound.data.length >>> 8,
              ]);
              vol.data.push(header, sound.data);
              vol.pos += header.length + sound.data.length;
            }
            else {
              const header = new Uint8Array([
                0x12, 0x34, volNumber,
                sound.data.length & 0xff, sound.data.length >>> 8,
                compressed.length & 0xff, compressed.length >>> 8,
              ]);
              vol.data.push(header, compressed);
              vol.pos += header.length + compressed.length;
            }
          }
          else {
            const header = new Uint8Array([
              0x12, 0x34, volNumber,
              sound.data.length & 0xff, sound.data.length >>> 8,
            ]);
            vol.data.push(header, sound.data);
            vol.pos += header.length + sound.data.length;
          }
        }
        for (let [view_i, view] of patchedAGI.views.entries()) {
          if (!view) continue;
          if (view.type !== 'view') continue;
          const volNumber = view.volNumber || 0;
          let vol = vols.get(volNumber);
          if (!vol) {
            vol = {pos:0, data:[]};
            vols.set(volNumber, vol);
          }
          if (view_i >= views.length) views.length = view_i + 1;
          views[view_i] = {volNumber, offset:vol.pos};
          const viewData = packView(view);
          if (useCompression) {
            const compressed = compressLZW(viewData);
            if (compressed.length >= viewData.length) {
              const header = new Uint8Array([
                0x12, 0x34, volNumber,
                viewData.length & 0xff, viewData.length >>> 8,
                viewData.length & 0xff, viewData.length >>> 8,
              ]);
              vol.data.push(header, viewData);
              vol.pos += header.length + viewData.length;
            }
            else {
              const header = new Uint8Array([
                0x12, 0x34, volNumber,
                viewData.length & 0xff, viewData.length >>> 8,
                compressed.length & 0xff, compressed.length >>> 8,
              ]);
              vol.data.push(header, compressed);
              vol.pos += header.length + compressed.length;
            }
          }
          else {
            const header = new Uint8Array([
              0x12, 0x34, volNumber,
              viewData.length & 0xff, viewData.length >>> 8,
            ]);
            vol.data.push(header, viewData);
            vol.pos += header.length + viewData.length;
          }
        }
        const wordsData = packWords(patchedAGI.words);
        const objectsData = packObjects(patchedAGI.objects);
        const patchedFiles = new VFSVolume();
        patchedFiles.root.createFile('words.tok', new Blob([wordsData]));
        patchedFiles.root.createFile('object', new Blob([objectsData]));
        function packIndex(index: Array<{volNumber: number, offset: number} | null | undefined>): Uint8Array {
          const bytes = new Uint8Array(3 * index.length);
          for (let i = 0; i < index.length; i++) {
            const entry = index[i];
            if (entry) {
              const combo = entry.offset | (entry.volNumber << 20);
              bytes[i*3] = (combo >> 16) & 0xff;
              bytes[i*3 + 1] = (combo >> 8) & 0xff;
              bytes[i*3 + 2] = combo & 0xff;
            }
            else {
              bytes[i*3] = bytes[i*3 + 1] = bytes[i*3 + 2] = 0xff;
            }
          }
          return bytes;
        }
        const logicIndex = packIndex(logics);
        const pictureIndex = packIndex(pictures);
        const viewIndex = packIndex(views);
        const soundIndex = packIndex(sounds);
        let volPrefix = '';
        if (patchedAGI.packedDirs) {
          const dirsName = (patchedAGI.packedDirs.prefix + patchedAGI.packedDirs.basename).toLowerCase();
          const indexIndex = new DataView(new ArrayBuffer(4 * 2));
          let pos = indexIndex.byteLength;
          indexIndex.setUint16(0, pos, true);
          pos += logicIndex.length;
          indexIndex.setUint16(2, pos, true);
          pos += pictureIndex.length;
          indexIndex.setUint16(4, pos, true);
          pos += viewIndex.length;
          indexIndex.setUint16(6, pos, true);
          pos += soundIndex.length;
          patchedFiles.root.createFile(dirsName, new Blob([indexIndex, logicIndex, pictureIndex, viewIndex, soundIndex]));
          if (!patchedAGI.packedDirs.suppressVolPrefix) {
            volPrefix = patchedAGI.packedDirs.prefix.toLowerCase();
          }
        }
        else {
          patchedFiles.root.createFile('logdir', new Blob([logicIndex]));
          patchedFiles.root.createFile('snddir', new Blob([soundIndex]));
          patchedFiles.root.createFile('viewdir', new Blob([viewIndex]));
          patchedFiles.root.createFile('picdir', new Blob([pictureIndex]));
        }
        for (const [volNumber, {data}] of vols) {
          patchedFiles.root.createFile(volPrefix+'vol.'+volNumber, new Blob(data));
        }
        const zipChunks: Uint8Array[] = [];
        const ws = new WritableStream<Uint8Array>({
          write(chunk) {
            zipChunks.push(chunk);
          },
        });
        await writeZipStream(patchedFiles, ws);
        const zipBlob = new Blob(zipChunks, {type:'application/zip'});
        const link = document.createElement('a');
        link.href = URL.createObjectURL(zipBlob);
        link.download = 'patched.zip';
        link.text = 'Download Patched Files';
        btn.parentElement!.insertAdjacentElement('afterend', link);
        showMessage('Patch successfully applied');
      });
    });

  }
  catch (e) {
    console.error(e);
    alert('Failed to initialize');
  }
});

export {};
