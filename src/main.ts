import { FileMap, makeFileReceiver } from "./drag-drop";
import { VFSVolume, VFSDirectoryEntry } from "./virtual-file-system";

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

    document.querySelectorAll<HTMLElement>('.dropzone').forEach(dropzone => {
      const targetVolume = dropzone.dataset.targetVolume;
      if (!targetVolume) return;
      const targetVolumeContainer = document.querySelector<HTMLElement>('[data-volume="'+targetVolume+'"]');
      if (!targetVolumeContainer) return;
      const volume = new VFSVolume();
      const entryToElement = new Map<VFSDirectoryEntry, HTMLElement>();
      entryToElement.set(volume.root, targetVolumeContainer);
      volume.events.subscribe(e => {
        switch (e.type) {
          case 'directory-created': {
            const parentEl = entryToElement.get(e.directory.parentDirectory);
            if (parentEl) {
              const folderContainer = document.createElement('div');
              folderContainer.classList.add('tree-item', 'folder');
              const folderTitle = document.createElement('div');
              folderTitle.classList.add('title');
              folderTitle.textContent = e.directory.name + '/';
              folderContainer.appendChild(folderTitle);
              const folderContents = document.createElement('div');
              folderContents.classList.add('tree-children', 'expanded');
              entryToElement.set(e.directory, folderContents);
              folderContainer.appendChild(folderContents);
              parentEl.appendChild(folderContainer);
            }
            else {
              console.warn('No element found for ' + e.directory.parentDirectory.getPath().join('/'));
            }
            break;
          }
          case 'file-created': {
            const dirEl = entryToElement.get(e.file.parentDirectory);
            if (dirEl) {
              const fileContainer = this.document.createElement('div');
              entryToElement.set(e.file, fileContainer);
              fileContainer.classList.add('tree-item', 'file');
              const fileTitle = document.createElement('div');
              fileTitle.classList.add('title');
              fileTitle.textContent = e.file.name;
              fileContainer.appendChild(fileTitle);
              dirEl.appendChild(fileContainer);
            }
            else {
              console.warn('No element found for ' + e.file.parentDirectory.getPath().join('/'));
            }
            break;
          }
        }
      });
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
