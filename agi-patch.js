(function () {
    'use strict';

    const rotl = (value, bits) => ((value << bits) | (value >>> (32 - bits))) >>> 0;
    const c1 = 0xcc9e2d51;
    const c2 = 0x1b873593;
    const r1 = 15;
    const r2 = 13;
    const m = 5;
    const n = 0xe6546b64;
    const mix = (hash, k) => {
        k = Math.imul(k, c1);
        k = rotl(k, r1);
        k = Math.imul(k, c2);
        hash ^= k;
        hash = rotl(hash, r2);
        hash = Math.imul(hash, m) + n;
        return hash >>> 0;
    };
    class MurmurHash3 {
        tail = [];
        totalLength = 0;
        hash;
        constructor(seed = 0) {
            this.hash = seed >>> 0;
        }
        add(data) {
            let pos = 0;
            let { hash } = this;
            if (this.tail.length > 0) {
                while (this.tail.length < 4 && pos < data.length) {
                    this.tail.push(data[pos++]);
                }
                if (this.tail.length < 4) {
                    return;
                }
                const k = (this.tail[0] |
                    (this.tail[1] << 8) |
                    (this.tail[2] << 16) |
                    (this.tail[3] << 24)) >>> 0;
                hash = mix(hash, k);
                this.tail = [];
            }
            while (pos + 4 <= data.length) {
                const k = (data[pos] |
                    (data[pos + 1] << 8) |
                    (data[pos + 2] << 16) |
                    (data[pos + 3] << 24)) >>> 0;
                hash = mix(hash, k);
                pos += 4;
            }
            while (pos < data.length) {
                this.tail.push(data[pos++]);
            }
            this.totalLength += data.length;
            this.hash = hash;
        }
        digest() {
            let { hash } = this;
            let k1 = 0;
            switch (this.tail.length) {
                case 3:
                    k1 ^= this.tail[2] << 16;
                // fall through:
                case 2:
                    k1 ^= this.tail[1] << 8;
                // fall through:
                case 1:
                    k1 ^= this.tail[0];
                    k1 = Math.imul(k1, c1);
                    k1 = rotl(k1, r1);
                    k1 = Math.imul(k1, c2);
                    hash ^= k1;
                    break;
            }
            hash ^= this.totalLength;
            hash ^= hash >>> 16;
            hash = Math.imul(hash, 0x85ebca6b);
            hash ^= hash >>> 13;
            hash = Math.imul(hash, 0xc2b2ae35);
            hash ^= hash >>> 16;
            return hash >>> 0;
        }
    }

    const commonPrefixLen = (a, b) => {
        const minLen = Math.min(a.length, b.length);
        let i = 0;
        while (i < minLen && a[i] === b[i])
            i++;
        return i;
    };
    const AVIS_DURGAN = new Uint8Array([...'Avis Durgan'].map(v => v.charCodeAt(0)));
    const avisDurgan = (b) => {
        for (let i = 0; i < b.length; i++) {
            b[i] ^= AVIS_DURGAN[i % AVIS_DURGAN.length];
        }
        return b;
    };
    function unpackWords(wordsData) {
        let pos = 26 * 2;
        if (pos >= wordsData.length)
            return { words: new Map() };
        let lastWord = '';
        const words = new Map();
        while (pos < wordsData.length) {
            if (wordsData[pos] === 0 && pos + 1 === wordsData.length) {
                return { words };
            }
            const startPos = pos;
            if (wordsData[pos] > lastWord.length) {
                throw new Error('invalid prefix');
            }
            let word = lastWord.slice(0, wordsData[pos++]);
            let byte;
            do {
                byte = wordsData[pos++];
                if (pos >= wordsData.length)
                    break;
                word += String.fromCharCode((byte & 0x7f) ^ 0x7f);
            } while ((byte & 0x80) === 0);
            if ((pos + 2) > wordsData.length || word < lastWord) {
                return { words, suffix: wordsData.subarray(startPos) };
            }
            const wordNum = (wordsData[pos] << 8) | wordsData[pos + 1];
            pos += 2;
            words.set(word, wordNum);
            lastWord = word;
        }
        return { words, suffix: new Uint8Array(0) };
    }
    function packWords({ words, suffix = new Uint8Array([0]) }) {
        const wordList = [...words.keys()].sort();
        if (wordList.some(w => /[^\x00-\x7f]/.test(w))) {
            throw new Error('word list must not contain only ASCII-7 characters');
        }
        const encoded = wordList.map((word, i, a) => {
            const prefixLen = i === 0 ? 0 : Math.min(255, commonPrefixLen(word, a[i - 1]));
            if (prefixLen === word.length) {
                throw new Error('word list must contain only unique words');
            }
            const codes = [prefixLen];
            for (let i = prefixLen; i < word.length; i++) {
                codes.push(word.charCodeAt(i) ^ 0x7f);
            }
            codes[codes.length - 1] |= 0x80;
            const num = words.get(word) & 0xffff;
            codes.push(num >>> 8, num & 0xff);
            return codes;
        });
        const bufSize = 26 * 2 + encoded.reduce((total, codes) => total + codes.length, 0) + suffix.length;
        const bytes = new Uint8Array(bufSize);
        let pos = 26 * 2;
        let lastFirstLetter = '';
        for (let i = 0; i < encoded.length; i++) {
            bytes.set(encoded[i], pos);
            const firstLetter = wordList[i][0];
            if (firstLetter !== lastFirstLetter) {
                const letterIndex = firstLetter.charCodeAt(0) - 'a'.charCodeAt(0);
                if (letterIndex >= 0 && letterIndex < 26) {
                    if (pos > 0xffff) {
                        throw new Error('words file too big');
                    }
                    bytes[letterIndex * 2] = pos >> 8;
                    bytes[letterIndex * 2 + 1] = pos & 0xff;
                    lastFirstLetter = firstLetter;
                }
            }
            pos += encoded[i].length;
        }
        bytes.set(suffix, pos);
        return bytes;
    }
    function unpackObjects(objectsData) {
        let recordLen = 4, masked = true;
        masked = (objectsData[0] | (objectsData[1] << 8)) > objectsData.length;
        if (masked) {
            objectsData = avisDurgan(objectsData.slice());
        }
        if (objectsData[3] !== 0)
            recordLen = 3;
        let objects = [];
        let pos = 0;
        let stopPos = Infinity;
        let suppressFinalTerminator = false;
        while ((pos + recordLen) <= stopPos) {
            const offset = recordLen + (objectsData[pos] | (objectsData[pos + 1] << 8));
            stopPos = Math.min(stopPos, offset);
            let endOffset = objectsData.indexOf(0, offset);
            if (endOffset === -1) {
                endOffset = objectsData.length;
                suppressFinalTerminator = true;
            }
            const name = objectsData.subarray(offset, endOffset), startingRoom = objectsData[pos + 2];
            objects.push(startingRoom ? { name, startingRoom } : { name });
            pos += recordLen;
        }
        return { objects, masked, recordLen, suppressFinalTerminator, };
    }
    function packObjects({ recordLen, objects, masked, suppressFinalTerminator }) {
        const buf = new Uint8Array(recordLen * objects.length + objects.reduce((total, object) => total + object.name.length + 1, 0));
        let pos = recordLen * objects.length;
        const posCache = new Map();
        for (let i = 0; i < objects.length; i++) {
            const name = String.fromCharCode(...objects[i].name);
            if (posCache.has(name)) {
                const cached = posCache.get(name);
                buf[i * recordLen] = cached & 0xff;
                buf[i * recordLen + 1] = (cached >>> 8);
            }
            else {
                const encPos = pos - recordLen;
                posCache.set(name, encPos);
                buf[i * recordLen] = encPos & 0xff;
                buf[i * recordLen + 1] = (encPos >>> 8);
                buf.set(objects[i].name, pos);
                pos += objects[i].name.length + 1;
            }
            buf[i * recordLen + 2] = objects[i].startingRoom || 0;
        }
        if (masked)
            avisDurgan(buf);
        return buf.subarray(0, pos + (suppressFinalTerminator ? -1 : 0));
    }
    async function loadAGIProject(folder) {
        const wordsFile = folder.getFile('words.tok');
        if (!wordsFile)
            return null;
        const words = unpackWords(new Uint8Array(await (await wordsFile.getContent()).arrayBuffer()));
        const objectFile = folder.getFile('object');
        if (!objectFile)
            return null;
        const objects = unpackObjects(new Uint8Array(await (await objectFile.getContent()).arrayBuffer()));
        const logdirFile = folder.getFile('logdir');
        let prefix = '';
        let logdir, viewdir, picdir, snddir;
        let packedDirs;
        let useCompression;
        if (logdirFile) {
            const picdirFile = folder.getFile('picdir');
            const viewdirFile = folder.getFile('viewdir');
            const snddirFile = folder.getFile('snddir');
            if (!(viewdirFile && picdirFile && snddirFile)) {
                return null;
            }
            logdir = new Uint8Array(await (await logdirFile.getContent()).arrayBuffer());
            picdir = new Uint8Array(await (await picdirFile.getContent()).arrayBuffer());
            viewdir = new Uint8Array(await (await viewdirFile.getContent()).arrayBuffer());
            snddir = new Uint8Array(await (await snddirFile.getContent()).arrayBuffer());
            packedDirs = false;
            useCompression = false;
        }
        else {
            let dirsFile = null;
            for (const dirFile of folder.eachFile('*dir*')) {
                const m = dirFile.name.match(/^(.*)dirs?$/i);
                if (!m)
                    continue;
                dirsFile = dirFile;
                prefix = m[1];
            }
            if (!dirsFile) {
                return null;
            }
            packedDirs = !prefix || folder.getFile(prefix + 'vol.0') ? { basename: /s$/i.test(dirsFile.name) ? 'dirs' : 'dir', prefix } : { basename: /s$/i.test(dirsFile.name) ? 'dirs' : 'dir', prefix, suppressVolPrefix: true };
            const dirsData = new Uint8Array(await (await dirsFile.getContent()).arrayBuffer());
            const dirsDV = new DataView(dirsData.buffer, dirsData.byteOffset, dirsData.byteLength);
            const logdirOffset = dirsDV.getUint16(0, true);
            const picdirOffset = dirsDV.getUint16(2, true);
            const viewdirOffset = dirsDV.getUint16(4, true);
            const snddirOffset = dirsDV.getUint16(6, true);
            logdir = dirsData.subarray(logdirOffset, picdirOffset);
            picdir = dirsData.subarray(picdirOffset, viewdirOffset);
            viewdir = dirsData.subarray(viewdirOffset, snddirOffset);
            snddir = dirsData.subarray(snddirOffset);
            useCompression = true;
        }
        function readDir(dir) {
            const array = [];
            for (let pos = 0; pos < dir.length; pos += 3) {
                const combo = (dir[pos] << 16) | (dir[pos + 1] << 8) | dir[pos + 2];
                if (combo === 0xffffff) {
                    array.push(null);
                }
                else {
                    const volNumber = combo >>> 20;
                    const offset = combo & ((1 << 20) - 1);
                    array.push({ volNumber, offset });
                }
            }
            return array;
        }
        const volCache = new Map();
        function getVol(volNumber) {
            const cached = volCache.get(volNumber);
            if (cached)
                return cached;
            const volFile = folder.getFile((packedDirs && !packedDirs.suppressVolPrefix ? prefix : '') + 'vol.' + volNumber);
            if (!volFile)
                return Promise.resolve(null);
            const awaitVol = volFile.getContent().then(blob => blob.arrayBuffer()).then(ab => new Uint8Array(ab));
            volCache.set(volNumber, awaitVol);
            return awaitVol;
        }
        async function loadEntry({ volNumber, offset }, type) {
            const vol = await getVol(volNumber);
            if (!vol) {
                return {
                    type: 'invalid-resource',
                    problem: 'missing-vol-file',
                    volNumber,
                    offset,
                };
            }
            if (vol[offset] !== 0x12 || vol[offset + 1] !== 0x34) {
                if (offset + 2 > vol.length && !(offset + 1 === vol.length && vol[offset] === 0x12)) {
                    return {
                        type: 'invalid-resource',
                        problem: 'truncated',
                        volNumber,
                        offset,
                    };
                }
                return {
                    type: 'invalid-resource',
                    problem: 'invalid-signature',
                    volNumber,
                    offset,
                };
            }
            if (useCompression) {
                const picCompression = Boolean(vol[offset + 2] & 0x80);
                const checkVolNumber = vol[offset + 2] & 0x7f;
                if (checkVolNumber !== volNumber) {
                    return {
                        type: 'invalid-resource',
                        problem: 'vol-number-mismatch',
                        volNumber,
                        offset,
                    };
                }
                const decompressedLength = vol[offset + 3] | (vol[offset + 4] << 8);
                const compressedLength = vol[offset + 5] | (vol[offset + 6] << 8);
                let decompressed;
                let wasCompressed;
                if (decompressedLength === compressedLength && !picCompression) {
                    decompressed = vol.subarray(offset + 7, offset + 7 + decompressedLength);
                    wasCompressed = false;
                }
                else {
                    wasCompressed = true;
                    const compressed = vol.subarray(offset + 7, offset + 7 + compressedLength);
                    try {
                        if (picCompression) {
                            decompressed = decompressPIC(compressed);
                        }
                        else {
                            decompressed = decompressLZW(compressed);
                        }
                        if (decompressed.length !== decompressedLength) {
                            throw new Error('wrong decompressed length');
                        }
                    }
                    catch (e) {
                        return {
                            type: 'invalid-resource',
                            problem: 'compression-error',
                            volNumber,
                            offset,
                            error: e,
                        };
                    }
                }
                return {
                    type: 'raw-resource',
                    resourceType: type,
                    data: decompressed,
                    wasCompressed,
                    volNumber,
                };
            }
            else {
                const checkVolNumber = vol[offset + 2];
                if (checkVolNumber !== volNumber) {
                    return {
                        type: 'invalid-resource',
                        problem: 'vol-number-mismatch',
                        volNumber,
                        offset,
                    };
                }
                const length = vol[offset + 3] | (vol[offset + 4] << 8);
                return {
                    type: 'raw-resource',
                    resourceType: type,
                    data: vol.subarray(offset + 5, offset + 5 + length),
                    wasCompressed: false,
                    volNumber,
                };
            }
        }
        return {
            words,
            objects,
            packedDirs,
            logic: await Promise.all(readDir(logdir).map(v => v ? loadEntry(v, 'logic').then(x => x.type === 'raw-resource' ? unpackLogic(x.data, !x.wasCompressed, v.volNumber) : x) : null)),
            views: await Promise.all(readDir(viewdir).map(v => v ? loadEntry(v, 'view').then(x => x.type === 'raw-resource' ? unpackView(x.data, v.volNumber) : x) : null)),
            pictures: await Promise.all(readDir(picdir).map(v => v ? loadEntry(v, 'picture') : null)),
            sounds: await Promise.all(readDir(snddir).map(v => v ? loadEntry(v, 'sound') : null)),
        };
    }
    async function* eachAGIProject(rootFolder) {
        for (const wordsFile of rootFolder.eachFile('**/words.tok')) {
            const project = await loadAGIProject(wordsFile.parentDirectory);
            if (project)
                yield project;
        }
    }
    // code based on xv3.pas by Lance Ewing
    // http://www.agidev.com/articles/agispec/examples/files/xv3.pas
    function decompressLZW(input) {
        const INITIAL_BITS = 9;
        const MAX_BITS = 11;
        const LAST_CODE = (1 << MAX_BITS) - 1;
        const RESET_CODE = 0x100;
        const STOP_CODE = 0x101;
        const FIRST_DYNAMIC_CODE = STOP_CODE + 1;
        const output = [];
        let bitBuffer = 0;
        let bitCount = 0;
        let bitPos = 0;
        const readBits = (numBits) => {
            while (bitCount < numBits) {
                if (bitPos >= input.length)
                    return STOP_CODE;
                bitBuffer |= input[bitPos++] << bitCount;
                bitCount += 8;
            }
            const result = bitBuffer & ((1 << numBits) - 1);
            bitBuffer >>>= numBits;
            bitCount -= numBits;
            return result;
        };
        const resetTable = () => {
            const table = new Map();
            for (let i = 0; i < 256; i++) {
                table.set(i, [i]);
            }
            return table;
        };
        let codeSize = INITIAL_BITS;
        let table = resetTable();
        let nextCode = FIRST_DYNAMIC_CODE;
        let prev = [];
        while (true) {
            const code = readBits(codeSize);
            if (code === STOP_CODE)
                break; // end of data
            if (code === RESET_CODE) {
                codeSize = INITIAL_BITS;
                table = resetTable();
                nextCode = FIRST_DYNAMIC_CODE;
                prev = [];
                continue;
            }
            let entry;
            if (table.has(code)) {
                entry = table.get(code);
            }
            else if (code >= nextCode && prev.length) {
                entry = [...prev, prev[0]];
            }
            else {
                throw new Error(`Invalid LZW code: ${code}`);
            }
            output.push(...entry);
            if (prev.length && nextCode <= LAST_CODE) {
                table.set(nextCode++, [...prev, entry[0]]);
                if (nextCode === (1 << codeSize) && codeSize < MAX_BITS) {
                    codeSize++;
                }
            }
            prev = entry;
        }
        return new Uint8Array(output);
    }
    function compressLZW(input) {
        const INITIAL_BITS = 9;
        const MAX_BITS = 11;
        const LAST_CODE = (1 << MAX_BITS) - 1;
        const RESET_CODE = 0x100;
        const STOP_CODE = 0x101;
        const FIRST_DYNAMIC_CODE = STOP_CODE + 1;
        const output = [];
        let bitBuffer = 0;
        let bitCount = 0;
        const writeBits = (code, numBits) => {
            bitBuffer |= code << bitCount;
            bitCount += numBits;
            while (bitCount >= 8) {
                output.push(bitBuffer & 0xff);
                bitBuffer >>>= 8;
                bitCount -= 8;
            }
        };
        const flushBits = () => {
            if (bitCount > 0) {
                output.push(bitBuffer & 0xff);
                bitBuffer = 0;
                bitCount = 0;
            }
        };
        const resetTable = () => {
            const table = new Map();
            for (let i = 0; i < 256; i++) {
                table.set(String.fromCharCode(i), i);
            }
            return table;
        };
        let codeSize = INITIAL_BITS;
        let table = resetTable();
        let nextCode = FIRST_DYNAMIC_CODE;
        let currentString = '';
        writeBits(RESET_CODE, codeSize);
        for (let i = 0; i < input.length; i++) {
            const byte = input[i];
            const newString = currentString + String.fromCharCode(byte);
            if (table.has(newString)) {
                currentString = newString;
            }
            else {
                writeBits(table.get(currentString), codeSize);
                if (nextCode <= LAST_CODE) {
                    table.set(newString, nextCode++);
                    if (nextCode - 1 === (1 << codeSize) && codeSize < MAX_BITS) {
                        codeSize++;
                    }
                }
                if (nextCode > LAST_CODE) {
                    writeBits(RESET_CODE, codeSize);
                    codeSize = INITIAL_BITS;
                    table = resetTable();
                    nextCode = FIRST_DYNAMIC_CODE;
                }
                currentString = String.fromCharCode(byte);
            }
        }
        // Write remaining string
        if (currentString.length > 0) {
            writeBits(table.get(currentString), codeSize);
        }
        // Write stop code
        writeBits(STOP_CODE, codeSize);
        flushBits();
        return new Uint8Array(output);
    }
    function decompressPIC(pic) {
        let bytePos = 0;
        let halfByte = false;
        const output = [];
        function readHalfByte() {
            if (halfByte) {
                halfByte = false;
                return pic[bytePos++] & 0x0f;
            }
            else {
                halfByte = true;
                return pic[bytePos] >>> 4;
            }
        }
        function readByte() {
            if (halfByte) {
                const high = pic[bytePos++] & 0x0f;
                const low = pic[bytePos] >>> 4;
                return (high << 4) | low;
            }
            else {
                return pic[bytePos++];
            }
        }
        while (bytePos < pic.length) {
            if (halfByte && bytePos === pic.length - 1)
                break;
            const b = readByte();
            output.push(b);
            if (b === 0xf0 || b === 0xf2) {
                output.push(readHalfByte());
            }
        }
        return new Uint8Array(output);
    }
    function compressPIC(data) {
        let out = [];
        let halfByte = false;
        let currentByte = 0;
        function writeHalfByte(n) {
            if (halfByte) {
                currentByte |= (n & 0x0f);
                out.push(currentByte);
                currentByte = 0;
                halfByte = false;
            }
            else {
                currentByte = (n & 0x0f) << 4;
                halfByte = true;
            }
        }
        function writeByte(n) {
            if (halfByte) {
                currentByte |= n >>> 4;
                out.push(currentByte);
                currentByte = (n & 0x0f) << 4;
            }
            else {
                out.push(n);
            }
        }
        let i = 0;
        while (i < data.length) {
            const b = data[i++];
            writeByte(b);
            if (b === 0xf0 || b === 0xf2) {
                if (i >= data.length) {
                    throw new Error("Missing half-byte after 0xf0 or 0xf2");
                }
                writeHalfByte(data[i++]);
            }
        }
        if (halfByte) {
            out.push(currentByte);
        }
        return new Uint8Array(out);
    }
    function unpackLogic(buf, maskMessages, volNumber) {
        const textOffset = 2 + (buf[0] | (buf[1] << 8));
        if (textOffset + 3 > buf.byteLength) {
            return {
                type: 'invalid-logic',
                problem: 'truncated',
                data: buf,
                volNumber,
            };
        }
        const messageCount = buf[textOffset];
        const textBlock = buf.subarray(textOffset + 1);
        const textBlockSize = textBlock[0] | (textBlock[1] << 8);
        if (textBlock.length < textBlockSize) {
            return {
                type: 'invalid-logic',
                problem: 'truncated',
                data: buf,
                volNumber,
            };
        }
        const messageBlock = textBlock.subarray(2 + messageCount * 2);
        if (maskMessages)
            avisDurgan(messageBlock);
        const messages = new Array(messageCount + 1);
        messages[0] = null;
        for (let i = 1; i < messages.length; i++) {
            const ptr = textBlock[i * 2] | (textBlock[i * 2 + 1] << 8);
            if (ptr === 0) {
                messages[i] = null;
            }
            else {
                if (ptr >= textBlock.byteLength) {
                    return {
                        type: 'invalid-logic',
                        problem: 'truncated',
                        data: buf,
                        volNumber,
                    };
                }
                const endOffset = textBlock.indexOf(0, ptr);
                if (endOffset === -1) {
                    return {
                        type: 'invalid-logic',
                        problem: 'truncated',
                        data: buf,
                        volNumber,
                    };
                }
                messages[i] = textBlock.subarray(ptr, endOffset);
            }
        }
        return {
            type: 'logic',
            bytecode: buf.subarray(2, textOffset),
            messages,
            maskMessages,
            volNumber,
        };
    }
    function packLogic(logic, mask) {
        const len = 2 + logic.bytecode.length + 1 + logic.messages.length * 2 + logic.messages.reduce((total, msg) => total + (msg ? msg.length + 1 : 0), 0);
        const bytes = new Uint8Array(len);
        bytes[0] = logic.bytecode.length & 0xff;
        bytes[1] = logic.bytecode.length >>> 8;
        bytes.set(logic.bytecode, 2);
        const messageCount = Math.max(0, logic.messages.length - 1);
        bytes[2 + logic.bytecode.length] = messageCount;
        const textBlock = bytes.subarray(2 + logic.bytecode.length + 1);
        const startPos = 2 + messageCount * 2;
        textBlock[0] = textBlock.length & 0xff;
        textBlock[1] = textBlock.length >>> 8;
        let pos = startPos;
        for (let i = 0; i < messageCount; i++) {
            const message = logic.messages[i + 1];
            if (!message)
                continue;
            textBlock[2 + i * 2] = pos & 0xff;
            textBlock[2 + i * 2 + 1] = pos >>> 8;
            textBlock.set(message, pos);
            pos += message.length + 1;
        }
        if (mask)
            avisDurgan(textBlock.subarray(startPos));
        return bytes;
    }
    function unpackView(data, volNumber) {
        const signature = data[0] | (data[1] << 8);
        switch (signature) {
            case 0x0100:
            case 0x0101:
            case 0x0102:
            case 0x0200:
            case 0x0700:
            case 0x0500:
            case 0x0103:
            case 0x0201:
            case 0x0202:
            case 0x0400:
            case 0x0401:
            case 0x0301:
            case 0x0203:
            case 0x0601:
            case 0x0501:
            case 0x0302: {
                break;
            }
            default: {
                return {
                    type: 'invalid-view',
                    problem: 'unknown-signature',
                    rawData: data,
                    volNumber,
                };
            }
        }
        const loops = new Array(data[2]);
        const descriptionPos = data[3] | (data[4] << 8);
        let description;
        if (descriptionPos) {
            let endOffset = data.indexOf(0, descriptionPos);
            if (endOffset === -1)
                endOffset = data.length;
            description = data.subarray(descriptionPos, endOffset);
        }
        else {
            description = null;
        }
        for (let loop_i = 0; loop_i < loops.length; loop_i++) {
            const loopPos = data[5 + loop_i * 2] | (data[5 + loop_i * 2 + 1] << 8);
            const cels = new Array(data[loopPos]);
            for (let cel_i = 0; cel_i < cels.length; cel_i++) {
                const celPos = loopPos + (data[loopPos + 1 + cel_i * 2] | (data[loopPos + 1 + cel_i * 2 + 1] << 8));
                const width = data[celPos];
                const height = data[celPos + 1];
                const transpMirror = data[celPos + 2];
                const transparencyColor = transpMirror & 0xf;
                const mirror = Boolean(transpMirror & 0x80) && loop_i !== ((transpMirror >>> 4) & 0x7);
                const celData = new Uint8Array(width * height);
                celData.fill(transparencyColor);
                let readPos = celPos + 3;
                for (let y = 0; y < height; y++) {
                    let x = 0;
                    for (;;) {
                        if (readPos >= data.length) {
                            return {
                                type: 'invalid-view',
                                problem: 'truncated-view-data',
                                rawData: data,
                                volNumber,
                            };
                        }
                        const b = data[readPos++];
                        if (b === 0)
                            break;
                        const color = b >>> 4;
                        const len = b & 0xf;
                        celData.fill(color, y * width + x, y * width + x + len);
                        x += len;
                        if (x > width) {
                            return {
                                type: 'invalid-view',
                                problem: 'pixel-data-exceeds-row',
                                rawData: data,
                                volNumber,
                            };
                        }
                    }
                }
                if (mirror) {
                    for (let y = 0; y < height; y++) {
                        celData.subarray(y * width, (y + 1) * width).reverse();
                    }
                }
                cels[cel_i] = {
                    width,
                    height,
                    transparencyColor,
                    pixelData: celData,
                };
            }
            loops[loop_i] = { cels };
        }
        return {
            type: 'view',
            signature,
            description,
            loops,
            volNumber,
        };
    }
    function areMirroredLoops(loop1, loop2) {
        if (loop1.cels.length !== loop2.cels.length)
            return false;
        const cel_count = loop1.cels.length;
        for (let cel_i = 0; cel_i < cel_count; cel_i++) {
            const cel1 = loop1.cels[cel_i], cel2 = loop2.cels[cel_i];
            if (cel1.width !== cel2.width
                || cel1.height !== cel2.height
                || cel1.transparencyColor !== cel2.transparencyColor) {
                return false;
            }
            const { width, height } = cel1;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    if (cel1.pixelData[y * width + x] !== cel2.pixelData[(y + 1) * width - (1 + x)]) {
                        return false;
                    }
                }
            }
        }
        return true;
    }
    function packView(view) {
        const mirrorLoops = new Array(view.loops.length).fill(-1);
        for (let loop_i = 0; loop_i < Math.min(view.loops.length, 8) - 1; loop_i++) {
            if (mirrorLoops[loop_i] !== -1)
                continue;
            for (let loop_j = loop_i + 1; loop_j < 8; loop_j++) {
                if (mirrorLoops[loop_j] !== -1)
                    continue;
                if (areMirroredLoops(view.loops[loop_i], view.loops[loop_j])) {
                    mirrorLoops[loop_i] = loop_j;
                    mirrorLoops[loop_j] = loop_i;
                    break;
                }
            }
        }
        const buf = new Uint8Array(5 + view.loops.length * 2 +
            (view.description ? view.description.length + 1 : 0) +
            view.loops.reduce((total, loop) => (total + 1 + loop.cels.length * 2 +
                loop.cels.reduce((total, cel) => total + 3 + (cel.width + 1) * cel.height, 0)), 0));
        buf[0] = view.signature & 0xff;
        buf[1] = (view.signature >>> 8) & 0xff;
        buf[2] = view.loops.length;
        let pos = 5 + view.loops.length * 2;
        for (let i = 0; i < view.loops.length; i++) {
            const isMirror = mirrorLoops[i] !== -1;
            if (isMirror && mirrorLoops[i] < i) {
                buf[5 + i * 2] = buf[5 + mirrorLoops[i] * 2];
                buf[5 + i * 2 + 1] = buf[5 + mirrorLoops[i] * 2 + 1];
                continue;
            }
            const mirrorCode = isMirror ? 0x80 | (i << 4) : 0x00;
            const loopPos = pos;
            buf[5 + i * 2] = loopPos & 0xff;
            buf[5 + i * 2 + 1] = (loopPos >> 8) & 0xff;
            const loop = view.loops[i];
            buf[loopPos] = loop.cels.length;
            pos += 1 + loop.cels.length * 2;
            for (let cel_i = 0; cel_i < loop.cels.length; cel_i++) {
                const celPos = pos - loopPos;
                buf[loopPos + 1 + cel_i * 2] = celPos & 0xff;
                buf[loopPos + 1 + cel_i * 2 + 1] = (celPos >>> 8) & 0xff;
                const cel = loop.cels[cel_i];
                buf[pos] = cel.width;
                buf[pos + 1] = cel.height;
                buf[pos + 2] = mirrorCode | cel.transparencyColor;
                pos += 3;
                for (let y = 0; y < cel.height; y++) {
                    let x = 0;
                    while (x < cel.width) {
                        let color = cel.pixelData[(y * cel.width) + x];
                        let x2 = x + 1;
                        while (x2 < cel.width && cel.pixelData[(y * cel.width) + x2] === color) {
                            x2++;
                        }
                        if (x2 === cel.width && color === cel.transparencyColor) {
                            break;
                        }
                        let count = x2 - x;
                        while (count > 15) {
                            buf[pos++] = (color << 4) | 0xf;
                            count -= 15;
                        }
                        buf[pos++] = (color << 4) | count;
                        x = x2;
                    }
                    pos++; // end-of-line code
                }
            }
        }
        if (view.description) {
            buf[3] = pos & 0xff;
            buf[4] = (pos >>> 8) & 0xff;
            buf.set(view.description, pos);
            pos += view.description.length + 1;
        }
        if (pos > buf.length) {
            throw new Error('bad length!');
        }
        return buf.subarray(0, pos);
    }
    var AGISection;
    (function (AGISection) {
        AGISection[AGISection["Logic"] = 1] = "Logic";
        AGISection[AGISection["Objects"] = 2] = "Objects";
        AGISection[AGISection["Pictures"] = 3] = "Pictures";
        AGISection[AGISection["Sounds"] = 4] = "Sounds";
        AGISection[AGISection["Views"] = 5] = "Views";
        AGISection[AGISection["Words"] = 6] = "Words";
    })(AGISection || (AGISection = {}));
    const agiHash = (agi) => {
        const h = new MurmurHash3();
        const vBytes = new Uint8Array(4);
        const v = new DataView(vBytes.buffer);
        const i32 = (num) => { v.setInt32(0, num, true); h.add(vBytes); };
        i32(AGISection.Logic);
        for (const [i, logic] of agi.logic.entries()) {
            if (!logic || logic.type !== 'logic')
                continue;
            i32(i);
            i32(logic.bytecode.length);
            h.add(logic.bytecode);
            for (const [j, message] of logic.messages.entries()) {
                if (message) {
                    i32(j);
                    i32(message.length);
                    h.add(message);
                }
            }
            i32(-1);
        }
        i32(-1);
        i32(AGISection.Objects);
        for (const [i, obj] of agi.objects.objects.entries()) {
            i32(i);
            i32(obj.startingRoom || 0);
            i32(obj.name.length);
            h.add(obj.name);
        }
        i32(-1);
        i32(AGISection.Pictures);
        for (const [i, pic] of agi.pictures.entries()) {
            if (!pic || pic.type !== 'raw-resource')
                continue;
            i32(i);
            h.add(pic.data);
        }
        i32(-1);
        i32(AGISection.Sounds);
        for (const [i, snd] of agi.sounds.entries()) {
            if (!snd || snd.type !== 'raw-resource')
                continue;
            i32(i);
            h.add(snd.data);
        }
        i32(-1);
        i32(AGISection.Views);
        for (const [i, view] of agi.views.entries()) {
            if (!view || view.type !== 'view')
                continue;
            i32(i);
            i32(view.signature);
            i32(view.loops.length);
            for (const loop of view.loops) {
                i32(loop.cels.length);
                for (const cel of loop.cels) {
                    i32(cel.width);
                    i32(cel.height);
                    i32(cel.transparencyColor);
                    h.add(cel.pixelData);
                }
            }
        }
        i32(-1);
        i32(AGISection.Words);
        for (const [word, num] of [...agi.words.words].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) {
            i32(num);
            i32(word.length);
            h.add(new Uint8Array([...word].map(v => v.charCodeAt(0))));
        }
        i32(-1);
        return h.digest();
    };

    function makeFileReceiver({ dropTarget, }) {
        let singleFileTarget = dropTarget.querySelector('input[type=file]:not([multiple], [webkitdirectory])');
        let multiFileTarget = dropTarget.querySelector('input[type=file][multiple]');
        let dirTarget = dropTarget.querySelector('input[type=file][webkitdirectory]');
        if (singleFileTarget) {
            singleFileTarget.addEventListener('change', e => {
                const f = singleFileTarget.files && singleFileTarget.files[0];
                if (f) {
                    dropTarget.dispatchEvent(new CustomEvent('file-drop', { detail: { file: f } }));
                }
            });
            dropTarget.querySelectorAll('[data-action=choose-file]').forEach(el => {
                el.addEventListener('click', () => singleFileTarget.click());
            });
        }
        if (multiFileTarget) {
            multiFileTarget.addEventListener('change', e => {
                if (multiFileTarget.files) {
                    processFileList(multiFileTarget.files).then(value => {
                        dropTarget.dispatchEvent(new CustomEvent('files-drop', { detail: { files: value } }));
                    });
                }
            });
            dropTarget.querySelectorAll('[data-action=choose-files]').forEach(el => {
                el.addEventListener('click', () => multiFileTarget.click());
            });
        }
        if (dirTarget) {
            dirTarget.addEventListener('change', e => {
                if (dirTarget.files && dirTarget.files.length > 0) {
                    dropTarget.dispatchEvent(new CustomEvent('files-drop', { detail: { files: processFlattenedFileList(dirTarget.files) } }));
                }
            });
            dropTarget.querySelectorAll('[data-action=choose-folder]').forEach(el => {
                el.addEventListener('click', () => dirTarget.click());
            });
        }
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
            ev.preventDefault();
            dragCounter = 0;
            dropTarget.classList.remove('drop-hovering');
            let result;
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
                    dropTarget.dispatchEvent(new CustomEvent('files-drop', { detail: { files: value } }));
                });
            }
        });
    }
    function processFlattenedFileList(files) {
        const fileMap = new Map();
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
    async function processFileList(items) {
        const result = new Map();
        // Convert items to array for easier handling
        const itemsArray = Array.from(items);
        // Process each item
        await Promise.all(itemsArray.map(async (item) => {
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
        }));
        return result;
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
                            Promise.all(entries.map(async (subEntry) => {
                                const processed = await processEntry(subEntry);
                                if (processed) {
                                    result.set(subEntry.name, processed);
                                }
                            }))
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
    const HOVER_MS = 350;
    function clickOnDragHover(el) {
        let timeout = null;
        const click = () => {
            el.click();
        };
        let lastX = NaN, lastY = NaN;
        const clearHover = () => {
            if (timeout != null)
                clearTimeout(timeout);
            timeout = null;
            lastX = lastY = NaN;
        };
        el.addEventListener('dragover', (ev) => {
            ev.preventDefault();
            if (ev.clientX !== lastX || ev.clientY !== lastY) {
                lastX = ev.clientX;
                lastY = ev.clientY;
                if (timeout != null)
                    clearTimeout(timeout);
                timeout = setTimeout(click, HOVER_MS);
            }
        });
        el.addEventListener('dragenter', function (ev) {
            ev.preventDefault();
        });
        el.addEventListener('dragleave', function (ev) {
            ev.preventDefault();
            clearHover();
        });
        el.addEventListener('drop', function (ev) {
            clearHover();
        });
    }

    function diffBytes(a, b) {
        const N = a.length, M = b.length, maxD = N + M;
        if (maxD === 0)
            return [];
        // Create an array V indexed from -maxD to maxD.
        // For simplicity, use an offset so that V[k] is stored at V[V_offset + k].
        const V_len = 2 * maxD + 1;
        const V_offset = maxD;
        if (a.length > Number.MAX_SAFE_INTEGER)
            throw new Error('too long');
        const V = (a.length > 0xffffffff ? new Float64Array(V_len)
            : a.length > 0xffff ? new Uint32Array(V_len)
                : a.length > 0xff ? new Uint16Array(V_len)
                    : new Uint8Array(V_len));
        // 'trace' will record the state of V at each edit distance D for backtracking.
        const trace = [];
        // Iterate through possible edit distances D.
        outer: for (let D = 0;; D++) {
            if (D > maxD) {
                throw new Error('diff failed');
            }
            // Save a snapshot of the current V for backtracking.
            trace.push(V.slice());
            // Explore each possible diagonal k = x − y for the current D.
            for (let k = -D; k <= D; k += 2) {
                // Decide whether to follow an insertion or a deletion.
                let x;
                if (k === -D) {
                    // Only option is an insertion (move down in the edit graph).
                    x = V[V_offset + k + 1];
                }
                else if (k !== D && V[V_offset + k - 1] < V[V_offset + k + 1]) {
                    // Choose insertion (down move) if it goes further.
                    x = V[V_offset + k + 1];
                }
                else {
                    // Otherwise choose deletion (right move).
                    x = V[V_offset + k - 1] + 1;
                }
                let y = x - k;
                // Follow the “snake” (diagonal) while the elements match.
                while (x < N && y < M && a[x] === b[y]) {
                    x++;
                    y++;
                }
                // Store the furthest x reached for diagonal k.
                V[V_offset + k] = x;
                // If the end of both sequences is reached, return the trace for reconstruction.
                if (x >= N && y >= M)
                    break outer;
            }
        }
        // backtracking stage:
        // Start from the end of both sequences.
        let x = a.length, y = b.length;
        const edits = [];
        const same = (a_pos) => {
            const last = edits[edits.length - 1];
            if (last && last.type === 'same') {
                last.count++;
            }
            else {
                edits.push({ type: 'same', count: 1 });
            }
        };
        const insert = (b_pos) => {
            const last = edits[edits.length - 1];
            if (last && last.type === 'insert') {
                last.bytes = new Uint8Array(last.bytes.buffer, last.bytes.byteOffset - 1, last.bytes.byteLength + 1);
            }
            else {
                edits.push({ type: 'insert', bytes: b.subarray(b_pos, b_pos + 1) });
            }
        };
        const del = (a_pos) => {
            const last = edits[edits.length - 1];
            if (last && last.type === 'delete') {
                last.count++;
            }
            else {
                edits.push({ type: 'delete', count: 1 });
            }
        };
        // Traverse the trace from the last D back to 0.
        for (let D = trace.length - 1; D >= 0; D--) {
            const V = trace[D];
            const k = x - y;
            // Determine the previous k value from which (x, y) was reached.
            let prevK;
            if ((k === -D) || (k !== D && V[V_offset + k - 1] < V[V_offset + k + 1])) {
                prevK = k + 1;
            }
            else {
                prevK = k - 1;
            }
            // Get the x coordinate from the previous step.
            const prevX = V[V_offset + prevK];
            const prevY = prevX - prevK;
            // Trace back the diagonal (the matching "snake") from (x, y) to (prevX, prevY).
            while (x > prevX && y > prevY) {
                // Record a matching element (unchanged in both a and b).
                same();
                x--;
                y--;
            }
            // If we've exhausted D = 0, break the loop.
            if (D === 0)
                break;
            // Determine the edit that produced the jump from the previous diagonal.
            if (x === prevX) {
                // An insertion was made in sequence a (i.e. element from b added).
                insert(prevY);
            }
            else {
                // A deletion was made from sequence a.
                del();
            }
            // Set (x, y) to the previous coordinates for the next iteration.
            x = prevX;
            y = prevY;
        }
        edits.reverse();
        for (let edit_i = 0; edit_i + 1 < edits.length; edit_i++) {
            const edit = edits[edit_i];
            let insertCount, deleteCount;
            if (edit.type === 'delete') {
                deleteCount = edit.count;
                insertCount = 0;
            }
            else if (edit.type === 'insert') {
                insertCount = edit.bytes.length;
                deleteCount = 0;
            }
            else {
                continue;
            }
            let edit_j = edit_i + 1;
            while (edit_j < edits.length) {
                const edit2 = edits[edit_j];
                if (edit2.type === 'insert') {
                    insertCount += edit2.bytes.length;
                }
                else if (edit2.type === 'delete') {
                    deleteCount += edit2.count;
                }
                else {
                    break;
                }
                edit_j++;
            }
            const replaceCount = Math.min(insertCount, deleteCount);
            if (replaceCount > 0) {
                const concat = new Uint8Array(edits.slice(edit_i, edit_j).reduce((total, v) => total + (v.type === 'insert' ? v.bytes.length : 0), 0));
                let pos = 0;
                for (let edit_k = edit_i; edit_k < edit_j; edit_k++) {
                    const edit3 = edits[edit_k];
                    if (edit3.type === 'insert') {
                        concat.set(edit3.bytes, pos);
                        pos += edit3.bytes.length;
                    }
                }
                const replace = [{ type: 'replace', bytes: concat.subarray(0, replaceCount) }];
                insertCount -= replaceCount;
                deleteCount -= replaceCount;
                if (insertCount > 0) {
                    replace.push({ type: 'insert', bytes: concat.subarray(replaceCount) });
                }
                if (deleteCount > 0) {
                    replace.push({ type: 'delete', count: deleteCount });
                }
                edits.splice(edit_i, edit_j - edit_i, ...replace);
                edit_i += replace.length - 1;
            }
        }
        return edits;
    }

    const byteArraysEqual = (a, b) => a.length === b.length && a.every((v, i) => b[i] === v);
    function applyDiff(a, bytepool, diff) {
        const steps = diff.matchAll(/\s*([@\+\-=~])\s*([0-9a-fA-F]+)/g);
        let aOffset = 0, bOffset = 0;
        const output = [];
        for (const [, symbol, numStr] of steps) {
            const num = parseInt(numStr, 16);
            switch (symbol) {
                case '@':
                    bOffset = num;
                    break;
                case '-':
                    aOffset += num;
                    break;
                case '=':
                    for (let i = 0; i < num; i++) {
                        output.push(a[aOffset++]);
                    }
                    if (aOffset > a.length) {
                        throw new Error('read past end of input');
                    }
                    break;
                case '+':
                    for (let i = 0; i < num; i++) {
                        output.push(bytepool[bOffset++]);
                    }
                    if (bOffset > bytepool.length) {
                        throw new Error('read past end of input');
                    }
                    break;
                case '~':
                    for (let i = 0; i < num; i++) {
                        output.push(a[aOffset++] ^ bytepool[bOffset++]);
                    }
                    if (aOffset > a.length || bOffset > bytepool.length) {
                        throw new Error('read past end of input');
                    }
                    break;
            }
        }
        return new Uint8Array(output);
    }
    function createAGIPatch(srcAGI, dstAGI) {
        const patchObject = {
            type: 'agi',
            hashOriginal: agiHash(srcAGI).toString(16).padStart(8, '0'),
            hashPatched: agiHash(dstAGI).toString(16).padStart(8, '0'),
        };
        const patchContainer = {
            formatVersion: 1,
            patches: [patchObject],
        };
        const chunks = [];
        let chunkPos = 0;
        const writeChunk = (chunk) => {
            let startPos = chunkPos;
            chunks.push(chunk);
            chunkPos += chunk.length;
            return startPos;
        };
        const dataDiff = (chunk1, chunk2) => {
            if (!chunk1) {
                const start = writeChunk(chunk2);
                return `@${start.toString(16)} +${chunk2.length.toString(16)}`;
            }
            const parts = diffBytes(chunk1, chunk2);
            const diffStringParts = [];
            let startPos = -1;
            let chunk1_pos = 0, chunk2_pos = 0;
            for (let part_i = 0; part_i < parts.length; part_i++) {
                const part = parts[part_i];
                switch (part.type) {
                    case 'delete':
                        diffStringParts.push('-' + part.count.toString(16));
                        chunk1_pos += part.count;
                        break;
                    case 'insert':
                        if (startPos === -1)
                            startPos = writeChunk(part.bytes);
                        else
                            writeChunk(part.bytes);
                        diffStringParts.push('+' + part.bytes.length.toString(16));
                        chunk2_pos += part.bytes.length;
                        break;
                    case 'same':
                        diffStringParts.push('=' + part.count.toString(16));
                        chunk1_pos += part.count;
                        chunk2_pos += part.count;
                        break;
                    case 'replace':
                        diffStringParts.push('~' + part.bytes.length.toString(16));
                        const xorChunk = new Uint8Array(part.bytes.length);
                        for (let i = 0; i < xorChunk.length; i++) {
                            xorChunk[i] = chunk1[chunk1_pos++] ^ chunk2[chunk2_pos++];
                        }
                        if (startPos === -1)
                            startPos = writeChunk(xorChunk);
                        else
                            writeChunk(xorChunk);
                        break;
                }
            }
            return (startPos === -1 ? '' : `@${startPos.toString(16)} `) + diffStringParts.join(' ');
        };
        const wordsDiff = {};
        const words1 = srcAGI.words;
        const words2 = dstAGI.words;
        const combinedWords = new Set([...words1.words.keys(), ...words2.words.keys()]);
        for (const word of combinedWords) {
            const v1 = words1.words.get(word), v2 = words2.words.get(word);
            if (v1 === v2)
                continue;
            wordsDiff[word] = typeof v2 === 'undefined' ? null : v2;
        }
        if (Object.keys(wordsDiff).length !== 0) {
            patchObject.words = wordsDiff;
        }
        const logic_count = Math.max(srcAGI.logic.length, dstAGI.logic.length);
        const logicDiff = {};
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
                const messages = {};
                for (let i = 0; i < logic2.messages.length; i++) {
                    const msgBytes = logic2.messages[i];
                    if (msgBytes) {
                        messages[i] = dataDiff(null, msgBytes);
                    }
                }
                logicDiff[logic_i] = { bytecode, messages, volNumber: logic2.volNumber };
                continue;
            }
            let bytecode = undefined;
            if (!byteArraysEqual(logic1.bytecode, logic2.bytecode)) {
                bytecode = dataDiff(logic1.bytecode, logic2.bytecode);
            }
            let messages = {};
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
            const bytecodePart = bytecode ? { bytecode } : null;
            const messagePart = Object.keys(messages).length !== 0 ? { messages } : null;
            const volNumberPart = logic1.volNumber === logic2.volNumber ? null : { volNumber: logic2.volNumber };
            if (bytecodePart || messagePart || volNumberPart) {
                logicDiff[logic_i] = {
                    ...bytecodePart,
                    ...messagePart,
                    ...volNumberPart,
                };
            }
        }
        if (Object.keys(logicDiff).length !== 0) {
            patchObject.logic = logicDiff;
        }
        const picture_count = Math.max(srcAGI.pictures.length, dstAGI.pictures.length);
        const pictureDiff = {};
        for (let pic_i = 0; pic_i < picture_count; pic_i++) {
            const pic1 = srcAGI.pictures[pic_i], pic2 = dstAGI.pictures[pic_i];
            if (!pic2 || pic2.type !== 'raw-resource') {
                if (pic1 && pic1.type === 'raw-resource') {
                    pictureDiff[pic_i] = null;
                }
                continue;
            }
            const pic1Data = pic1 && pic1.type === 'raw-resource' ? pic1.data : null;
            const pic2Data = pic2.data;
            const dataPart = pic1Data == null || !byteArraysEqual(pic1Data, pic2Data) ? { data: dataDiff(pic1Data, pic2Data) } : null;
            const volNumberPart = pic1 && pic1.volNumber !== pic2.volNumber ? { volNumber: pic2.volNumber } : null;
            if (dataPart || volNumberPart) {
                pictureDiff[pic_i] = {
                    ...dataPart,
                    ...volNumberPart,
                };
            }
        }
        if (Object.keys(pictureDiff).length !== 0) {
            patchObject.pictures = pictureDiff;
        }
        const sound_count = Math.max(srcAGI.sounds.length, dstAGI.sounds.length);
        const soundDiff = {};
        for (let snd_i = 0; snd_i < sound_count; snd_i++) {
            const snd1 = srcAGI.sounds[snd_i], snd2 = dstAGI.sounds[snd_i];
            if (!snd2 || snd2.type !== 'raw-resource') {
                if (snd1 && snd1.type === 'raw-resource') {
                    soundDiff[snd_i] = null;
                }
                continue;
            }
            const snd1Data = snd1 && snd1.type === 'raw-resource' ? snd1.data : null;
            const snd2Data = snd2.data;
            const dataPart = snd1Data == null || !byteArraysEqual(snd1Data, snd2Data) ? { data: dataDiff(snd1Data, snd2Data) } : null;
            const volNumberPart = snd1 && snd1.volNumber !== snd2.volNumber ? { volNumber: snd2.volNumber } : null;
            if (dataPart || volNumberPart) {
                soundDiff[snd_i] = {
                    ...dataPart,
                    ...volNumberPart,
                };
            }
        }
        if (Object.keys(soundDiff).length !== 0) {
            patchObject.sounds = soundDiff;
        }
        const view_count = Math.max(srcAGI.views.length, dstAGI.views.length);
        const viewDiff = {};
        for (let view_i = 0; view_i < view_count; view_i++) {
            const view1 = srcAGI.views[view_i], view2 = dstAGI.views[view_i];
            if (!view2 || view2.type !== 'view') {
                if (view1 && view1.type === 'view') {
                    viewDiff[view_i] = null;
                }
                continue;
            }
            const newSignature = (view1 && view1.type === 'view' && view1.signature === view2.signature) ? null : view2.signature;
            view2.loops.length;
            const loops = {};
            const loops1 = view1 && view1.type === 'view' ? view1.loops : [];
            for (let loop_i = 0; loop_i < view2.loops.length; loop_i++) {
                const cels1 = loops1[loop_i] && loops1[loop_i].cels || [];
                const cels2 = view2.loops[loop_i].cels;
                const cels = {};
                for (let cel_i = 0; cel_i < cels2.length; cel_i++) {
                    const cel1 = cels1[cel_i], cel2 = cels2[cel_i];
                    if (!cel1) {
                        cels[cel_i] = {
                            width: cel2.width,
                            height: cel2.height,
                            transparencyColor: cel2.transparencyColor,
                            pixelData: dataDiff(null, cel2.pixelData),
                        };
                    }
                    else {
                        const newWidth = (cel1.width === cel2.width) ? null : cel2.width;
                        const newHeight = (cel1.height === cel2.height) ? null : cel2.height;
                        const newTransp = (cel1.transparencyColor === cel2.transparencyColor) ? null : cel2.transparencyColor;
                        let pixelDiff;
                        if (byteArraysEqual(cel1.pixelData, cel2.pixelData)) {
                            pixelDiff = null;
                        }
                        else {
                            const srcData = new Uint8Array(cel2.width * cel2.height);
                            srcData.fill(cel1.transparencyColor);
                            for (let y = 0; y < Math.min(cel1.height, cel2.height); y++) {
                                srcData.set(cel1.pixelData.subarray(cel1.width * y, cel1.width * y + Math.min(cel1.width, cel2.width)), cel2.width * y);
                            }
                            pixelDiff = dataDiff(srcData, cel2.pixelData);
                        }
                        if (newWidth != null || newHeight != null || newTransp != null || pixelDiff != null) {
                            cels[cel_i] = {
                                ...newWidth != null ? { width: newWidth } : null,
                                ...newHeight != null ? { height: newHeight } : null,
                                ...newTransp != null ? { transparencyColor: newTransp } : null,
                                pixelData: pixelDiff || ('=' + cel1.pixelData.length),
                            };
                        }
                    }
                }
                for (let cel_i = cels2.length; cel_i < cels1.length; cel_i++) {
                    cels[cel_i] = null;
                }
                if (Object.keys(cels).length > 0) {
                    loops[loop_i] = { cels };
                }
            }
            for (let loop_i = view2.loops.length; loop_i < loops1.length; loop_i++) {
                loops[loop_i] = null;
            }
            const anyLoops = Object.keys(loops).length > 0;
            const volNumberPart = view1 && view1.volNumber === view2.volNumber ? null : { volNumber: view2.volNumber };
            if (newSignature != null || anyLoops) {
                viewDiff[view_i] = {
                    ...(newSignature != null) ? { signature: newSignature } : null,
                    ...anyLoops ? { loops } : null,
                    ...volNumberPart,
                };
            }
        }
        if (Object.keys(viewDiff).length !== 0) {
            patchObject.views = viewDiff;
        }
        const object_count = dstAGI.objects.objects.length;
        const objectDiff = {};
        for (let obj_i = 0; obj_i < object_count; obj_i++) {
            const obj1 = srcAGI.objects.objects[obj_i], obj2 = dstAGI.objects.objects[obj_i];
            const name1 = obj1 ? obj1.name : new Uint8Array(0);
            const room1 = obj1 && obj1.startingRoom || 0;
            const name2 = obj2.name;
            const room2 = obj2.startingRoom || 0;
            const nameDiff = byteArraysEqual(name1, name2) ? null : dataDiff(name1, name2);
            const roomDiff = room1 !== room2 ? room2 : null;
            if (nameDiff != null || roomDiff != null) {
                objectDiff[obj_i] = {
                    ...nameDiff != null ? { name: nameDiff } : null,
                    ...roomDiff != null ? { room: roomDiff } : null,
                };
            }
        }
        for (let obj_i = dstAGI.objects.objects.length; obj_i < srcAGI.objects.objects.length; obj_i++) {
            objectDiff[obj_i] = null;
        }
        if (Object.keys(objectDiff).length !== 0) {
            patchObject.objects = objectDiff;
        }
        return {
            json: patchContainer,
            bytepool: new Blob(chunks),
        };
    }
    function applyAGIPatch(srcAGI, patchContainer, bytepool) {
        const logic = [...srcAGI.logic];
        const objects = { ...srcAGI.objects };
        const packedDirs = srcAGI.packedDirs;
        const pictures = [...srcAGI.pictures];
        const sounds = [...srcAGI.sounds];
        const views = [...srcAGI.views];
        const words = { words: new Map(srcAGI.words.words), suffix: srcAGI.words.suffix };
        const hash = agiHash(srcAGI);
        for (const patch of patchContainer.patches) {
            const originalHash = parseInt(patch.hashOriginal, 16);
            if (originalHash !== hash) {
                continue;
            }
            if (patch.logic) {
                for (const [logic_i_str, logicEntry] of Object.entries(patch.logic)) {
                    const logic_i = Number(logic_i_str);
                    if (logic_i >= logic.length)
                        logic.length = logic_i + 1;
                    if (logicEntry === null) {
                        logic[logic_i] = null;
                        continue;
                    }
                    const existingLogic = logic[logic_i] && logic[logic_i].type === 'logic' ? logic[logic_i] : null;
                    const existingBytecode = existingLogic ? existingLogic.bytecode : new Uint8Array(0);
                    const bytecode = logicEntry.bytecode ? applyDiff(existingBytecode, bytepool, logicEntry.bytecode) : existingBytecode;
                    const messages = existingLogic ? [...existingLogic.messages] : [];
                    for (const [msg_i_str, msgDiff] of Object.entries(logicEntry.messages || {})) {
                        const msg_i = Number(msg_i_str);
                        if (msg_i >= messages.length) {
                            messages.length = msg_i + 1;
                        }
                        if (msgDiff === null) {
                            messages[msg_i] = null;
                        }
                        else {
                            const existingMsg = messages[msg_i] || new Uint8Array(0);
                            messages[msg_i] = applyDiff(existingMsg, bytepool, msgDiff);
                        }
                    }
                    logic[logic_i] = {
                        type: 'logic',
                        bytecode,
                        messages,
                        volNumber: logicEntry.volNumber ?? existingLogic?.volNumber ?? 0,
                    };
                }
            }
            if (patch.objects) {
                const objectList = objects.objects.slice();
                for (const [obj_i_str, objEntry] of Object.entries(patch.objects)) {
                    const obj_i = Number(obj_i_str);
                    if (obj_i >= objectList.length) {
                        objectList.length = obj_i + 1;
                    }
                    if (objEntry == null) {
                        objectList[obj_i] = null;
                        continue;
                    }
                    if (!objectList[obj_i]) {
                        if (!objEntry.name) {
                            throw new Error('object with undefined name');
                        }
                        const name = applyDiff(new Uint8Array(0), bytepool, objEntry.name);
                        objectList[obj_i] = { name, startingRoom: objEntry.startingRoom || 0 };
                    }
                    else {
                        const name = objEntry.name ? applyDiff(objectList[obj_i].name, bytepool, objEntry.name) : objectList[obj_i].name;
                        objectList[obj_i] = { name, startingRoom: objEntry.startingRoom ?? objectList[obj_i].startingRoom };
                    }
                }
                while (objectList.length > 0 && objectList[objectList.length - 1] == null) {
                    objectList.length--;
                }
                for (let i = 0; i < objectList.length; i++) {
                    if (objectList[i] == null) {
                        throw new Error('gaps in object list');
                    }
                }
                objects.objects = objectList;
            }
            if (patch.pictures) {
                for (const [pic_i_str, picEntry] of Object.entries(patch.pictures)) {
                    const pic_i = Number(pic_i_str);
                    if (pic_i >= pictures.length)
                        pictures.length = pic_i + 1;
                    if (picEntry === null) {
                        pictures[pic_i] = null;
                        continue;
                    }
                    const existingPic = (srcAGI.pictures[pic_i]?.type === 'raw-resource') ? srcAGI.pictures[pic_i].data : new Uint8Array(0);
                    pictures[pic_i] = {
                        type: 'raw-resource',
                        resourceType: 'picture',
                        data: picEntry.data ? applyDiff(existingPic, bytepool, picEntry.data) : existingPic,
                        wasCompressed: false,
                        volNumber: picEntry.volNumber ?? srcAGI.pictures[pic_i]?.volNumber ?? 0,
                    };
                }
            }
            if (patch.sounds) {
                for (const [snd_i_str, sndEntry] of Object.entries(patch.sounds)) {
                    const snd_i = Number(snd_i_str);
                    if (snd_i >= sounds.length)
                        sounds.length = snd_i + 1;
                    if (sndEntry === null) {
                        sounds[snd_i] = null;
                        continue;
                    }
                    const existingSnd = (srcAGI.sounds[snd_i]?.type === 'raw-resource') ? srcAGI.sounds[snd_i].data : new Uint8Array(0);
                    sounds[snd_i] = {
                        type: 'raw-resource',
                        resourceType: 'sound',
                        data: sndEntry.data ? applyDiff(existingSnd, bytepool, sndEntry.data) : existingSnd,
                        wasCompressed: false,
                        volNumber: sndEntry.volNumber ?? srcAGI.sounds[snd_i]?.volNumber ?? 0,
                    };
                }
            }
            if (patch.views) {
                for (const [view_i_str, viewEntry] of Object.entries(patch.views)) {
                    const view_i = Number(view_i_str);
                    if (view_i >= views.length)
                        views.length = view_i + 1;
                    if (viewEntry == null) {
                        views[view_i] = null;
                        continue;
                    }
                    const existingView = (srcAGI.views[view_i]?.type === 'view') ? srcAGI.views[view_i] : null;
                    const existingSignature = existingView ? existingView.signature : 0x0101;
                    const loops = existingView ? existingView.loops.slice() : [];
                    for (const [loop_i_str, loopEntry] of Object.entries(viewEntry.loops || {})) {
                        const loop_i = Number(loop_i_str);
                        if (loop_i >= loops.length)
                            loops.length = loop_i + 1;
                        if (loopEntry === null) {
                            loops[loop_i] = null;
                        }
                        else {
                            const cels = loops[loop_i] ? loops[loop_i].cels.slice() : [];
                            for (const [cel_i_str, celEntry] of Object.entries(loopEntry.cels)) {
                                const cel_i = Number(cel_i_str);
                                if (cel_i >= cels.length) {
                                    cels.length = cel_i + 1;
                                }
                                if (celEntry == null) {
                                    cels[cel_i] = null;
                                    continue;
                                }
                                if (!cels[cel_i]) {
                                    if (typeof celEntry.width !== 'number' || typeof celEntry.height !== 'number' || typeof celEntry.transparencyColor !== 'number') {
                                        throw new Error('insufficient data for cel');
                                    }
                                    cels[cel_i] = {
                                        width: celEntry.width,
                                        height: celEntry.height,
                                        transparencyColor: celEntry.transparencyColor,
                                        pixelData: applyDiff(new Uint8Array(0), bytepool, celEntry.pixelData),
                                    };
                                }
                                else {
                                    let srcPixels = cels[cel_i].pixelData;
                                    const celWidth = celEntry.width ?? cels[cel_i].width;
                                    const celHeight = celEntry.height ?? cels[cel_i].height;
                                    if (celWidth !== cels[cel_i].width || celHeight !== cels[cel_i].height) {
                                        srcPixels = new Uint8Array(celWidth * celHeight);
                                        srcPixels.fill(cels[cel_i].transparencyColor);
                                        for (let y = 0; y < Math.min(celHeight, cels[cel_i].height); y++) {
                                            srcPixels.set(cels[cel_i].pixelData.subarray(y * cels[cel_i].width, (y + 1) * cels[cel_i].width), y * celWidth);
                                        }
                                    }
                                    cels[cel_i] = {
                                        width: celWidth,
                                        height: celHeight,
                                        transparencyColor: celEntry.transparencyColor ?? cels[cel_i].transparencyColor,
                                        pixelData: applyDiff(srcPixels, bytepool, celEntry.pixelData),
                                    };
                                }
                            }
                            while (cels.length > 0 && cels[cels.length - 1] == null) {
                                cels.length--;
                            }
                            if (cels.some(v => v == null))
                                throw new Error('gap in cels');
                            loops[loop_i] = { cels: cels };
                        }
                    }
                    while (loops.length > 0 && loops[loops.length - 1] == null) {
                        loops.length--;
                    }
                    if (loops.some(v => v == null))
                        throw new Error('gap in loops');
                    views[view_i] = {
                        type: 'view',
                        signature: viewEntry.signature == null ? existingSignature : viewEntry.signature,
                        loops: loops,
                        volNumber: viewEntry.volNumber ?? existingView?.volNumber ?? 0,
                    };
                }
            }
            if (patch.words) {
                for (const [word, id] of Object.entries(patch.words)) {
                    if (id == null) {
                        words.words.delete(word);
                    }
                    else {
                        words.words.set(word, id);
                    }
                }
            }
            const newAGI = {
                logic,
                objects,
                packedDirs,
                pictures,
                sounds,
                views,
                words,
            };
            const finalHash = agiHash(newAGI);
            if (finalHash !== parseInt(patch.hashPatched, 16)) {
                throw new Error('hash check failed');
            }
            return newAGI;
        }
        throw new Error('no matching patch found');
    }

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

    var extendStatics = function(d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };

    function __extends(d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    }

    function __values(o) {
        var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
        if (m) return m.call(o);
        if (o && typeof o.length === "number") return {
            next: function () {
                if (o && i >= o.length) o = void 0;
                return { value: o && o[i++], done: !o };
            }
        };
        throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
    }

    function __read(o, n) {
        var m = typeof Symbol === "function" && o[Symbol.iterator];
        if (!m) return o;
        var i = m.call(o), r, ar = [], e;
        try {
            while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
        }
        catch (error) { e = { error: error }; }
        finally {
            try {
                if (r && !r.done && (m = i["return"])) m.call(i);
            }
            finally { if (e) throw e.error; }
        }
        return ar;
    }

    function __spreadArray(to, from, pack) {
        if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
            if (ar || !(i in from)) {
                if (!ar) ar = Array.prototype.slice.call(from, 0, i);
                ar[i] = from[i];
            }
        }
        return to.concat(ar || Array.prototype.slice.call(from));
    }

    typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
        var e = new Error(message);
        return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
    };

    function isFunction(value) {
        return typeof value === 'function';
    }

    function createErrorClass(createImpl) {
        var _super = function (instance) {
            Error.call(instance);
            instance.stack = new Error().stack;
        };
        var ctorFunc = createImpl(_super);
        ctorFunc.prototype = Object.create(Error.prototype);
        ctorFunc.prototype.constructor = ctorFunc;
        return ctorFunc;
    }

    var UnsubscriptionError = createErrorClass(function (_super) {
        return function UnsubscriptionErrorImpl(errors) {
            _super(this);
            this.message = errors
                ? errors.length + " errors occurred during unsubscription:\n" + errors.map(function (err, i) { return i + 1 + ") " + err.toString(); }).join('\n  ')
                : '';
            this.name = 'UnsubscriptionError';
            this.errors = errors;
        };
    });

    function arrRemove(arr, item) {
        if (arr) {
            var index = arr.indexOf(item);
            0 <= index && arr.splice(index, 1);
        }
    }

    var Subscription = (function () {
        function Subscription(initialTeardown) {
            this.initialTeardown = initialTeardown;
            this.closed = false;
            this._parentage = null;
            this._finalizers = null;
        }
        Subscription.prototype.unsubscribe = function () {
            var e_1, _a, e_2, _b;
            var errors;
            if (!this.closed) {
                this.closed = true;
                var _parentage = this._parentage;
                if (_parentage) {
                    this._parentage = null;
                    if (Array.isArray(_parentage)) {
                        try {
                            for (var _parentage_1 = __values(_parentage), _parentage_1_1 = _parentage_1.next(); !_parentage_1_1.done; _parentage_1_1 = _parentage_1.next()) {
                                var parent_1 = _parentage_1_1.value;
                                parent_1.remove(this);
                            }
                        }
                        catch (e_1_1) { e_1 = { error: e_1_1 }; }
                        finally {
                            try {
                                if (_parentage_1_1 && !_parentage_1_1.done && (_a = _parentage_1.return)) _a.call(_parentage_1);
                            }
                            finally { if (e_1) throw e_1.error; }
                        }
                    }
                    else {
                        _parentage.remove(this);
                    }
                }
                var initialFinalizer = this.initialTeardown;
                if (isFunction(initialFinalizer)) {
                    try {
                        initialFinalizer();
                    }
                    catch (e) {
                        errors = e instanceof UnsubscriptionError ? e.errors : [e];
                    }
                }
                var _finalizers = this._finalizers;
                if (_finalizers) {
                    this._finalizers = null;
                    try {
                        for (var _finalizers_1 = __values(_finalizers), _finalizers_1_1 = _finalizers_1.next(); !_finalizers_1_1.done; _finalizers_1_1 = _finalizers_1.next()) {
                            var finalizer = _finalizers_1_1.value;
                            try {
                                execFinalizer(finalizer);
                            }
                            catch (err) {
                                errors = errors !== null && errors !== void 0 ? errors : [];
                                if (err instanceof UnsubscriptionError) {
                                    errors = __spreadArray(__spreadArray([], __read(errors)), __read(err.errors));
                                }
                                else {
                                    errors.push(err);
                                }
                            }
                        }
                    }
                    catch (e_2_1) { e_2 = { error: e_2_1 }; }
                    finally {
                        try {
                            if (_finalizers_1_1 && !_finalizers_1_1.done && (_b = _finalizers_1.return)) _b.call(_finalizers_1);
                        }
                        finally { if (e_2) throw e_2.error; }
                    }
                }
                if (errors) {
                    throw new UnsubscriptionError(errors);
                }
            }
        };
        Subscription.prototype.add = function (teardown) {
            var _a;
            if (teardown && teardown !== this) {
                if (this.closed) {
                    execFinalizer(teardown);
                }
                else {
                    if (teardown instanceof Subscription) {
                        if (teardown.closed || teardown._hasParent(this)) {
                            return;
                        }
                        teardown._addParent(this);
                    }
                    (this._finalizers = (_a = this._finalizers) !== null && _a !== void 0 ? _a : []).push(teardown);
                }
            }
        };
        Subscription.prototype._hasParent = function (parent) {
            var _parentage = this._parentage;
            return _parentage === parent || (Array.isArray(_parentage) && _parentage.includes(parent));
        };
        Subscription.prototype._addParent = function (parent) {
            var _parentage = this._parentage;
            this._parentage = Array.isArray(_parentage) ? (_parentage.push(parent), _parentage) : _parentage ? [_parentage, parent] : parent;
        };
        Subscription.prototype._removeParent = function (parent) {
            var _parentage = this._parentage;
            if (_parentage === parent) {
                this._parentage = null;
            }
            else if (Array.isArray(_parentage)) {
                arrRemove(_parentage, parent);
            }
        };
        Subscription.prototype.remove = function (teardown) {
            var _finalizers = this._finalizers;
            _finalizers && arrRemove(_finalizers, teardown);
            if (teardown instanceof Subscription) {
                teardown._removeParent(this);
            }
        };
        Subscription.EMPTY = (function () {
            var empty = new Subscription();
            empty.closed = true;
            return empty;
        })();
        return Subscription;
    }());
    var EMPTY_SUBSCRIPTION = Subscription.EMPTY;
    function isSubscription(value) {
        return (value instanceof Subscription ||
            (value && 'closed' in value && isFunction(value.remove) && isFunction(value.add) && isFunction(value.unsubscribe)));
    }
    function execFinalizer(finalizer) {
        if (isFunction(finalizer)) {
            finalizer();
        }
        else {
            finalizer.unsubscribe();
        }
    }

    var config = {
        onUnhandledError: null,
        onStoppedNotification: null,
        Promise: undefined,
        useDeprecatedSynchronousErrorHandling: false,
        useDeprecatedNextContext: false,
    };

    var timeoutProvider = {
        setTimeout: function (handler, timeout) {
            var args = [];
            for (var _i = 2; _i < arguments.length; _i++) {
                args[_i - 2] = arguments[_i];
            }
            return setTimeout.apply(void 0, __spreadArray([handler, timeout], __read(args)));
        },
        clearTimeout: function (handle) {
            return (clearTimeout)(handle);
        },
        delegate: undefined,
    };

    function reportUnhandledError(err) {
        timeoutProvider.setTimeout(function () {
            {
                throw err;
            }
        });
    }

    function noop() { }

    function errorContext(cb) {
        {
            cb();
        }
    }

    var Subscriber = (function (_super) {
        __extends(Subscriber, _super);
        function Subscriber(destination) {
            var _this = _super.call(this) || this;
            _this.isStopped = false;
            if (destination) {
                _this.destination = destination;
                if (isSubscription(destination)) {
                    destination.add(_this);
                }
            }
            else {
                _this.destination = EMPTY_OBSERVER;
            }
            return _this;
        }
        Subscriber.create = function (next, error, complete) {
            return new SafeSubscriber(next, error, complete);
        };
        Subscriber.prototype.next = function (value) {
            if (this.isStopped) ;
            else {
                this._next(value);
            }
        };
        Subscriber.prototype.error = function (err) {
            if (this.isStopped) ;
            else {
                this.isStopped = true;
                this._error(err);
            }
        };
        Subscriber.prototype.complete = function () {
            if (this.isStopped) ;
            else {
                this.isStopped = true;
                this._complete();
            }
        };
        Subscriber.prototype.unsubscribe = function () {
            if (!this.closed) {
                this.isStopped = true;
                _super.prototype.unsubscribe.call(this);
                this.destination = null;
            }
        };
        Subscriber.prototype._next = function (value) {
            this.destination.next(value);
        };
        Subscriber.prototype._error = function (err) {
            try {
                this.destination.error(err);
            }
            finally {
                this.unsubscribe();
            }
        };
        Subscriber.prototype._complete = function () {
            try {
                this.destination.complete();
            }
            finally {
                this.unsubscribe();
            }
        };
        return Subscriber;
    }(Subscription));
    var ConsumerObserver = (function () {
        function ConsumerObserver(partialObserver) {
            this.partialObserver = partialObserver;
        }
        ConsumerObserver.prototype.next = function (value) {
            var partialObserver = this.partialObserver;
            if (partialObserver.next) {
                try {
                    partialObserver.next(value);
                }
                catch (error) {
                    handleUnhandledError(error);
                }
            }
        };
        ConsumerObserver.prototype.error = function (err) {
            var partialObserver = this.partialObserver;
            if (partialObserver.error) {
                try {
                    partialObserver.error(err);
                }
                catch (error) {
                    handleUnhandledError(error);
                }
            }
            else {
                handleUnhandledError(err);
            }
        };
        ConsumerObserver.prototype.complete = function () {
            var partialObserver = this.partialObserver;
            if (partialObserver.complete) {
                try {
                    partialObserver.complete();
                }
                catch (error) {
                    handleUnhandledError(error);
                }
            }
        };
        return ConsumerObserver;
    }());
    var SafeSubscriber = (function (_super) {
        __extends(SafeSubscriber, _super);
        function SafeSubscriber(observerOrNext, error, complete) {
            var _this = _super.call(this) || this;
            var partialObserver;
            if (isFunction(observerOrNext) || !observerOrNext) {
                partialObserver = {
                    next: (observerOrNext !== null && observerOrNext !== void 0 ? observerOrNext : undefined),
                    error: error !== null && error !== void 0 ? error : undefined,
                    complete: complete !== null && complete !== void 0 ? complete : undefined,
                };
            }
            else {
                {
                    partialObserver = observerOrNext;
                }
            }
            _this.destination = new ConsumerObserver(partialObserver);
            return _this;
        }
        return SafeSubscriber;
    }(Subscriber));
    function handleUnhandledError(error) {
        {
            reportUnhandledError(error);
        }
    }
    function defaultErrorHandler(err) {
        throw err;
    }
    var EMPTY_OBSERVER = {
        closed: true,
        next: noop,
        error: defaultErrorHandler,
        complete: noop,
    };

    var observable = (function () { return (typeof Symbol === 'function' && Symbol.observable) || '@@observable'; })();

    function identity(x) {
        return x;
    }

    function pipeFromArray(fns) {
        if (fns.length === 0) {
            return identity;
        }
        if (fns.length === 1) {
            return fns[0];
        }
        return function piped(input) {
            return fns.reduce(function (prev, fn) { return fn(prev); }, input);
        };
    }

    var Observable = (function () {
        function Observable(subscribe) {
            if (subscribe) {
                this._subscribe = subscribe;
            }
        }
        Observable.prototype.lift = function (operator) {
            var observable = new Observable();
            observable.source = this;
            observable.operator = operator;
            return observable;
        };
        Observable.prototype.subscribe = function (observerOrNext, error, complete) {
            var _this = this;
            var subscriber = isSubscriber(observerOrNext) ? observerOrNext : new SafeSubscriber(observerOrNext, error, complete);
            errorContext(function () {
                var _a = _this, operator = _a.operator, source = _a.source;
                subscriber.add(operator
                    ?
                        operator.call(subscriber, source)
                    : source
                        ?
                            _this._subscribe(subscriber)
                        :
                            _this._trySubscribe(subscriber));
            });
            return subscriber;
        };
        Observable.prototype._trySubscribe = function (sink) {
            try {
                return this._subscribe(sink);
            }
            catch (err) {
                sink.error(err);
            }
        };
        Observable.prototype.forEach = function (next, promiseCtor) {
            var _this = this;
            promiseCtor = getPromiseCtor(promiseCtor);
            return new promiseCtor(function (resolve, reject) {
                var subscriber = new SafeSubscriber({
                    next: function (value) {
                        try {
                            next(value);
                        }
                        catch (err) {
                            reject(err);
                            subscriber.unsubscribe();
                        }
                    },
                    error: reject,
                    complete: resolve,
                });
                _this.subscribe(subscriber);
            });
        };
        Observable.prototype._subscribe = function (subscriber) {
            var _a;
            return (_a = this.source) === null || _a === void 0 ? void 0 : _a.subscribe(subscriber);
        };
        Observable.prototype[observable] = function () {
            return this;
        };
        Observable.prototype.pipe = function () {
            var operations = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                operations[_i] = arguments[_i];
            }
            return pipeFromArray(operations)(this);
        };
        Observable.prototype.toPromise = function (promiseCtor) {
            var _this = this;
            promiseCtor = getPromiseCtor(promiseCtor);
            return new promiseCtor(function (resolve, reject) {
                var value;
                _this.subscribe(function (x) { return (value = x); }, function (err) { return reject(err); }, function () { return resolve(value); });
            });
        };
        Observable.create = function (subscribe) {
            return new Observable(subscribe);
        };
        return Observable;
    }());
    function getPromiseCtor(promiseCtor) {
        var _a;
        return (_a = promiseCtor !== null && promiseCtor !== void 0 ? promiseCtor : config.Promise) !== null && _a !== void 0 ? _a : Promise;
    }
    function isObserver(value) {
        return value && isFunction(value.next) && isFunction(value.error) && isFunction(value.complete);
    }
    function isSubscriber(value) {
        return (value && value instanceof Subscriber) || (isObserver(value) && isSubscription(value));
    }

    var ObjectUnsubscribedError = createErrorClass(function (_super) {
        return function ObjectUnsubscribedErrorImpl() {
            _super(this);
            this.name = 'ObjectUnsubscribedError';
            this.message = 'object unsubscribed';
        };
    });

    var Subject = (function (_super) {
        __extends(Subject, _super);
        function Subject() {
            var _this = _super.call(this) || this;
            _this.closed = false;
            _this.currentObservers = null;
            _this.observers = [];
            _this.isStopped = false;
            _this.hasError = false;
            _this.thrownError = null;
            return _this;
        }
        Subject.prototype.lift = function (operator) {
            var subject = new AnonymousSubject(this, this);
            subject.operator = operator;
            return subject;
        };
        Subject.prototype._throwIfClosed = function () {
            if (this.closed) {
                throw new ObjectUnsubscribedError();
            }
        };
        Subject.prototype.next = function (value) {
            var _this = this;
            errorContext(function () {
                var e_1, _a;
                _this._throwIfClosed();
                if (!_this.isStopped) {
                    if (!_this.currentObservers) {
                        _this.currentObservers = Array.from(_this.observers);
                    }
                    try {
                        for (var _b = __values(_this.currentObservers), _c = _b.next(); !_c.done; _c = _b.next()) {
                            var observer = _c.value;
                            observer.next(value);
                        }
                    }
                    catch (e_1_1) { e_1 = { error: e_1_1 }; }
                    finally {
                        try {
                            if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
                        }
                        finally { if (e_1) throw e_1.error; }
                    }
                }
            });
        };
        Subject.prototype.error = function (err) {
            var _this = this;
            errorContext(function () {
                _this._throwIfClosed();
                if (!_this.isStopped) {
                    _this.hasError = _this.isStopped = true;
                    _this.thrownError = err;
                    var observers = _this.observers;
                    while (observers.length) {
                        observers.shift().error(err);
                    }
                }
            });
        };
        Subject.prototype.complete = function () {
            var _this = this;
            errorContext(function () {
                _this._throwIfClosed();
                if (!_this.isStopped) {
                    _this.isStopped = true;
                    var observers = _this.observers;
                    while (observers.length) {
                        observers.shift().complete();
                    }
                }
            });
        };
        Subject.prototype.unsubscribe = function () {
            this.isStopped = this.closed = true;
            this.observers = this.currentObservers = null;
        };
        Object.defineProperty(Subject.prototype, "observed", {
            get: function () {
                var _a;
                return ((_a = this.observers) === null || _a === void 0 ? void 0 : _a.length) > 0;
            },
            enumerable: false,
            configurable: true
        });
        Subject.prototype._trySubscribe = function (subscriber) {
            this._throwIfClosed();
            return _super.prototype._trySubscribe.call(this, subscriber);
        };
        Subject.prototype._subscribe = function (subscriber) {
            this._throwIfClosed();
            this._checkFinalizedStatuses(subscriber);
            return this._innerSubscribe(subscriber);
        };
        Subject.prototype._innerSubscribe = function (subscriber) {
            var _this = this;
            var _a = this, hasError = _a.hasError, isStopped = _a.isStopped, observers = _a.observers;
            if (hasError || isStopped) {
                return EMPTY_SUBSCRIPTION;
            }
            this.currentObservers = null;
            observers.push(subscriber);
            return new Subscription(function () {
                _this.currentObservers = null;
                arrRemove(observers, subscriber);
            });
        };
        Subject.prototype._checkFinalizedStatuses = function (subscriber) {
            var _a = this, hasError = _a.hasError, thrownError = _a.thrownError, isStopped = _a.isStopped;
            if (hasError) {
                subscriber.error(thrownError);
            }
            else if (isStopped) {
                subscriber.complete();
            }
        };
        Subject.prototype.asObservable = function () {
            var observable = new Observable();
            observable.source = this;
            return observable;
        };
        Subject.create = function (destination, source) {
            return new AnonymousSubject(destination, source);
        };
        return Subject;
    }(Observable));
    var AnonymousSubject = (function (_super) {
        __extends(AnonymousSubject, _super);
        function AnonymousSubject(destination, source) {
            var _this = _super.call(this) || this;
            _this.destination = destination;
            _this.source = source;
            return _this;
        }
        AnonymousSubject.prototype.next = function (value) {
            var _a, _b;
            (_b = (_a = this.destination) === null || _a === void 0 ? void 0 : _a.next) === null || _b === void 0 ? void 0 : _b.call(_a, value);
        };
        AnonymousSubject.prototype.error = function (err) {
            var _a, _b;
            (_b = (_a = this.destination) === null || _a === void 0 ? void 0 : _a.error) === null || _b === void 0 ? void 0 : _b.call(_a, err);
        };
        AnonymousSubject.prototype.complete = function () {
            var _a, _b;
            (_b = (_a = this.destination) === null || _a === void 0 ? void 0 : _a.complete) === null || _b === void 0 ? void 0 : _b.call(_a);
        };
        AnonymousSubject.prototype._subscribe = function (subscriber) {
            var _a, _b;
            return (_b = (_a = this.source) === null || _a === void 0 ? void 0 : _a.subscribe(subscriber)) !== null && _b !== void 0 ? _b : EMPTY_SUBSCRIPTION;
        };
        return AnonymousSubject;
    }(Subject));

    const findSortedIndex = (array, value, compare) => {
        let low = 0;
        let high = array.length - 1;
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const cmp = compare(value, array[mid]);
            if (cmp > 0)
                low = mid + 1;
            else if (cmp < 0)
                high = mid - 1;
            else
                return mid;
        }
        return ~low;
    };
    const normalizeForNaturalSort = (a) => a.replace(/\d+/g, v => {
        v = v.replace(/^0+/, '') || '0';
        const lenPrefix = '9'.repeat(Math.floor(v.length / 9)) + String(v.length % 9);
        return lenPrefix + ':' + v;
    });
    const compareFilenames = (a, b) => {
        if (a === b)
            return 0;
        a = a.toUpperCase();
        b = b.toUpperCase();
        if (a === b)
            return 0;
        const a2 = normalizeForNaturalSort(a);
        const b2 = normalizeForNaturalSort(b);
        if (a2 !== b2) {
            a = a2;
            b = b2;
        }
        return (a < b) ? -1 : 1;
    };
    class VFSVolume {
        constructor(rootLastModified = Date.now()) {
            this.root = new VFSDirectory(this, null, '', rootLastModified);
        }
        root;
        static encodePathToString(parts) {
            return parts.map(v => {
                v = encodeURIComponent(v);
                if (v === '.')
                    return '%2E';
                if (v === '..')
                    return '%2E%2E';
                return v.replace(/\*/g, '%2A');
            }).join('/');
        }
        static decodePathFromString(path) {
            return path.split(/\//g).map(v => decodeURIComponent(v));
        }
        events = new Subject();
    }
    class VFSDirectoryEntry {
        volume;
        name;
        lastModified;
        constructor(volume, parentDirectory, name, lastModified) {
            this.volume = volume;
            this.name = name;
            this.lastModified = lastModified;
            if (parentDirectory === 'root') {
                if (this instanceof VFSDirectory) {
                    this.parentDirectory = this;
                }
                else {
                    throw new Error('root must be a directory');
                }
            }
            else {
                this.parentDirectory = parentDirectory;
            }
        }
        parentDirectory;
        getPath() {
            const path = [];
            for (let ancestor = this; ancestor !== ancestor.parentDirectory; ancestor = ancestor.parentDirectory) {
                path.unshift(ancestor.name);
            }
            return path;
        }
        _meta = new Map();
        meta(name, init) {
            if (this._meta.has(name)) {
                return this._meta.get(name);
            }
            else {
                const meta = init(this);
                this._meta.set(name, meta);
                return meta;
            }
        }
    }
    class VFSDirectory extends VFSDirectoryEntry {
        constructor(volume, parentDirectory, name, lastModified) {
            super(volume, parentDirectory || 'root', name, lastModified == null ? undefined : Number(lastModified));
        }
        _entries = [];
        *[Symbol.iterator]() {
            for (const entry of this._entries) {
                yield [entry.name, entry];
            }
        }
        entries() {
            return this._entries.values();
        }
        *entryNames() {
            for (const entry of this._entries) {
                yield entry.name;
            }
        }
        resolve(relativePath) {
            let path;
            if (relativePath.startsWith('/')) {
                path = [];
                relativePath = relativePath.slice(1);
            }
            else {
                path = this.getPath();
            }
            const split = relativePath.split(/\//g);
            for (let i = 0; i < split.length; i++) {
                if (split[i] === '.')
                    continue;
                if (split[i] === '..')
                    path.pop();
                path.push(decodeURIComponent(split[i]));
            }
            return path;
        }
        getEntry(name) {
            const idx = findSortedIndex(this._entries, name, (name, entry) => compareFilenames(name, entry.name));
            if (idx < 0)
                return null;
            return this._entries[idx];
        }
        getFile(name) {
            const entry = this.getEntry(name);
            return (entry instanceof VFSFile) ? entry : null;
        }
        getFolder(name) {
            const entry = this.getEntry(name);
            return (entry instanceof VFSDirectory) ? entry : null;
        }
        *eachEntry(glob = '*') {
            if (glob === '*') {
                yield* this._entries;
                return;
            }
            let dirs;
            if (glob.startsWith('/')) {
                dirs = [this.volume.root];
                glob = glob.slice(1);
            }
            else {
                dirs = [this];
            }
            const parts = glob.split(/\//g);
            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                let nextDirs;
                if (part === '**') {
                    const set = new Set();
                    function recurse(dir) {
                        if (set.has(dir))
                            return;
                        set.add(dir);
                        for (const subdir of dir.eachDirectory()) {
                            recurse(subdir);
                        }
                    }
                    for (const dir of dirs) {
                        recurse(dir);
                    }
                    nextDirs = [...set];
                }
                else if (part === '.') {
                    nextDirs = dirs;
                }
                else if (part === '..') {
                    const set = new Set();
                    for (const dir of dirs) {
                        set.add(dir.parentDirectory);
                    }
                    nextDirs = [...set];
                }
                else if (/^\*+$/.test(part)) {
                    nextDirs = [];
                    for (const dir of dirs) {
                        for (const subdir of dir.eachDirectory()) {
                            nextDirs.push(subdir);
                        }
                    }
                }
                else {
                    const starParts = part.split(/\*+/g);
                    nextDirs = [];
                    if (starParts.length !== 1) {
                        const regex = new RegExp('^' + starParts.map(v => decodeURIComponent(v).replace(/([\[\]\*\.\?\{\}\/\\\(\)\^\$])/g, '\\$1')).join('.*') + '$', 'i');
                        for (const dir of dirs) {
                            for (const subdir of dir.eachDirectory()) {
                                if (regex.test(subdir.name))
                                    nextDirs.push(subdir);
                            }
                        }
                    }
                    else {
                        const name = decodeURIComponent(part);
                        for (const dir of dirs) {
                            const subdir = dir.getFolder(name);
                            if (subdir)
                                nextDirs.push(subdir);
                        }
                    }
                }
                if (nextDirs.length === 0)
                    return;
                dirs = nextDirs;
            }
            const lastPart = parts[parts.length - 1];
            if (lastPart === '**') {
                function* recurse(dir) {
                    for (const entry of dir.entries()) {
                        yield entry;
                        if (entry.isDirectory())
                            yield* recurse(entry);
                    }
                }
                for (const dir of dirs) {
                    yield* recurse(dir);
                }
            }
            else if (lastPart === '.') {
                for (const dir of dirs) {
                    yield dir;
                }
            }
            else if (lastPart === '..') {
                const set = new Set();
                for (const dir of dirs) {
                    const parentDir = dir.parentDirectory;
                    if (!set.has(parentDir)) {
                        yield parentDir;
                        set.add(parentDir);
                    }
                }
            }
            else if (/^\*+$/.test(lastPart)) {
                for (const dir of dirs) {
                    yield* dir._entries;
                }
            }
            else {
                const starParts = lastPart.split(/\*+/g);
                if (starParts.length === 1) {
                    const name = decodeURIComponent(lastPart);
                    for (const dir of dirs) {
                        const entry = dir.getEntry(name);
                        if (entry)
                            yield entry;
                    }
                }
                else {
                    const regex = new RegExp('^' + starParts.map(v => decodeURIComponent(v).replace(/([\[\]\*\.\?\{\}\/\\\(\)\^\$])/g, '\\$1')).join('.*') + '$', 'i');
                    for (const dir of dirs) {
                        for (const entry of dir._entries) {
                            if (regex.test(entry.name))
                                yield entry;
                        }
                    }
                }
            }
        }
        *eachFile(glob = '*') {
            for (const entry of this.eachEntry(glob)) {
                if (entry.isFile())
                    yield entry;
            }
        }
        *eachDirectory(glob = '*') {
            for (const entry of this.eachEntry(glob)) {
                if (entry.isDirectory())
                    yield entry;
            }
        }
        createDirectory(name, lastModified = Date.now()) {
            const subdir = new VFSDirectory(this.volume, this, name, lastModified);
            const idx = findSortedIndex(this._entries, subdir, (a, b) => compareFilenames(a.name, b.name));
            if (idx < 0) {
                this._entries.splice(~idx, 0, subdir);
                this.volume.events.next({ type: 'directory-created', directory: subdir });
            }
            else {
                throw new Error('duplicate entry: ' + name);
            }
            return subdir;
        }
        createFile(name, content, lastModified = Date.now(), contentEncoding = null) {
            const file = new VFSFile(this.volume, this, name, lastModified, content, contentEncoding);
            const idx = findSortedIndex(this._entries, file, (a, b) => compareFilenames(a.name, b.name));
            if (idx < 0) {
                this._entries.splice(~idx, 0, file);
                this.volume.events.next({ type: 'file-created', file });
            }
            else {
                throw new Error('duplicate entry: ' + name);
            }
            return file;
        }
        isFile() { return false; }
        isDirectory() { return true; }
        isArchive() {
            return false;
        }
    }
    const areEncodingsEqual = (a, b) => {
        if (a == null)
            return b == null;
        if (b == null)
            return false;
        return a.encoding === b.encoding && areEncodingsEqual(a.inner, b.inner);
    };
    const encodeContentStream = (contentStream, descriptor) => {
        if (descriptor == null)
            return contentStream;
        switch (descriptor.encoding) {
            case 'deflate':
            case 'deflate-raw':
            case 'gzip': {
                const encoder = new CompressionStream(descriptor.encoding);
                encodeContentStream(contentStream, descriptor.inner).pipeTo(encoder.writable);
                return encoder.readable;
            }
            default: {
                throw new Error('unknown encoding: ' + descriptor.encoding);
            }
        }
    };
    const decodeContentStream = (contentStream, descriptor) => {
        if (descriptor == null)
            return contentStream;
        switch (descriptor.encoding) {
            case 'deflate':
            case 'deflate-raw':
            case 'gzip': {
                const decoder = new DecompressionStream(descriptor.encoding);
                contentStream.pipeTo(decoder.writable);
                return decodeContentStream(decoder.readable, descriptor.inner);
            }
            default: {
                throw new Error('unknown encoding: ' + descriptor.encoding);
            }
        }
    };
    class VFSFile extends VFSDirectoryEntry {
        content;
        contentEncoding;
        constructor(volume, parentDirectory, name, lastModified, content, contentEncoding = null) {
            super(volume, parentDirectory, name, lastModified == null ? undefined : Number(lastModified));
            this.content = content;
            this.contentEncoding = contentEncoding;
        }
        stream(contentEncoding = null) {
            let stream = this.content.stream();
            stream = decodeContentStream(stream, this.contentEncoding);
            stream = encodeContentStream(stream, contentEncoding);
            return stream;
        }
        getContent(contentEncoding = null) {
            if (areEncodingsEqual(contentEncoding, this.contentEncoding)) {
                return Promise.resolve(this.content);
            }
            return new Response(this.stream(contentEncoding)).blob();
        }
        replaceContent(newContent, contentEncoding = null) {
            this.content = newContent;
            this.contentEncoding = contentEncoding;
            this.volume.events.next({ type: 'file-modified', file: this });
        }
        isArchive() {
            return false;
        }
        isFile() { return true; }
        isDirectory() { return false; }
    }

    const CRC32_TABLE = new Uint32Array([
        0x00000000, 0x77073096, 0xee0e612c, 0x990951ba, 0x076dc419, 0x706af48f, 0xe963a535, 0x9e6495a3,
        0x0edb8832, 0x79dcb8a4, 0xe0d5e91e, 0x97d2d988, 0x09b64c2b, 0x7eb17cbd, 0xe7b82d07, 0x90bf1d91,
        0x1db71064, 0x6ab020f2, 0xf3b97148, 0x84be41de, 0x1adad47d, 0x6ddde4eb, 0xf4d4b551, 0x83d385c7,
        0x136c9856, 0x646ba8c0, 0xfd62f97a, 0x8a65c9ec, 0x14015c4f, 0x63066cd9, 0xfa0f3d63, 0x8d080df5,
        0x3b6e20c8, 0x4c69105e, 0xd56041e4, 0xa2677172, 0x3c03e4d1, 0x4b04d447, 0xd20d85fd, 0xa50ab56b,
        0x35b5a8fa, 0x42b2986c, 0xdbbbc9d6, 0xacbcf940, 0x32d86ce3, 0x45df5c75, 0xdcd60dcf, 0xabd13d59,
        0x26d930ac, 0x51de003a, 0xc8d75180, 0xbfd06116, 0x21b4f4b5, 0x56b3c423, 0xcfba9599, 0xb8bda50f,
        0x2802b89e, 0x5f058808, 0xc60cd9b2, 0xb10be924, 0x2f6f7c87, 0x58684c11, 0xc1611dab, 0xb6662d3d,
        0x76dc4190, 0x01db7106, 0x98d220bc, 0xefd5102a, 0x71b18589, 0x06b6b51f, 0x9fbfe4a5, 0xe8b8d433,
        0x7807c9a2, 0x0f00f934, 0x9609a88e, 0xe10e9818, 0x7f6a0dbb, 0x086d3d2d, 0x91646c97, 0xe6635c01,
        0x6b6b51f4, 0x1c6c6162, 0x856530d8, 0xf262004e, 0x6c0695ed, 0x1b01a57b, 0x8208f4c1, 0xf50fc457,
        0x65b0d9c6, 0x12b7e950, 0x8bbeb8ea, 0xfcb9887c, 0x62dd1ddf, 0x15da2d49, 0x8cd37cf3, 0xfbd44c65,
        0x4db26158, 0x3ab551ce, 0xa3bc0074, 0xd4bb30e2, 0x4adfa541, 0x3dd895d7, 0xa4d1c46d, 0xd3d6f4fb,
        0x4369e96a, 0x346ed9fc, 0xad678846, 0xda60b8d0, 0x44042d73, 0x33031de5, 0xaa0a4c5f, 0xdd0d7cc9,
        0x5005713c, 0x270241aa, 0xbe0b1010, 0xc90c2086, 0x5768b525, 0x206f85b3, 0xb966d409, 0xce61e49f,
        0x5edef90e, 0x29d9c998, 0xb0d09822, 0xc7d7a8b4, 0x59b33d17, 0x2eb40d81, 0xb7bd5c3b, 0xc0ba6cad,
        0xedb88320, 0x9abfb3b6, 0x03b6e20c, 0x74b1d29a, 0xead54739, 0x9dd277af, 0x04db2615, 0x73dc1683,
        0xe3630b12, 0x94643b84, 0x0d6d6a3e, 0x7a6a5aa8, 0xe40ecf0b, 0x9309ff9d, 0x0a00ae27, 0x7d079eb1,
        0xf00f9344, 0x8708a3d2, 0x1e01f268, 0x6906c2fe, 0xf762575d, 0x806567cb, 0x196c3671, 0x6e6b06e7,
        0xfed41b76, 0x89d32be0, 0x10da7a5a, 0x67dd4acc, 0xf9b9df6f, 0x8ebeeff9, 0x17b7be43, 0x60b08ed5,
        0xd6d6a3e8, 0xa1d1937e, 0x38d8c2c4, 0x4fdff252, 0xd1bb67f1, 0xa6bc5767, 0x3fb506dd, 0x48b2364b,
        0xd80d2bda, 0xaf0a1b4c, 0x36034af6, 0x41047a60, 0xdf60efc3, 0xa867df55, 0x316e8eef, 0x4669be79,
        0xcb61b38c, 0xbc66831a, 0x256fd2a0, 0x5268e236, 0xcc0c7795, 0xbb0b4703, 0x220216b9, 0x5505262f,
        0xc5ba3bbe, 0xb2bd0b28, 0x2bb45a92, 0x5cb36a04, 0xc2d7ffa7, 0xb5d0cf31, 0x2cd99e8b, 0x5bdeae1d,
        0x9b64c2b0, 0xec63f226, 0x756aa39c, 0x026d930a, 0x9c0906a9, 0xeb0e363f, 0x72076785, 0x05005713,
        0x95bf4a82, 0xe2b87a14, 0x7bb12bae, 0x0cb61b38, 0x92d28e9b, 0xe5d5be0d, 0x7cdcefb7, 0x0bdbdf21,
        0x86d3d2d4, 0xf1d4e242, 0x68ddb3f8, 0x1fda836e, 0x81be16cd, 0xf6b9265b, 0x6fb077e1, 0x18b74777,
        0x88085ae6, 0xff0f6a70, 0x66063bca, 0x11010b5c, 0x8f659eff, 0xf862ae69, 0x616bffd3, 0x166ccf45,
        0xa00ae278, 0xd70dd2ee, 0x4e048354, 0x3903b3c2, 0xa7672661, 0xd06016f7, 0x4969474d, 0x3e6e77db,
        0xaed16a4a, 0xd9d65adc, 0x40df0b66, 0x37d83bf0, 0xa9bcae53, 0xdebb9ec5, 0x47b2cf7f, 0x30b5ffe9,
        0xbdbdf21c, 0xcabac28a, 0x53b39330, 0x24b4a3a6, 0xbad03605, 0xcdd70693, 0x54de5729, 0x23d967bf,
        0xb3667a2e, 0xc4614ab8, 0x5d681b02, 0x2a6f2b94, 0xb40bbe37, 0xc30c8ea1, 0x5a05df1b, 0x2d02ef8d,
    ]);
    const CRC32_INITIAL = 0;
    function crc32(bytes, crc = CRC32_INITIAL) {
        crc = ~crc;
        for (let i = 0; i < bytes.length; i++) {
            const idx = (crc ^ bytes[i]) & 0xff;
            crc = CRC32_TABLE[idx] ^ (crc >>> 8);
        }
        return ~crc >>> 0;
    }
    async function crc32FromStream(stream) {
        const reader = stream.getReader();
        let crc = CRC32_INITIAL;
        while (true) {
            const { done, value: bytes } = await reader.read();
            if (done)
                break;
            crc = crc32(bytes, crc);
        }
        return crc;
    }
    const blobCache = new WeakMap();
    function crc32FromBlob(b) {
        if (b.size === 0)
            return Promise.resolve(0);
        const cached = blobCache.get(b);
        if (cached)
            return cached;
        const awaitCrc = crc32FromStream(b.stream());
        blobCache.set(b, awaitCrc);
        return awaitCrc;
    }

    const EOCD_LENGTH = 22;
    const MAX_COMMENT_LENGTH = 0xffff;
    const SUFFIX_LENGTH = EOCD_LENGTH + MAX_COMMENT_LENGTH;
    const EXTRA_UTF8_PATH = 0x7075;
    const FLAG_UTF8 = (1 << 11);
    const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
    const utf8Encoder = new TextEncoder();
    async function readZip(zip) {
        const volume = new VFSVolume(zip.lastModified);
        const suffix = new Uint8Array(await zip.slice(-SUFFIX_LENGTH).arrayBuffer());
        let eocd = null, comment = null;
        for (let i = suffix.length - 22; i >= 0; i -= 4) {
            let start;
            switch (suffix[i]) {
                case 0x06: {
                    start = i - 3;
                    break;
                }
                case 0x05: {
                    start = i - 2;
                    break;
                }
                case 0x4b: {
                    start = i - 1;
                    break;
                }
                case 0x50: {
                    start = i;
                    break;
                }
                default: continue;
            }
            if (String.fromCharCode(suffix[start], suffix[start + 1], suffix[start + 2], suffix[start + 3]) !== 'PK\x05\x06') {
                continue;
            }
            eocd = suffix.subarray(start, start + EOCD_LENGTH);
            comment = suffix.subarray(start + EOCD_LENGTH);
            break;
        }
        if (eocd === null) {
            throw new Error('zip error: EOCD not found');
        }
        const eocdDV = new DataView(eocd.buffer, eocd.byteOffset, eocd.byteLength);
        const diskNumber = eocdDV.getUint16(4, true);
        const cdStartDisk = eocdDV.getUint16(6, true);
        const cdLocalRecordCount = eocdDV.getUint16(8, true);
        const cdGlobalRecordCount = eocdDV.getUint16(10, true);
        const cdByteLength = eocdDV.getUint32(12, true);
        const cdByteOffset = eocdDV.getUint32(16, true);
        const commentByteLength = eocdDV.getUint16(20, true);
        comment = comment || new Uint8Array(0);
        if (commentByteLength !== comment.byteLength) {
            throw new Error('zip error: comment is wrong length');
        }
        if (diskNumber !== 0 || cdStartDisk !== 0 || cdLocalRecordCount !== cdGlobalRecordCount) {
            throw new Error('zip error: multipart zips not supported');
        }
        const getEachEntry = async function* () {
            const centralDirectory = new DataView(await zip.slice(cdByteOffset, cdByteOffset + cdByteLength).arrayBuffer());
            let cdPos = 0;
            while (cdPos < centralDirectory.byteLength) {
                const signature = centralDirectory.getUint32(cdPos, false);
                if (signature !== 0x504B0102) {
                    throw new Error('zip error: invalid central directory record');
                }
                const creatorVersion = centralDirectory.getUint16(cdPos + 4, true);
                const zipSpecVersion = creatorVersion & 0xff;
                const creatingOS = creatorVersion >>> 8;
                const requiredVersion = centralDirectory.getUint16(cdPos + 6, true);
                const flags = centralDirectory.getUint16(cdPos + 8, true);
                const compressionMethod = centralDirectory.getUint16(cdPos + 10, true);
                const lastModTime = centralDirectory.getUint16(cdPos + 12, true);
                const lastModDate = centralDirectory.getUint16(cdPos + 14, true);
                const crc32 = centralDirectory.getUint32(cdPos + 16, true);
                const compressedSize = centralDirectory.getUint32(cdPos + 20, true);
                const uncompressedSize = centralDirectory.getUint32(cdPos + 24, true);
                const fileNameLength = centralDirectory.getUint16(cdPos + 28, true);
                const extraFieldLength = centralDirectory.getUint16(cdPos + 30, true);
                const commentLength = centralDirectory.getUint16(cdPos + 32, true);
                const diskNumber = centralDirectory.getUint16(cdPos + 34, true);
                const internalAttributes = centralDirectory.getUint16(cdPos + 36, true);
                const externalAttributes = centralDirectory.getUint32(cdPos + 38, true);
                const offset = centralDirectory.getUint32(cdPos + 42, true);
                cdPos += 46;
                const fileName = new Uint8Array(centralDirectory.buffer, centralDirectory.byteOffset + cdPos, fileNameLength);
                cdPos += fileName.length;
                const extra = new Uint8Array(centralDirectory.buffer, centralDirectory.byteOffset + cdPos, extraFieldLength);
                cdPos += extra.length;
                const extraRecords = new Array();
                let extraPos = 0;
                while (extraPos < extra.length) {
                    const recordType = extra[extraPos] | (extra[extraPos + 1] << 8);
                    const recordLen = extra[extraPos + 2] | (extra[extraPos + 3] << 8);
                    extraRecords.push({ type: recordType, data: extra.subarray(extraPos + 4, extraPos + 4 + recordLen) });
                    extraPos += 4 + recordLen;
                    if (extraPos > extra.length) {
                        throw new Error('zip error: invalid extra record');
                    }
                }
                const comment = new Uint8Array(centralDirectory.buffer, centralDirectory.byteOffset + cdPos, commentLength);
                cdPos += comment.length;
                const dayOfMonth = lastModDate & 0b11111;
                const month = (lastModDate >>> 5) & 0b1111;
                const year = 1980 + (lastModDate >>> 9);
                const second = (lastModTime & 0b11111) / 2;
                const minute = (lastModTime >>> 5) & 0b111111;
                const hour = (lastModTime >>> 11);
                const lastModified = new Date(year, month - 1, dayOfMonth, hour, minute, second).getDate();
                yield {
                    zipSpecVersion,
                    creatingOS,
                    requiredVersion,
                    flags,
                    compressionMethod,
                    lastModified,
                    crc32,
                    compressedSize,
                    uncompressedSize,
                    internalAttributes,
                    externalAttributes,
                    diskNumber,
                    offset,
                    fileName: bytesToString(fileName, extraRecords, flags),
                    extraRecords,
                    comment: bytesToString(comment, [], flags),
                    content: (async () => {
                        const localRecord = new DataView(await zip.slice(offset, offset + 30).arrayBuffer());
                        const signature = localRecord.getUint32(0, false);
                        if (signature !== 0x504b0304) {
                            throw new Error('zip error: invalid local record');
                        }
                        const fileNameLength = localRecord.getUint16(26, true);
                        const extraLength = localRecord.getUint16(28, true);
                        return zip.slice(offset + 30 + fileNameLength + extraLength, offset + 30 + fileNameLength + extraLength + compressedSize);
                    })(),
                };
            }
        };
        for await (const entry of getEachEntry()) {
            const fullPath = entry.fileName.split(/\//g);
            let dir = volume.root;
            for (let i = 0; i < fullPath.length - 1; i++) {
                const existing = dir.getEntry(fullPath[i]);
                if (!existing) {
                    dir = dir.createDirectory(fullPath[i]);
                }
                else if (existing.isDirectory()) {
                    dir = existing;
                }
                else {
                    throw new Error('both file and directory: ' + fullPath.slice(0, i + 1).join('/'));
                }
            }
            if (fullPath[fullPath.length - 1] !== '') {
                let descriptor;
                switch (entry.compressionMethod) {
                    case 0:
                        descriptor = null;
                        break;
                    case 8:
                        descriptor = { encoding: 'deflate-raw' };
                        break;
                    default: throw new Error('unsupported compression type: ' + entry.compressionMethod);
                }
                dir.createFile(fullPath[fullPath.length - 1], await entry.content, entry.lastModified, descriptor);
            }
        }
        return volume;
    }
    function bytesToString(bytes, extra, flags) {
        const utf8Path = extra.find(v => v.type === EXTRA_UTF8_PATH);
        if (utf8Path) {
            if (utf8Path.data.length > 5 && utf8Path.data[0] <= 1) {
                return utf8Decoder.decode(utf8Path.data.subarray(5));
            }
        }
        if (flags & FLAG_UTF8) {
            return utf8Decoder.decode(bytes);
        }
        return String.fromCharCode.apply(null, bytes);
    }
    function encodeExtra(extra) {
        const extraBytes = new Uint8Array(extra.reduce((total, v) => total + 2 + v.data.length, 0));
        let pos = 0;
        for (let i = 0; i < extra.length; i++) {
            extraBytes[pos++] = extra[i].type & 0xff;
            extraBytes[pos++] = (extra[i].type >> 8) & 0xff;
            extraBytes.set(extra[i].data, pos);
            pos += extra[i].data.length;
        }
        return extraBytes;
    }
    const EMPTY_BLOB = new Blob([]);
    function toDOSTime(timestamp) {
        if (timestamp == null)
            return { date: 0, time: 0 };
        const d = new Date(timestamp);
        const date = (d.getDate() | ((d.getMonth() + 1) << 5) | ((d.getFullYear() - 1980) << 9)) & 0xffff;
        const time = (d.getMilliseconds() >= 500 ? 1 : 0) | (d.getSeconds() << 1) | (d.getMinutes() << 5) | (d.getHours() << 11);
        return { date, time };
    }
    async function writeZipStream(zip, ws) {
        const writer = ws.getWriter();
        try {
            let writtenBytes = 0;
            const centralDirRecords = [];
            for (const entry of zip.root.eachEntry('**')) {
                const localRecordOffset = writtenBytes;
                const path = entry.getPath().join('/') + (entry.isDirectory() ? '/' : '');
                const extra = [];
                const extraBytes = encodeExtra(extra);
                const comment = '';
                let requiredVersion = 10;
                const creatorVersion = 63; // DOS, deflate, UTF-8
                let flags = 0;
                let internalAttributes = 0;
                let externalAttributes = entry.isDirectory() ? (1 << 16) : 0;
                const full = entry.isFile() ? await entry.getContent() : EMPTY_BLOB;
                let compress = (full.size > 5) && !/\.(?:zip|gz|tgz|7z|rar|jpg|jpeg|png|gif|mp4|avi|m4a|mp3|ogg|webp|aac|oga|flac|mkv|webm|mov|wmv|xz|jar|apk|woff|woff2)$/i.test(entry.name);
                if (compress) {
                    requiredVersion = 20;
                }
                const pathIsAscii7Clean = !/[^0x00-0x7f]/.test(path);
                if (!pathIsAscii7Clean) {
                    requiredVersion = 63;
                    flags |= (1 << 11);
                }
                const pathBytes = utf8Encoder.encode(path), commentBytes = utf8Encoder.encode(comment);
                const localHeaderBytes = new Uint8Array(30 + pathBytes.length + extraBytes.length);
                const localHeaderDV = new DataView(localHeaderBytes.buffer);
                const stored = !compress || !entry.isFile() ? full : await entry.getContent({ encoding: 'deflate-raw' });
                const crc32 = await crc32FromBlob(full);
                const { date, time } = toDOSTime(entry.lastModified);
                localHeaderDV.setUint32(0, 0x504b0304, false);
                localHeaderDV.setUint16(4, requiredVersion, true);
                localHeaderDV.setUint16(6, flags, true);
                localHeaderDV.setUint16(8, compress ? 8 : 0, true);
                localHeaderDV.setUint16(10, time, true);
                localHeaderDV.setUint16(12, date, true);
                localHeaderDV.setUint32(14, crc32, true);
                localHeaderDV.setUint32(18, stored.size, true);
                localHeaderDV.setUint32(22, full.size, true);
                localHeaderDV.setUint16(26, pathBytes.length, true);
                localHeaderDV.setUint16(28, extraBytes.length, true);
                localHeaderBytes.set(pathBytes, 30);
                localHeaderBytes.set(extraBytes, 30 + pathBytes.length);
                await writer.ready;
                await writer.write(localHeaderBytes);
                writtenBytes += localHeaderBytes.length;
                if (stored.size > 0) {
                    const rs = stored.stream();
                    const reader = rs.getReader();
                    try {
                        for (;;) {
                            const { done, value } = await reader.read();
                            if (done)
                                break;
                            await writer.ready;
                            await writer.write(value);
                        }
                    }
                    finally {
                        reader.releaseLock();
                    }
                    writtenBytes += stored.size;
                }
                const centralHeaderBytes = new Uint8Array(46 + pathBytes.length + extraBytes.length + commentBytes.length);
                const centralHeaderDV = new DataView(centralHeaderBytes.buffer);
                centralHeaderDV.setUint32(0, 0x504b0102, false);
                centralHeaderDV.setUint16(4, creatorVersion, true);
                centralHeaderDV.setUint16(6, requiredVersion, true);
                centralHeaderDV.setUint16(8, flags, true);
                centralHeaderDV.setUint16(10, compress ? 8 : 0, true);
                centralHeaderDV.setUint16(12, time, true);
                centralHeaderDV.setUint16(14, date, true);
                centralHeaderDV.setUint32(16, crc32, true);
                centralHeaderDV.setUint32(20, stored.size, true);
                centralHeaderDV.setUint32(24, full.size, true);
                centralHeaderDV.setUint16(28, pathBytes.length, true);
                centralHeaderDV.setUint16(30, extraBytes.length, true);
                centralHeaderDV.setUint16(32, commentBytes.length, true);
                centralHeaderDV.setUint16(36, internalAttributes, true);
                centralHeaderDV.setUint32(38, externalAttributes, true);
                centralHeaderDV.setUint32(42, localRecordOffset, true);
                centralHeaderBytes.set(pathBytes, 46);
                centralHeaderBytes.set(extraBytes, 46 + pathBytes.length);
                centralHeaderBytes.set(commentBytes, 46 + pathBytes.length + extraBytes.length);
                centralDirRecords.push(centralHeaderBytes);
            }
            const centralDirOffset = writtenBytes;
            for (const record of centralDirRecords) {
                await writer.ready;
                await writer.write(record);
                writtenBytes += record.byteLength;
            }
            const centralDirLength = writtenBytes - centralDirOffset;
            const eocd = new DataView(new ArrayBuffer(22));
            eocd.setUint32(0, 0x504b0506, false);
            eocd.setUint16(4, 0, true); // number of this disk
            eocd.setUint16(6, 0, true); // disk where central directory starts
            eocd.setUint16(8, centralDirRecords.length, true);
            eocd.setUint16(10, centralDirRecords.length, true);
            eocd.setUint32(12, centralDirLength, true);
            eocd.setUint32(16, centralDirOffset, true);
            eocd.setUint16(20, 0, true); // comment length
            await writer.ready;
            await writer.write(new Uint8Array(eocd.buffer));
        }
        finally {
            writer.releaseLock();
        }
    }

    function getTabContext(el) {
        for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
            if (ancestor.hasAttribute('data-tab-context'))
                return ancestor;
        }
        return null;
    }
    window.addEventListener('DOMContentLoaded', function () {
        const messageBox = document.querySelector('dialog.message-box');
        const messageBoxText = messageBox.querySelector('p');
        const showMessage = (message) => {
            messageBoxText.textContent = message;
            messageBox.showModal();
        };
        try {
            let patchFile = null;
            const setPatchFile = (pf) => {
                window.dispatchEvent(new CustomEvent('patch-file', { detail: { file: pf } }));
                patchFile = pf;
            };
            document.querySelectorAll('.patch-section').forEach(patchSection => {
                patchSection.querySelectorAll('.select-list').forEach(patchList => {
                    patchList.addEventListener('click', async (e) => {
                        if (patchList.classList.contains('loading'))
                            return;
                        const targetElement = e.target;
                        const url = targetElement.dataset.url;
                        if (url) {
                            const absoluteUrl = new URL(url, document.baseURI);
                            patchList.classList.add('loading');
                            try {
                                const response = await fetch(url);
                                if (!response.ok)
                                    throw new Error('Failed to load ' + absoluteUrl.toString());
                                const blob = await response.blob();
                                const file = new File([blob], absoluteUrl.pathname.match(/[^\/]*$/)[0] || 'unknown.dat');
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
                patchSection.querySelectorAll('.dropzone[data-file-is=patch-file]').forEach(el => {
                    el.addEventListener('file-drop', ({ detail: { file } }) => {
                        setPatchFile(file);
                    });
                });
                window.addEventListener('patch-file', ({ detail: { file } }) => {
                    patchSection.classList.toggle('patch-selected', file != null);
                    if (file)
                        patchSection.querySelectorAll('.patch-filename').forEach(filenameHolder => {
                            filenameHolder.textContent = file.name;
                        });
                });
                patchSection.querySelectorAll('[data-action=cancel-selected-patch]').forEach(btn => {
                    btn.onclick = () => {
                        setPatchFile(null);
                    };
                });
            });
            document.querySelectorAll('[data-tab]').forEach(tab => {
                clickOnDragHover(tab);
            });
            document.querySelectorAll('[data-tab-context]').forEach(tabContext => {
                tabContext.addEventListener('click', e => {
                    const targetEl = e.target;
                    if (targetEl.hasAttribute('data-tab')) {
                        e.stopPropagation();
                        tabContext.querySelectorAll('[data-tab]').forEach(tabButton => {
                            if (getTabContext(tabButton) !== tabContext)
                                return;
                            tabButton.classList.toggle('active', tabButton.dataset.tab === targetEl.dataset.tab);
                        });
                        tabContext.querySelectorAll('[data-tab-content]').forEach(tabContent => {
                            if (getTabContext(tabContent) !== tabContext)
                                return;
                            tabContent.classList.toggle('active', tabContent.dataset.tabContent === targetEl.dataset.tab);
                        });
                    }
                });
            });
            document.querySelectorAll('[data-action=create-patch]').forEach(el => {
                el.onclick = async () => {
                    const fromVolume = document.querySelector('[data-volume=original-files]')?.volume;
                    const toVolume = document.querySelector('[data-volume=modified-files]')?.volume;
                    if (fromVolume && toVolume) {
                        async function getAllAGIs(rootVolume) {
                            const allFromVolumes = await Promise.all([...rootVolume.root.eachFile('**/*.zip')]
                                .map(file => file.getContent().then(readZip)));
                            allFromVolumes.unshift(rootVolume);
                            const agis = [];
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
                        const zipChunks = [];
                        const ws = new WritableStream({
                            write(chunk) {
                                zipChunks.push(chunk);
                            },
                        });
                        await writeZipStream(patchVolume, ws);
                        const zipBlob = new Blob(zipChunks, { type: 'application/zip' });
                        const link = document.createElement('a');
                        link.href = URL.createObjectURL(zipBlob);
                        link.download = 'patch.sapp';
                        link.text = 'Download SAPP Patch File';
                        el.parentElement.insertAdjacentElement('afterend', link);
                        showMessage('Patch created successfully');
                    }
                };
            });
            async function addVolumeToElement(volume, targetVolumeContainer) {
                targetVolumeContainer.volume = volume;
                const entryToElement = new Map();
                entryToElement.set(volume.root, targetVolumeContainer);
                async function createDir(dir) {
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
                async function createFile(file) {
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
                volume.events.subscribe(async (e) => {
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
            document.querySelectorAll('.dropzone').forEach(dropzone => {
                const targetVolume = dropzone.dataset.targetVolume;
                if (targetVolume) {
                    const targetVolumeContainer = document.querySelector('[data-volume="' + targetVolume + '"]');
                    if (targetVolumeContainer) {
                        const volume = new VFSVolume();
                        addVolumeToElement(volume, targetVolumeContainer);
                        dropzone.addEventListener('files-drop', ({ detail: { files } }) => {
                            function processEntry(dir, fm) {
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
            document.querySelectorAll('[data-action=apply-patch]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (!patchFile) {
                        showMessage('No patch file selected');
                        return;
                    }
                    const fromVolume = document.querySelector('[data-volume=files-to-patch]')?.volume;
                    if (!fromVolume) {
                        showMessage('No files to patch!');
                        return;
                    }
                    async function getAllAGIs(rootVolume) {
                        const allFromVolumes = await Promise.all([...rootVolume.root.eachFile('**/*.zip')]
                            .map(file => file.getContent().then(readZip)));
                        allFromVolumes.unshift(rootVolume);
                        const agis = [];
                        for (const volume of allFromVolumes) {
                            for await (const agi of eachAGIProject(volume.root)) {
                                agis.push(agi);
                            }
                        }
                        return agis;
                    }
                    let zip;
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
                    const json = JSON.parse(await (await patchJson.getContent()).text());
                    const bytepool = new Uint8Array(await (await bytepoolFile.getContent()).arrayBuffer());
                    const patchesByHash = new Map();
                    for (const patch of json.patches) {
                        patchesByHash.set(parseInt(patch.hashOriginal, 16), patch);
                    }
                    const srcAGIs = await getAllAGIs(fromVolume);
                    let result = null;
                    for (const srcAGI of srcAGIs) {
                        const patch = patchesByHash.get(agiHash(srcAGI));
                        if (patch) {
                            result = { patch, srcAGI };
                            break;
                        }
                    }
                    if (!result) {
                        showMessage('No matching game was found');
                        return;
                    }
                    const { srcAGI } = result;
                    let patchedAGI;
                    try {
                        patchedAGI = applyAGIPatch(srcAGI, json, bytepool);
                    }
                    catch (e) {
                        showMessage('Patching failed!');
                        console.error(e);
                        return;
                    }
                    const vols = new Map();
                    const logics = new Array();
                    const pictures = new Array();
                    const sounds = new Array();
                    const views = new Array();
                    const useCompression = Boolean(patchedAGI.packedDirs);
                    for (let [logic_i, logic] of patchedAGI.logic.entries()) {
                        if (!logic)
                            continue;
                        if (logic.type !== 'logic')
                            continue;
                        const volNumber = logic.volNumber || 0;
                        let vol = vols.get(volNumber);
                        if (!vol) {
                            vol = { pos: 0, data: [] };
                            vols.set(volNumber, vol);
                        }
                        if (logic_i >= logics.length)
                            logics.length = logic_i + 1;
                        logics[logic_i] = { volNumber, offset: vol.pos };
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
                        if (!picture)
                            continue;
                        if (picture.type !== 'raw-resource')
                            continue;
                        const volNumber = picture.volNumber || 0;
                        let vol = vols.get(volNumber);
                        if (!vol) {
                            vol = { pos: 0, data: [] };
                            vols.set(volNumber, vol);
                        }
                        if (picture_i >= pictures.length)
                            pictures.length = picture_i + 1;
                        pictures[picture_i] = { volNumber, offset: vol.pos };
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
                        if (!sound)
                            continue;
                        if (sound.type !== 'raw-resource')
                            continue;
                        const volNumber = sound.volNumber || 0;
                        let vol = vols.get(volNumber);
                        if (!vol) {
                            vol = { pos: 0, data: [] };
                            vols.set(volNumber, vol);
                        }
                        if (sound_i >= sounds.length)
                            sounds.length = sound_i + 1;
                        sounds[sound_i] = { volNumber, offset: vol.pos };
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
                        if (!view)
                            continue;
                        if (view.type !== 'view')
                            continue;
                        const volNumber = view.volNumber || 0;
                        let vol = vols.get(volNumber);
                        if (!vol) {
                            vol = { pos: 0, data: [] };
                            vols.set(volNumber, vol);
                        }
                        if (view_i >= views.length)
                            views.length = view_i + 1;
                        views[view_i] = { volNumber, offset: vol.pos };
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
                    function packIndex(index) {
                        const bytes = new Uint8Array(3 * index.length);
                        for (let i = 0; i < index.length; i++) {
                            const entry = index[i];
                            if (entry) {
                                const combo = entry.offset | (entry.volNumber << 20);
                                bytes[i * 3] = (combo >> 16) & 0xff;
                                bytes[i * 3 + 1] = (combo >> 8) & 0xff;
                                bytes[i * 3 + 2] = combo & 0xff;
                            }
                            else {
                                bytes[i * 3] = bytes[i * 3 + 1] = bytes[i * 3 + 2] = 0xff;
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
                    for (const [volNumber, { data }] of vols) {
                        patchedFiles.root.createFile(volPrefix + 'vol.' + volNumber, new Blob(data));
                    }
                    const zipChunks = [];
                    const ws = new WritableStream({
                        write(chunk) {
                            zipChunks.push(chunk);
                        },
                    });
                    await writeZipStream(patchedFiles, ws);
                    const zipBlob = new Blob(zipChunks, { type: 'application/zip' });
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(zipBlob);
                    link.download = 'patched.zip';
                    link.text = 'Download Patched Files';
                    btn.parentElement.insertAdjacentElement('afterend', link);
                    showMessage('Patch successfully applied');
                });
            });
        }
        catch (e) {
            console.error(e);
            alert('Failed to initialize');
        }
    });

})();
