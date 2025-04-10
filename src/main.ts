import { FileMap, makeFileReceiver } from "./drag-drop";

window.addEventListener('DOMContentLoaded', function() {
  try {
    const inputPane = document.querySelector<HTMLElement>('.input-pane');
    if (!inputPane) throw new Error('input-pane not found');
    const inputPaneBody = inputPane.querySelector<HTMLElement>('.pane-body');
    if (!inputPaneBody) throw new Error('input pane body not found');
    const inputAddButton = inputPane.querySelector<HTMLElement>('.pane-actions > .add-files');
    makeFileReceiver({
      dropTarget: inputPane,
      button: inputAddButton,
    });
    inputPane.addEventListener('received-files', (ev) => {
      function handleFileMap(fm: FileMap) {
        const fragment = document.createDocumentFragment();
        for (const [name, entry] of fm.entries()) {
          if (entry instanceof File) {
            const fileContainer = document.createElement('div');
            fileContainer.classList.add('file');
            const fileTitle = document.createElement('div');
            fileTitle.classList.add('title');
            fileTitle.textContent = name;
            fileContainer.appendChild(fileTitle);
            fragment.appendChild(fileContainer);
          }
          else {
            const folderContainer = document.createElement('div');
            folderContainer.classList.add('folder');
            const folderTitle = document.createElement('div');
            folderTitle.classList.add('title');
            folderTitle.textContent = name + '/';
            folderContainer.appendChild(folderTitle);
            const folderContents = document.createElement('div');
            folderContents.classList.add('contents');
            folderContents.appendChild(handleFileMap(entry));
            folderContainer.appendChild(folderContents);
            fragment.appendChild(folderContainer);
          }
        }
        return fragment;
      }
      inputPaneBody.appendChild(handleFileMap(ev.detail.files));
    });
  }
  catch (e) {
    console.error(e);
    alert('Failed to initialize');
  }
});

export {};
