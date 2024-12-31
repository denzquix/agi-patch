(function () {
    'use strict';

    /******************************************************************************
    Copyright (c) Microsoft Corporation.

    Permission to use, copy, modify, and/or distribute this software for any
    purpose with or without fee is hereby granted.

    THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
    REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
    AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
    INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
    LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
    OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
    PERFORMANCE OF THIS SOFTWARE.
    ***************************************************************************** */
    /* global Reflect, Promise, SuppressedError, Symbol, Iterator */


    function __awaiter(thisArg, _arguments, P, generator) {
        function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
        return new (P || (P = Promise))(function (resolve, reject) {
            function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
            function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
            function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
            step((generator = generator.apply(thisArg, _arguments || [])).next());
        });
    }

    typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
        var e = new Error(message);
        return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
    };

    function makeFileReceiver(dropTarget, button, filter) {
        let dragCounter = 0;
        dropTarget.addEventListener('dragenter', function (ev) {
            ev.preventDefault();
            if (++dragCounter === 1) {
                dropTarget.classList.add('drop-hovering');
            }
        });
        dropTarget.addEventListener('dragover', function (ev) {
            ev.preventDefault();
        });
        dropTarget.addEventListener('dragleave', function (ev) {
            ev.preventDefault();
            if (--dragCounter === 0) {
                dropTarget.classList.remove('drop-hovering');
            }
        });
        dropTarget.addEventListener('drop', function (ev) {
            var _a, _b;
            ev.preventDefault();
            dragCounter = 0;
            dropTarget.classList.remove('drop-hovering');
            let result;
            if ((_a = ev.dataTransfer) === null || _a === void 0 ? void 0 : _a.items) {
                result = processFileList(ev.dataTransfer.items);
            }
            else if ((_b = ev.dataTransfer) === null || _b === void 0 ? void 0 : _b.files) {
                result = processFileList(ev.dataTransfer.files);
            }
            else {
                result = null;
            }
            if (result != null) {
                result.then(value => {
                    dropTarget.dispatchEvent(new CustomEvent('received-files', { detail: { files: value } }));
                });
            }
        });
        if (button) {
            button.addEventListener('click', function (ev) {
                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.multiple = true;
                fileInput.addEventListener('change', function (ev) {
                    if (fileInput.files) {
                        processFileList(fileInput.files).then(value => {
                            dropTarget.dispatchEvent(new CustomEvent('received-files', { detail: { files: value } }));
                        });
                    }
                });
                fileInput.click();
            });
        }
    }
    function processFileList(items) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = new Map();
            // Convert items to array for easier handling
            const itemsArray = Array.from(items);
            // Process each item
            yield Promise.all(itemsArray.map((item) => __awaiter(this, void 0, void 0, function* () {
                // Handle DataTransferItem
                if ('webkitGetAsEntry' in item) {
                    const entry = item.webkitGetAsEntry();
                    if (entry) {
                        const processedEntry = yield processEntry(entry);
                        if (processedEntry) {
                            result.set(entry.name, processedEntry);
                        }
                    }
                }
                // Handle direct File object
                else if (item instanceof File) {
                    result.set(item.name, item);
                }
            })));
            return result;
        });
    }
    function processEntry(entry) {
        return new Promise((resolve, reject) => {
            if (entry.isFile) {
                const fileEntry = entry;
                fileEntry.file((file) => resolve(file), (err) => reject(err));
            }
            else if (entry.isDirectory) {
                const dirEntry = entry;
                const dirReader = dirEntry.createReader();
                const result = new Map();
                // Recursive function to read all entries
                const readEntries = () => {
                    dirReader.readEntries((entries) => {
                        if (entries.length === 0) {
                            resolve(result);
                        }
                        else {
                            // Process all entries in the current batch
                            Promise.all(entries.map((subEntry) => __awaiter(this, void 0, void 0, function* () {
                                const processed = yield processEntry(subEntry);
                                if (processed) {
                                    result.set(subEntry.name, processed);
                                }
                            })))
                                .then(() => {
                                // Continue reading (directories might return entries in batches)
                                readEntries();
                            });
                        }
                    }, (err) => reject(err));
                };
                readEntries();
            }
            else {
                resolve(null);
            }
        });
    }

    window.addEventListener('DOMContentLoaded', function () {
        try {
            const inputPane = document.querySelector('.input-pane');
            if (!inputPane)
                throw new Error('input-pane not found');
            const inputPaneBody = inputPane.querySelector('.pane-body');
            if (!inputPaneBody)
                throw new Error('input pane body not found');
            const inputAddButton = inputPane.querySelector('.pane-actions > .add-files');
            makeFileReceiver(inputPane, inputAddButton);
            inputPane.addEventListener('received-files', (ev) => {
                function handleFileMap(fm) {
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

})();
