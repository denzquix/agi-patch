
export function makeFileReceiver({dropTarget, button, filter}: {dropTarget: HTMLElement, button?: HTMLElement | null, filter?: string}) {

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
        dropTarget.dispatchEvent(new CustomEvent('received-files', {detail:{files:value}}));
      });
    }
  });

  if (button) {
    button.addEventListener('click', function(ev) {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.multiple = true;
      if (filter) {
        fileInput.accept = filter;
      }
      fileInput.addEventListener('change', function(ev) {
        if (fileInput.files) {
          processFileList(fileInput.files).then(value => {
            dropTarget.dispatchEvent(new CustomEvent('received-files', {detail:{files:value}}));
          });
        }
      });
      fileInput.click();
    });
  }

}

export type FileMap = Map<string, File | FileMap>;

declare global {
  interface HTMLElementEventMap {
    'received-files': CustomEvent<{files:FileMap}>;
  }
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
