import { FileMap, makeFileReceiver } from "./drag-drop";
import { VFSVolume, VFSDirectoryEntry, VFSDirectory, VFSFile } from "./virtual-file-system";
import { readZip } from "./zip";

function getTabContext(el: Element) {
  for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.hasAttribute('data-tab-context')) return ancestor;
  }
  return null;
}

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

    async function addVolumeToElement(volume: VFSVolume, targetVolumeContainer: HTMLElement) {
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
          if (/\.zip$/.test(file.name)) {
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
