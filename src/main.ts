import { AGIProject, eachAGIProject } from "./agi";
import { FileMap, makeFileReceiver } from "./drag-drop";
import { createAGIPatch } from "./patch-format";
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

  }
  catch (e) {
    console.error(e);
    alert('Failed to initialize');
  }
});

export {};
