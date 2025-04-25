import { crc32FromBlob } from "./crc32";
import { VFSEncodingDescriptor, VFSVolume } from "./virtual-file-system";

const EOCD_LENGTH = 22;
const MAX_COMMENT_LENGTH = 0xffff;
const SUFFIX_LENGTH = EOCD_LENGTH + MAX_COMMENT_LENGTH;

const EXTRA_UTF8_PATH = 0x7075;

const FLAG_UTF8 = (1 << 11);

interface ZipExtra {
  type: number;
  data: Uint8Array;
}

export interface ZipEntryInit {
  readonly path: string;
  readonly zipSpecVersion?: number;
  readonly creatorOS?: number;
  readonly flags?: number;
  readonly compressionMethod?: number;
  readonly lastMod?: Date | number;
  readonly extra?: ZipExtra[];
  readonly comment?: Uint8Array | string;
  readonly internalAttributes?: number;
  readonly externalAttributes?: number;
}

const utf8Decoder = new TextDecoder('utf-8', {fatal: true});
const utf8Encoder = new TextEncoder();

function zipEntryToGlobalRecord(entry: ZipEntryInit): Uint8Array {
  const pathBuf = utf8Encoder.encode(entry.path);
  const commentBuf = typeof(entry.comment) === 'string' ? utf8Encoder.encode(entry.comment) : entry.comment || new Uint8Array(0);
  const buf = new ArrayBuffer(30 + pathBuf.length + commentBuf.length + (entry.extra || []).reduce((len, record) => len + 2 + record.data.length, 0));
  const dv = new DataView(buf, 0, 30);
  new Uint8Array(buf, 30, pathBuf.length).set(pathBuf);
  new Uint8Array(buf, 30 + pathBuf.length, commentBuf.length).set(pathBuf);
  return new Uint8Array(buf);
}

function zipEntryToLocalRecord(entry: ZipEntryInit): Uint8Array {
  const pathBuf = utf8Encoder.encode(entry.path);
  const extra = entry.extra || [];
  const buf = new ArrayBuffer(30 + pathBuf.length + extra.reduce((len, record) => len + 2 + record.data.length, 0));
  const bytes = new Uint8Array(buf);
  const dv = new DataView(buf, 0, 30);
  dv.setUint32(0, 0x504b0304, false);
  let reqVersion: number;
  if (pathBuf.length === entry.path.length) {
    if (entry.compressionMethod === 0) {
      reqVersion = 10;
    }
    else {
      reqVersion = 20;
    }
  }
  else {
    reqVersion = 63;
  }
  dv.setUint16(4, reqVersion, true);
  new Uint8Array(buf, 30, pathBuf.length).set(pathBuf);
  const dv2 = new DataView(buf, 30 + pathBuf.length);
  let extraOff = 0;
  for (let entry_i = 0; entry_i < extra.length; entry_i++) {
    dv2.setUint16(extraOff, extra[entry_i].type, true);
  }
  return bytes;
}

export async function readZip(zip: Blob): Promise<VFSVolume> {
  const volume = new VFSVolume((zip as File).lastModified);
  const suffix = new Uint8Array(await zip.slice(-SUFFIX_LENGTH).arrayBuffer());
  let eocd: Uint8Array | null = null, comment: Uint8Array | null = null;
  for (let i = suffix.length - 22; i >= 0; i -= 4) {
    let start: number;
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
    if (String.fromCharCode(suffix[start], suffix[start+1], suffix[start+2], suffix[start+3]) !== 'PK\x05\x06') {
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
  const getEachEntry = async function*() {
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
      const extraRecords = new Array<ZipExtra>();
      let extraPos = 0;
      while (extraPos < extra.length) {
        const recordType = extra[extraPos] | (extra[extraPos + 1] << 8);
        const recordLen = extra[extraPos + 2] | (extra[extraPos + 3] << 8);
        extraRecords.push({type: recordType, data: extra.subarray(extraPos + 4, extraPos + 4 + recordLen)});
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
      const lastModified = new Date(year, month-1, dayOfMonth, hour, minute, second).getDate();
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
    for (let i = 0; i < fullPath.length-1; i++) {
      const existing = dir.getEntry(fullPath[i]);
      if (!existing) {
        dir = dir.createDirectory(fullPath[i]);
      }
      else if (existing.isDirectory()) {
        dir = existing;
      }
      else {
        throw new Error('both file and directory: ' + fullPath.slice(0, i+1).join('/'));
      }
    }
    if (fullPath[fullPath.length-1] !== '') {
      let descriptor: VFSEncodingDescriptor;
      switch (entry.compressionMethod) {
        case 0: descriptor = null; break;
        case 8: descriptor = {encoding:'deflate-raw'}; break;
        default: throw new Error('unsupported compression type: ' + entry.compressionMethod);
      }
      dir.createFile(fullPath[fullPath.length-1], await entry.content, entry.lastModified, descriptor);
    }
  }
  return volume;
}

function bytesToString(bytes: Uint8Array, extra: ZipExtra[], flags: number) {
  const utf8Path = extra.find(v => v.type === EXTRA_UTF8_PATH);
  if (utf8Path) {
    if (utf8Path.data.length > 5 && utf8Path.data[0] <= 1) {
      return utf8Decoder.decode(utf8Path.data.subarray(5));
    }
  }
  if (flags & FLAG_UTF8) {
    return utf8Decoder.decode(bytes);
  }
  return String.fromCharCode.apply(null, bytes as any);
}

function zCompress(b: Blob) {
  const zs = new CompressionStream('deflate-raw');
  return new Response(b.stream().pipeThrough(zs)).blob();
}

function zDecompress(b: Blob) {
  const zs = new DecompressionStream('deflate-raw');
  return new Response(b.stream().pipeThrough(zs)).blob();
}

function encodeExtra(extra: ZipExtra[]) {
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

function toDOSTime(timestamp: number | undefined | null) {
  if (timestamp == null) return {date:0, time:0};
  const d = new Date(timestamp);
  const date = ( d.getDate() | ((d.getMonth()+1) << 5) | ((d.getFullYear() - 1980) << 9) ) & 0xffff;
  const time = (d.getMilliseconds() >= 500 ? 1 : 0) | ( d.getSeconds() << 1 ) | (d.getMinutes() << 5) | (d.getHours() << 11);
  return { date, time };
}

export async function writeZipStream(zip: VFSVolume, ws: WritableStream<Uint8Array>) {
  const writer = ws.getWriter();
  try {
    let writtenBytes = 0;
    const centralDirRecords: Uint8Array[] = [];
    for (const entry of zip.root.eachEntry('**')) {
      const localRecordOffset = writtenBytes;
      const path = entry.getPath().join('/') + (entry.isDirectory() ? '/' : '');
      const extra: ZipExtra[] = [];
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
      const stored = !compress || !entry.isFile() ? full : await entry.getContent({encoding:'deflate-raw'});
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
            if (done) break;
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
