
declare global {
  interface HTMLElementEventMap {
    'file-drop': CustomEvent<{file:File}>;
    'files-drop': CustomEvent<{files:FileMap}>;
  }
}

export function makeFileReceiver({
  dropTarget,
}: {
  dropTarget: HTMLElement,
}) {

  let singleFileTarget = dropTarget.querySelector<HTMLInputElement>('input[type=file]:not([multiple], [webkitdirectory])');
  let multiFileTarget = dropTarget.querySelector<HTMLInputElement>('input[type=file][multiple]');
  let dirTarget = dropTarget.querySelector<HTMLInputElement>('input[type=file][webkitdirectory]');

  if (singleFileTarget) {
    singleFileTarget.addEventListener('change', e => {
      const f = singleFileTarget.files && singleFileTarget.files[0];
      if (f) {
        dropTarget.dispatchEvent(new CustomEvent('file-drop', {detail:{file:f}}));
      }
    });
    dropTarget.querySelectorAll<HTMLElement>('[data-action=choose-file]').forEach(el => {
      el.addEventListener('click', () => singleFileTarget.click());
    });
  }
  if (multiFileTarget) {
    multiFileTarget.addEventListener('change', e => {
      if (multiFileTarget.files) {
        processFileList(multiFileTarget.files).then(value => {
          dropTarget.dispatchEvent(new CustomEvent('files-drop', {detail:{files:value}}));
        });
      }
    });
    dropTarget.querySelectorAll<HTMLElement>('[data-action=choose-files]').forEach(el => {
      el.addEventListener('click', () => multiFileTarget.click());
    });
  }
  if (dirTarget) {
    dirTarget.addEventListener('change', e => {
      if (dirTarget.files && dirTarget.files.length > 0) {
        dropTarget.dispatchEvent(new CustomEvent('files-drop', {detail:{files:processFlattenedFileList(dirTarget.files)}}));
      }
    });
    dropTarget.querySelectorAll<HTMLElement>('[data-action=choose-folder]').forEach(el => {
      el.addEventListener('click', () => dirTarget.click());
    });
  }

  let dragCounter = 0;

  dropTarget.addEventListener('dragenter', function(ev) {
    ev.preventDefault();
    if (++dragCounter === 1) {
      dropTarget.classList.add('drop-hovering');
    }
  });

  dropTarget.addEventListener('dragover', function(ev) {
    ev.preventDefault();
  });

  dropTarget.addEventListener('dragleave', function(ev) {
    ev.preventDefault();
    if (--dragCounter === 0) {
      dropTarget.classList.remove('drop-hovering');
    }
  });

  dropTarget.addEventListener('drop', function(ev) {
    ev.preventDefault();
    dragCounter = 0;
    dropTarget.classList.remove('drop-hovering');
    let result: Promise<FileMap> | null;
    if (ev.dataTransfer?.items) {
      result = processFileList(ev.dataTransfer.items);
    }
    else if (ev.dataTransfer?.files) {
      result = processFileList(ev.dataTransfer.files);
    }
    else {
      result = null;
    }
    if (result != null) {
      result.then(value => {
        dropTarget.dispatchEvent(new CustomEvent('files-drop', {detail:{files:value}}));
      });
    }
  });

}

export type FileMap = Map<string, File | FileMap>;

function processFlattenedFileList(files: FileList): FileMap {
  const fileMap: FileMap = new Map();
  for (let file_i = 0; file_i < files.length; file_i++) {
    const file = files[file_i];
    const fullPath = file.webkitRelativePath || file.name;
    const pathParts = fullPath.split(/\//g).slice(0, -1);
    let dir = fileMap;
    for (const pathPart of pathParts) {
      let subdir = fileMap.get(pathPart);
      if (subdir instanceof File) {
        throw new Error('file/folder mismatch');
      }
      if (!subdir) {
        subdir = new Map();
        dir.set(pathPart, subdir);
      }
      dir = subdir;
    }
    const existing = dir.get(file.name);
    if (existing) {
      throw new Error('duplicate entry: ' + fullPath);
    }
    dir.set(file.name, file);
  }
  return fileMap;
}

async function processFileList(items: FileList | DataTransferItemList): Promise<FileMap> {
  const result: FileMap = new Map();
  
  // Convert items to array for easier handling
  const itemsArray = Array.from<File | DataTransferItem>(items);
  
  // Process each item
  await Promise.all(
    itemsArray.map(async (item) => {
      // Handle DataTransferItem
      if ('webkitGetAsEntry' in item) {
        const entry = item.webkitGetAsEntry();
        if (entry) {
          const processedEntry = await processEntry(entry);
          if (processedEntry) {
            result.set(entry.name, processedEntry);
          }
        }
      }
      // Handle direct File object
      else if (item instanceof File) {
        result.set(item.name, item);
      }
    })
  );
  
  return result;
}

function processEntry(entry: FileSystemEntry): Promise<File | FileMap | null> {
  return new Promise((resolve, reject) => {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      fileEntry.file(
        (file) => resolve(file),
        (err) => reject(err),
      );
    }
    else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const dirReader = dirEntry.createReader();
      const result: FileMap = new Map();
      
      // Recursive function to read all entries
      const readEntries = () => {
        dirReader.readEntries(
          (entries) => {
            if (entries.length === 0) {
              resolve(result);
            }
            else {
              // Process all entries in the current batch
              Promise.all(
                entries.map(async (subEntry) => {
                  const processed = await processEntry(subEntry);
                  if (processed) {
                    result.set(subEntry.name, processed);
                  }
                })
              )
              .then(() => {
                // Continue reading (directories might return entries in batches)
                readEntries();
              });
            }
          },
          (err) => reject(err),
        );
      };
      
      readEntries();
    }
    else {
      resolve(null);
    }
  });
}

const HOVER_MS = 350;

export function clickOnDragHover(el: HTMLElement) {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const click = () => {
    el.click();
  };

  let lastX = NaN, lastY = NaN;

  const clearHover = () => {
    if (timeout != null) clearTimeout(timeout);
    timeout = null;
    lastX = lastY = NaN;
  }

  el.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    if (ev.clientX !== lastX || ev.clientY !== lastY) {
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (timeout != null) clearTimeout(timeout);
      timeout = setTimeout(click, HOVER_MS);
    }
  });

  el.addEventListener('dragenter', function(ev) {
    ev.preventDefault();
  });

  el.addEventListener('dragleave', function(ev) {
    ev.preventDefault();
    clearHover();
  });

  el.addEventListener('drop', function(ev) {
    clearHover();
  });
}
