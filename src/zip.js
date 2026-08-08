(function (global) {
  'use strict';

  const EOCD_SIGNATURE = 0x06054b50;
  const CENTRAL_SIGNATURE = 0x02014b50;
  const LOCAL_SIGNATURE = 0x04034b50;
  const UTF8_FLAG = 0x0800;
  const decoder = new TextDecoder('utf-8');

  function readU16(view, offset) {
    return view.getUint16(offset, true);
  }

  function readU32(view, offset) {
    return view.getUint32(offset, true);
  }

  function normalizeZipPath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  }

  function findEocd(view) {
    for (let offset = view.byteLength - 22; offset >= 0; offset -= 1) {
      if (readU32(view, offset) === EOCD_SIGNATURE) return offset;
    }
    return -1;
  }

  async function indexZip(blob) {
    if (!blob || typeof blob.slice !== 'function') throw new Error('附件归档不是有效 Blob/File。');
    const tailSize = Math.min(blob.size, 22 + 0xffff + 64);
    const tailOffset = blob.size - tailSize;
    const tailBuffer = await blob.slice(tailOffset).arrayBuffer();
    const tailView = new DataView(tailBuffer);
    const eocdOffset = findEocd(tailView);
    if (eocdOffset < 0) throw new Error('附件 ZIP 未找到中央目录。');

    const diskNumber = readU16(tailView, eocdOffset + 4);
    const centralDisk = readU16(tailView, eocdOffset + 6);
    if (diskNumber !== 0 || centralDisk !== 0) throw new Error('暂不支持多卷 ZIP。');

    const entryCount = readU16(tailView, eocdOffset + 10);
    const centralSize = readU32(tailView, eocdOffset + 12);
    const centralOffset = readU32(tailView, eocdOffset + 16);
    if (centralOffset + centralSize > blob.size) throw new Error('ZIP 中央目录越界。');

    const centralBuffer = await blob.slice(centralOffset, centralOffset + centralSize).arrayBuffer();
    const view = new DataView(centralBuffer);
    const bytes = new Uint8Array(centralBuffer);
    const entries = [];
    let cursor = 0;

    while (cursor + 46 <= view.byteLength && entries.length < entryCount) {
      if (readU32(view, cursor) !== CENTRAL_SIGNATURE) throw new Error('ZIP 中央目录记录损坏。');
      const flags = readU16(view, cursor + 8);
      const method = readU16(view, cursor + 10);
      const compressedSize = readU32(view, cursor + 20);
      const uncompressedSize = readU32(view, cursor + 24);
      const nameLength = readU16(view, cursor + 28);
      const extraLength = readU16(view, cursor + 30);
      const commentLength = readU16(view, cursor + 32);
      const localHeaderOffset = readU32(view, cursor + 42);
      const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
      // AIMemory 备份使用 UTF-8 路径。未设置 UTF-8 flag 时仍优先 UTF-8 解码；
      // 文件名主要为 ASCII/UUID，因此不会引入歧义。
      const name = normalizeZipPath(decoder.decode(nameBytes));
      entries.push({ name, flags, method, compressedSize, uncompressedSize, localHeaderOffset, utf8: Boolean(flags & UTF8_FLAG) });
      cursor += 46 + nameLength + extraLength + commentLength;
    }

    if (entries.length !== entryCount) {
      throw new Error(`ZIP 目录记录数量不一致：声明 ${entryCount}，读取 ${entries.length}。`);
    }

    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    return {
      blob,
      entries,
      byName,
      resolve(pathOrUri) {
        const candidate = normalizeZipPath(pathOrUri);
        if (!candidate) return null;
        if (byName.has(candidate)) return byName.get(candidate);
        const marker = '/files/';
        const privateIndex = candidate.indexOf(marker);
        if (privateIndex >= 0) {
          const suffix = candidate.slice(privateIndex + marker.length);
          if (byName.has(suffix)) return byName.get(suffix);
        }
        const provider = 'content://com.oplus.aimemory.dataCenterFileProvider/';
        if (candidate.startsWith(provider)) {
          const suffix = candidate.slice(provider.length);
          if (byName.has(suffix)) return byName.get(suffix);
        }
        const hits = entries.filter((entry) => candidate.endsWith('/' + entry.name) || entry.name.endsWith('/' + candidate));
        return hits.length === 1 ? hits[0] : null;
      }
    };
  }

  async function inflateRaw(blob) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('当前浏览器缺少 DecompressionStream，无法解压 Deflate 附件。请使用最新版 Chrome / Edge。');
    }
    let stream;
    try {
      stream = blob.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    } catch (error) {
      throw new Error('当前浏览器不支持 deflate-raw 解压。');
    }
    return new Blob([await new Response(stream).arrayBuffer()]);
  }

  async function extractEntry(zipIndex, entry) {
    if (!zipIndex?.blob || !entry) throw new Error('缺少 ZIP 索引或条目。');
    const headerBuffer = await zipIndex.blob.slice(entry.localHeaderOffset, entry.localHeaderOffset + 30).arrayBuffer();
    const view = new DataView(headerBuffer);
    if (view.byteLength < 30 || readU32(view, 0) !== LOCAL_SIGNATURE) throw new Error('ZIP 本地文件头损坏。');
    const nameLength = readU16(view, 26);
    const extraLength = readU16(view, 28);
    const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
    const compressed = zipIndex.blob.slice(dataStart, dataStart + entry.compressedSize);

    if (entry.method === 0) return compressed;
    if (entry.method === 8) return inflateRaw(compressed);
    throw new Error(`附件使用暂不支持的 ZIP 压缩方法 ${entry.method}。`);
  }

  const api = { indexZip, extractEntry, normalizeZipPath };
  global.XiaobuZip = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
