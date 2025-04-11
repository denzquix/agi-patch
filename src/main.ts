import { FileMap, makeFileReceiver } from "./drag-drop";
import { VFSVolume, VFSDirectoryEntry } from "./virtual-file-system";

window.addEventListener('DOMContentLoaded', function() {
  try {
    const inputPane = document.querySelector<HTMLElement>('.input-pane');
    if (!inputPane) throw new Error('input-pane not found');
    const inputPaneBody = inputPane.querySelector<HTMLElement>('.pane-body');
    if (!inputPaneBody) throw new Error('input pane body not found');
    const inputAddButton = inputPane.querySelector<HTMLElement>('.pane-actions > .add-files');
    const volume = new VFSVolume();
    const entryToElement = new Map<VFSDirectoryEntry, HTMLElement>();
    entryToElement.set(volume.root, inputPaneBody);
    volume.events.subscribe(e => {
      switch (e.type) {
        case 'directory-created': {
          const parentEl = entryToElement.get(e.directory.parentDirectory);
          if (parentEl) {
            const folderContainer = document.createElement('div');
            folderContainer.classList.add('folder');
            const folderTitle = document.createElement('div');
            folderTitle.classList.add('title');
            folderTitle.textContent = e.directory.name + '/';
            folderContainer.appendChild(folderTitle);
            const folderContents = document.createElement('div');
            folderContents.classList.add('contents');
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
            fileContainer.classList.add('file');
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
      dropTarget: inputPane,
      button: inputAddButton,
      targetDirectory: volume.root,
    });
  }
  catch (e) {
    console.error(e);
    alert('Failed to initialize');
  }
});

export {};
