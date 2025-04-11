
import { Subject } from 'rxjs';

export type VFSEncodingDescriptor = (
  | null
  | undefined
  | {readonly encoding: 'deflate' | 'deflate-raw' | 'gzip', readonly inner?: VFSEncodingDescriptor}
);

const findSortedIndex = <T, T2 = T>(
  array: ArrayLike<T2>,
  value: T,
  compare: (a: T, b: T2) => number,
): number => {
  let low = 0;
  let high = array.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const cmp = compare(value, array[mid]);
    if (cmp > 0) low = mid + 1;
    else if (cmp < 0) high = mid - 1;
    else return mid;
  }
  return ~low;
};

const normalizeForNaturalSort = (a: string) => a.replace(/\d+/g, v => {
  v = v.replace(/^0+/, '') || '0';
  const lenPrefix = '9'.repeat(Math.floor(v.length / 9)) + String(v.length % 9);
  return lenPrefix + ':' + v;
});

const compareFilenames = (a: string, b: string) => {
  if (a === b) return 0;
  a = a.toUpperCase();
  b = b.toUpperCase();
  if (a === b) return 0;
  const a2 = normalizeForNaturalSort(a);
  const b2 = normalizeForNaturalSort(b);
  if (a2 !== b2) {
    a = a2;
    b  = b2;
  }
  return (a < b) ? -1 : 1;
};

export type VFSEvent = (
  | {type:'file-created', file: VFSFile}
  | {type:'directory-created', directory: VFSDirectory}
  | {type:'file-modified', file: VFSFile}
);

export class VFSVolume {
  constructor(rootLastModified: Date | number | null = Date.now()) {
    this.root = new VFSDirectory(this, null as any, '', rootLastModified);
  }
  readonly root: VFSDirectory;
  static encodePathToString(parts: readonly string[]) {
    return parts.map(v => {
      v = encodeURIComponent(v);
      if (v === '.') return '%2E';
      if (v === '..') return '%2E%2E';
      return v.replace(/\*/g, '%2A');
    }).join('/');
  }
  static decodePathFromString(path: string) {
    return path.split(/\//g).map(v => decodeURIComponent(v));
  }
  readonly events = new Subject<VFSEvent>();
}

export abstract class VFSDirectoryEntry {
  constructor(readonly volume: VFSVolume, parentDirectory: VFSDirectory | 'root', readonly name: string, readonly lastModified?: number) {
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
  readonly parentDirectory: VFSDirectory;
  getPath() {
    const path = [];
    for (let ancestor: VFSDirectoryEntry = this; ancestor !== ancestor.parentDirectory; ancestor = ancestor.parentDirectory) {
      path.unshift(ancestor.name);
    }
    return path;
  }
  private _meta = new Map<string, unknown>();
  meta<T>(name: string, init: (v: this) => T): T {
    if (this._meta.has(name)) {
      return this._meta.get(name)! as T;
    }
    else {
      const meta = init(this);
      this._meta.set(name, meta);
      return meta;
    }
  }
  abstract isFile(): this is VFSFile;
  abstract isDirectory(): this is VFSDirectory;
  abstract isArchive(): this is VFSArchive;
}

export class VFSDirectory extends VFSDirectoryEntry implements Iterable<[string, VFSDirectoryEntry]> {
  constructor(volume: VFSVolume, parentDirectory: VFSDirectory, name: string, lastModified: number | Date | undefined | null) {
    super(volume, parentDirectory, name, lastModified == null ? undefined : Number(lastModified));
  }
  private _entries: VFSDirectoryEntry[] = [];
  *[Symbol.iterator](): Iterator<[string, VFSDirectoryEntry]> {
    for (const entry of this._entries) {
      yield [entry.name, entry] as const;
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
  resolve(relativePath: string) {
    let path: string[];
    if (relativePath.startsWith('/')) {
      path = [];
      relativePath = relativePath.slice(1);
    }
    else {
      path = this.getPath();
    }
    const split = relativePath.split(/\//g);
    for (let i = 0; i < split.length; i++) {
      if (split[i] === '.') continue;
      if (split[i] === '..') path.pop();
      path.push(decodeURIComponent(split[i]));
    }
    return path;
  }
  getEntry(name: string) {
    const idx = findSortedIndex(this._entries, name, (name, entry) => compareFilenames(name, entry.name));
    if (idx < 0) return null;
    return this._entries[idx];
  }
  getFile(name: string) {
    const entry = this.getEntry(name);
    return (entry instanceof VFSFile) ? entry : null;
  }
  getFolder(name: string) {
    const entry = this.getEntry(name);
    return (entry instanceof VFSDirectory) ? entry : null;
  }
  *eachEntry(glob = '*'): Iterable<VFSDirectoryEntry> {
    if (glob === '*') {
      yield* this._entries;
      return;
    }
    let dirs: VFSDirectory[];
    if (glob.startsWith('/')) {
      dirs = [this.volume.root];
      glob = glob.slice(1);
    }
    else {
      dirs = [this];
    }
    const parts = glob.split(/\//g);
    for (let i = 0; i < parts.length-1; i++) {
      const part = parts[i];
      let nextDirs: VFSDirectory[];
      if (part === '**') {
        const set = new Set<VFSDirectory>();
        function recurse(dir: VFSDirectory) {
          if (set.has(dir)) return;
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
        const set = new Set<VFSDirectory>();
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
              if (regex.test(subdir.name)) nextDirs.push(subdir);
            }
          }
        }
        else {
          const name = decodeURIComponent(part);
          for (const dir of dirs) {
            const subdir = dir.getFolder(name);
            if (subdir) nextDirs.push(subdir);
          }
        }
      }
      if (nextDirs.length === 0) return;
      dirs = nextDirs;
    }
    const lastPart = parts[parts.length-1];
    if (lastPart === '**') {
      function *recurse(dir: VFSDirectory): Iterable<VFSDirectoryEntry> {
        for (const entry of dir.entries()) {
          yield entry;
          if (entry.isDirectory()) yield* recurse(entry);
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
      const set = new Set<VFSDirectory>();
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
        yield *dir._entries;
      }
    }
    else {
      const starParts = lastPart.split(/\*+/g);
      if (starParts.length === 1) {
        const name = decodeURIComponent(lastPart);
        for (const dir of dirs) {
          const entry = dir.getEntry(name);
          if (entry) yield entry;
        }
      }
      else {
        const regex = new RegExp('^' + starParts.map(v => decodeURIComponent(v).replace(/([\[\]\*\.\?\{\}\/\\\(\)\^\$])/g, '\\$1')).join('.*') + '$', 'i');
        for (const dir of dirs) {
          for (const entry of dir._entries) {
            if (regex.test(entry.name)) yield entry;
          }
        }
      }
    }
  }
  *eachFile(glob = '*'): Iterable<VFSFile> {
    for (const entry of this.eachEntry(glob)) {
      if (entry.isFile()) yield entry;
    }
  }
  *eachDirectory(glob = '*'): Iterable<VFSDirectory> {
    for (const entry of this.eachEntry(glob)) {
      if (entry.isDirectory()) yield entry;
    }
  }
  createDirectory(name: string, lastModified: Date | number | undefined | null = Date.now()) {
    const subdir = new VFSDirectory(this.volume, this, name, lastModified);
    const idx = findSortedIndex(this._entries, subdir, (a, b) => compareFilenames(a.name, b.name));
    if (idx < 0) {
      this._entries.splice(~idx, 0, subdir);
      this.volume.events.next({type:'directory-created', directory:subdir});
    }
    else {
      throw new Error('duplicate entry: ' + name);
    }
    return subdir;
  }
  createFile(name: string, content: Blob, lastModified: Date | number | undefined | null = Date.now(), contentEncoding: VFSEncodingDescriptor = null) {
    const file = new VFSFile(this.volume, this, name, lastModified, content, contentEncoding);
    const idx = findSortedIndex(this._entries, file, (a, b) => compareFilenames(a.name, b.name));
    if (idx < 0) {
      this._entries.splice(~idx, 0, file);
      this.volume.events.next({type:'file-created', file});
    }
    else {
      throw new Error('duplicate entry: ' + name);
    }
    return file;
  }
  isFile(): this is VFSFile { return false; }
  isDirectory(): this is VFSDirectory { return true; }
  isArchive(): this is VFSArchive {
    return false;
  }
}

const areEncodingsEqual = (a: VFSEncodingDescriptor, b: VFSEncodingDescriptor): boolean => {
  if (a == null) return b == null;
  if (b == null) return false;
  return a.encoding === b.encoding && areEncodingsEqual(a.inner, b.inner);
};

const encodeContentStream = (contentStream: ReadableStream<Uint8Array>, descriptor: VFSEncodingDescriptor) => {
  if (descriptor == null) return contentStream;
  switch (descriptor.encoding) {
    case 'deflate': case 'deflate-raw': case 'gzip': {
      const encoder = new CompressionStream(descriptor.encoding);
      encodeContentStream(contentStream, descriptor.inner).pipeTo(encoder.writable);
      return encoder.readable;
    }
    default: {
      throw new Error('unknown encoding: ' + descriptor.encoding);
    }
  }
};

const decodeContentStream = (contentStream: ReadableStream<Uint8Array>, descriptor: VFSEncodingDescriptor) => {
  if (descriptor == null) return contentStream;
  switch (descriptor.encoding) {
    case 'deflate': case 'deflate-raw': case 'gzip': {
      const decoder = new DecompressionStream(descriptor.encoding);
      contentStream.pipeTo(decoder.writable);
      return decodeContentStream(decoder.readable, descriptor.inner);
    }
    default: {
      throw new Error('unknown encoding: ' + descriptor.encoding);
    }
  }
};

export class VFSFile extends VFSDirectoryEntry {
  constructor(volume: VFSVolume, parentDirectory: VFSDirectory, name: string, lastModified: number | Date | undefined | null, private content: Blob, private contentEncoding: VFSEncodingDescriptor = null) {
    super(volume, parentDirectory, name, lastModified == null ? undefined : Number(lastModified));
  }
  stream(contentEncoding: VFSEncodingDescriptor = null) {
    let stream = this.content.stream();
    stream = decodeContentStream(stream, this.contentEncoding);
    stream = encodeContentStream(stream, contentEncoding);
    return stream;
  }
  getContent(contentEncoding: VFSEncodingDescriptor = null) {
    if (areEncodingsEqual(contentEncoding, this.contentEncoding)) {
      return Promise.resolve(this.content);
    }
    return new Response(this.stream()).blob();
  }
  replaceContent(newContent: Blob, contentEncoding: VFSEncodingDescriptor = null) {
    this.content = newContent;
    this.contentEncoding = contentEncoding;
    this.volume.events.next({type:'file-modified', file:this});
  }
  isArchive(): this is VFSArchive {
    return false;
  }
  isFile(): this is VFSFile { return true; }
  isDirectory(): this is VFSDirectory { return false; }
}

export abstract class VFSArchive extends VFSFile {
  constructor(volume: VFSVolume, parentDirectory: VFSDirectory, name: string, readonly archivedVolume: VFSVolume, lastModified: number | Date | undefined | null) {
    super(volume, parentDirectory, name, lastModified, null as any, null);
    archivedVolume.events.subscribe(_ => {
      this.volume.events.next({type:'file-modified', file:this});
    });
  }
  replaceContent() {
    throw new Error('archive content is dynamically created');
  }
  getContent(contentEncoding: VFSEncodingDescriptor) {
    let stream = this.generateContent();
    stream = encodeContentStream(stream, contentEncoding);
    return new Response(stream).blob();
  }
  abstract generateContent(): ReadableStream;
  isArchive(): this is VFSArchive {
    return true;
  }
}
