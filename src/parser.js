(function (global) {
  'use strict';

  // 仅作为参考信息展示，不参与解析门禁。版本不同不代表格式不兼容：AIMemory 每页都由
  // AES-GCM authentication tag 保护，密钥或格式不匹配会明确抛错，不会静默产出错误数据。
  // 每项列出所有已端到端验证过的取值。
  const REFERENCE_VERSIONS = {
    appVersion: ['16.10.1', '16.11.4'],
    databaseVersion: [46],
    androidVersion: ['16'],
    colorosVersion: ['38'],
    backupRestoreVersion: ['16.14.2']
  };

  const formatExpected = (expected) => (Array.isArray(expected) ? expected.join(' / ') : String(expected));

  function normalizePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/^\.\//, '');
  }

  function buildFileIndex(fileList) {
    const files = Array.from(fileList || []);
    const entries = files.map((file) => ({
      file,
      path: normalizePath(file.webkitRelativePath || file.name)
    }));
    return {
      entries,
      findExactSuffix(suffix) {
        const wanted = normalizePath(suffix);
        const matches = entries.filter((entry) => entry.path === wanted || entry.path.endsWith('/' + wanted));
        if (matches.length === 1) return matches[0].file;
        if (matches.length > 1) {
          matches.sort((a, b) => a.path.length - b.path.length);
          return matches[0].file;
        }
        return null;
      },
      findAllByBasenamePrefix(prefix) {
        return entries
          .filter((entry) => entry.path.split('/').pop().startsWith(prefix))
          .sort((a, b) => numericSuffix(a.path) - numericSuffix(b.path));
      }
    };
  }

  function numericSuffix(path) {
    const name = normalizePath(path).split('/').pop();
    const match = name.match(/_(\d+)$/);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  }

  function bytesToAscii(bytes) {
    let out = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return out;
  }

  function extractEncryptInfo(arrayBuffer) {
    const ascii = bytesToAscii(new Uint8Array(arrayBuffer));
    const pairPattern = /([A-Za-z0-9]{32})(-?\d{18,20})/g;
    const pairs = [];
    for (const match of ascii.matchAll(pairPattern)) {
      pairs.push({ random: match[1], iv: match[2] });
    }
    const uniquePairs = Array.from(new Map(pairs.map((item) => [item.random + '|' + item.iv, item])).values());
    if (uniquePairs.length === 1) return uniquePairs[0];

    // SQLite 行记录在已验证格式中把两个 TEXT 值直接放入 payload；若中间存在少量
    // 非文本字节，退而分别收集候选。只有候选唯一时才接受，绝不猜测。
    const randoms = Array.from(new Set(ascii.match(/[A-Za-z0-9]{32}/g) || []));
    const ivs = Array.from(new Set(ascii.match(/-?\d{18,20}/g) || []));
    if (randoms.length === 1 && ivs.length === 1) return { random: randoms[0], iv: ivs[0] };

    throw new Error(
      `无法唯一识别 EncryptInfo（random 候选 ${randoms.length} 个，iv 候选 ${ivs.length} 个）。当前备份格式可能尚未支持。`
    );
  }

  async function readJsonFile(file, label) {
    if (!file) throw new Error(`缺少 ${label}`);
    try {
      return JSON.parse(await file.text());
    } catch (error) {
      throw new Error(`${label} 不是有效 JSON。`);
    }
  }

  function compareVersion(value, expected) {
    const actual = String(value ?? '');
    const accepted = Array.isArray(expected) ? expected : [expected];
    return accepted.map(String).includes(actual);
  }

  async function inspectBackup(fileList) {
    const index = buildFileIndex(fileList);
    const appInfoFile = index.findExactSuffix('BreenoMemory/app_info.json');
    const configFile = index.findExactSuffix('backup_config_new.db');
    const keyFile = index.findExactSuffix('BreenoMemory/BreenoMemorySecure/cryto_key');
    const memoryPages = index.findAllByBasenamePrefix('memory_page_');
    const collectionPages = index.findAllByBasenamePrefix('memory_collections_page_');
    const relationPages = index.findAllByBasenamePrefix('memory_collection_mcr_page_');
    const attachmentPages = index.findAllByBasenamePrefix('memory_attach_info_page_');
    const zipFile = index.findExactSuffix('BreenoMemory/files/file_backup.zip');

    const missing = [];
    if (!appInfoFile) missing.push('BreenoMemory/app_info.json');
    if (!configFile) missing.push('backup_config_new.db');
    if (!keyFile) missing.push('BreenoMemory/BreenoMemorySecure/cryto_key');
    if (memoryPages.length === 0) missing.push('memory_page_*');
    if (missing.length) {
      throw new Error('没有识别到完整的小布记忆官方备份，缺少：' + missing.join('、'));
    }

    const appInfo = await readJsonFile(appInfoFile, 'app_info.json');
    const checks = [
      ['AIMemory', appInfo.app_version, REFERENCE_VERSIONS.appVersion],
      ['database_version', appInfo.database_version, REFERENCE_VERSIONS.databaseVersion],
      ['Android', appInfo.android_version, REFERENCE_VERSIONS.androidVersion],
      ['ColorOS internal', appInfo.coloros_version, REFERENCE_VERSIONS.colorosVersion]
    ].map(([name, actual, expected]) => ({ name, actual: String(actual ?? ''), expected: formatExpected(expected), ok: compareVersion(actual, expected) }));

    return {
      index,
      appInfo,
      checks,
      matchesReference: checks.every((item) => item.ok),
      files: {
        appInfoFile,
        configFile,
        keyFile,
        memoryPages,
        collectionPages,
        relationPages,
        attachmentPages,
        zipFile
      }
    };
  }

  async function decryptJsonPages(entries, cryptoKey, label, onProgress, progressState) {
    const items = [];
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const encryptedText = (await entry.file.text()).trim();
      if (!encryptedText) continue;
      const plainText = await global.XiaobuCrypto.decryptAimemoryPayload(encryptedText, cryptoKey);
      let value;
      try {
        value = JSON.parse(plainText);
      } catch (error) {
        throw new Error(`${label} ${entry.path.split('/').pop()} 解密成功，但 JSON 解析失败。`);
      }
      if (Array.isArray(value)) items.push(...value);
      else if (value && Array.isArray(value.data)) items.push(...value.data);
      else if (value != null) items.push(value);

      progressState.done += 1;
      onProgress?.({ ...progressState, phase: label, current: i + 1, phaseTotal: entries.length });
      // 让浏览器有机会刷新进度条，避免大备份看起来“卡死”。
      if ((i + 1) % 6 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return items;
  }

  function parseMaybeObject(value) {
    if (value && typeof value === 'object') return value;
    if (typeof value !== 'string' || !value.trim()) return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function textOrEmpty(value) {
    return typeof value === 'string' ? value : value == null ? '' : String(value);
  }

  function uniqueStrings(values) {
    return Array.from(new Set((values || []).map((value) => textOrEmpty(value).trim()).filter(Boolean)));
  }

  function normalizeAttachment(attachment) {
    if (!attachment || typeof attachment !== 'object') return null;
    return {
      attachmentId: textOrEmpty(attachment.attachmentId || attachment.id),
      memoryId: textOrEmpty(attachment.memoryId),
      caption: textOrEmpty(attachment.caption),
      text: textOrEmpty(attachment.text),
      mediaType: attachment.mediaType ?? null,
      path: textOrEmpty(attachment.path),
      uri: textOrEmpty(attachment.uri),
      width: Number(attachment.width || 0),
      height: Number(attachment.height || 0),
      size: Number(attachment.cloudFileSize || attachment.fileSize || 0)
    };
  }

  function normalizeMemory(raw) {
    const item = raw && typeof raw === 'object' ? raw : {};
    const memory = item.memory && typeof item.memory === 'object' ? item.memory : item;
    const abstract = parseMaybeObject(memory.dataAbstract);
    const extra = parseMaybeObject(memory.extraData);
    const labels = Array.isArray(item.labels)
      ? uniqueStrings(item.labels.map((label) => (label && typeof label === 'object' ? label.labelName || label.labelAlias : label)))
      : [];
    const attachments = (Array.isArray(item.attachments) ? item.attachments : [])
      .map(normalizeAttachment)
      .filter(Boolean);
    const entities = Array.isArray(item.entities) ? item.entities : [];

    return {
      memoryId: textOrEmpty(memory.memoryId || item.memoryId),
      createdTime: Number(memory.createdTime || item.createdTime || 0),
      updateTime: Number(memory.updateTime || item.updateTime || 0),
      appName: textOrEmpty(memory.appName || item.appName),
      packageName: textOrEmpty(memory.packageName || item.packageName),
      title: textOrEmpty(abstract.title || item.title || memory.title || '未命名记忆'),
      summary: textOrEmpty(abstract.summary || item.summary),
      keywords: uniqueStrings(abstract.keywords || item.keywords || []),
      dataText: textOrEmpty(memory.dataText || item.dataText || extra.ocrText),
      dataTextCleanup: textOrEmpty(memory.dataTextCleanup || item.dataTextCleanup),
      deeplink: textOrEmpty(memory.deeplink || item.deeplink || extra.applink),
      screenshot: textOrEmpty(memory.screenshot || item.screenshot),
      audioFile: textOrEmpty(memory.audioFile || item.audioFile),
      imageCount: Number(memory.imageCount || item.imageCount || 0),
      dataCategory: memory.dataCategory ?? item.dataCategory ?? null,
      dataSource: textOrEmpty(memory.dataSource || item.dataSource),
      sceneName: textOrEmpty(memory.sceneName || item.sceneName),
      sceneType: memory.sceneType ?? item.sceneType ?? null,
      labels,
      collectionIds: [],
      collectionNames: [],
      attachmentCount: attachments.length,
      attachments,
      entities
    };
  }

  function normalizeCollection(raw) {
    const collection = raw && raw.collection && typeof raw.collection === 'object' ? raw.collection : raw || {};
    return {
      collectionId: textOrEmpty(collection.collectionId || collection.id),
      collectionName: textOrEmpty(collection.collectionName || collection.name || '未命名合集'),
      description: textOrEmpty(collection.collectionDescription || collection.description || collection.summary),
      createdTime: Number(collection.createdTime || 0),
      updateTime: Number(collection.updateTime || 0)
    };
  }

  function relationIds(raw) {
    const relation = raw && raw.collectionMemoryCrossRef && typeof raw.collectionMemoryCrossRef === 'object'
      ? raw.collectionMemoryCrossRef
      : raw || {};
    return {
      collectionId: textOrEmpty(relation.collectionId || relation.collection_id),
      memoryId: textOrEmpty(relation.memoryId || relation.memory_id),
      deleted: Boolean(relation.deleted || relation.realDeleted || relation.mapDeleted)
    };
  }

  function applyCollectionRelations(memories, collections, rawRelations) {
    const memoryMap = new Map(memories.map((memory) => [memory.memoryId, memory]));
    const collectionMap = new Map(collections.map((collection) => [collection.collectionId, collection]));
    const seen = new Set();

    for (const raw of rawRelations) {
      const relation = relationIds(raw);
      if (!relation.collectionId || !relation.memoryId || relation.deleted) continue;
      const key = relation.collectionId + '|' + relation.memoryId;
      if (seen.has(key)) continue;
      seen.add(key);
      const memory = memoryMap.get(relation.memoryId);
      const collection = collectionMap.get(relation.collectionId);
      if (!memory || !collection) continue;
      memory.collectionIds.push(collection.collectionId);
      memory.collectionNames.push(collection.collectionName);
    }

    for (const memory of memories) {
      memory.collectionIds = uniqueStrings(memory.collectionIds);
      memory.collectionNames = uniqueStrings(memory.collectionNames);
    }
  }

  function mergeAttachmentPages(memories, rawAttachmentRows) {
    if (!rawAttachmentRows.length) return;
    const memoryMap = new Map(memories.map((memory) => [memory.memoryId, memory]));
    const existingIds = new Map(memories.map((memory) => [memory.memoryId, new Set(memory.attachments.map((item) => item.attachmentId || item.uri || item.path))]));

    for (const raw of rawAttachmentRows) {
      const attachment = normalizeAttachment(raw && raw.attachment ? raw.attachment : raw);
      if (!attachment || !attachment.memoryId) continue;
      const memory = memoryMap.get(attachment.memoryId);
      if (!memory) continue;
      const identity = attachment.attachmentId || attachment.uri || attachment.path;
      const ids = existingIds.get(memory.memoryId);
      if (identity && ids.has(identity)) continue;
      if (identity) ids.add(identity);
      memory.attachments.push(attachment);
      memory.attachmentCount = memory.attachments.length;
    }
  }

  async function parseBackup(fileList, onProgress) {
    if (!global.XiaobuCrypto) throw new Error('crypto.js 尚未加载。');
    const inspection = await inspectBackup(fileList);
    const { files, appInfo } = inspection;

    const configBuffer = await files.configFile.arrayBuffer();
    const encryptInfo = extractEncryptInfo(configBuffer);
    const wrappedKey = new Uint8Array(await files.keyFile.arrayBuffer());
    const { rawKey } = await global.XiaobuCrypto.decryptOuterCrytoKey(wrappedKey, encryptInfo.random, encryptInfo.iv);
    const cryptoKey = await global.XiaobuCrypto.importAimemoryKey(rawKey);

    const total = files.memoryPages.length + files.collectionPages.length + files.relationPages.length + files.attachmentPages.length;
    const progressState = { done: 0, total };
    onProgress?.({ ...progressState, phase: '密钥验证', current: 1, phaseTotal: 1 });

    const rawMemories = await decryptJsonPages(files.memoryPages, cryptoKey, '记忆', onProgress, progressState);
    const rawCollections = await decryptJsonPages(files.collectionPages, cryptoKey, '合集', onProgress, progressState);
    const rawRelations = await decryptJsonPages(files.relationPages, cryptoKey, '合集关系', onProgress, progressState);
    const rawAttachmentRows = await decryptJsonPages(files.attachmentPages, cryptoKey, '附件索引', onProgress, progressState);

    const memories = rawMemories.map(normalizeMemory).filter((memory) => memory.memoryId);
    const uniqueMemoryMap = new Map(memories.map((memory) => [memory.memoryId, memory]));
    const uniqueMemories = Array.from(uniqueMemoryMap.values()).sort((a, b) => b.createdTime - a.createdTime);
    const collections = rawCollections.map(normalizeCollection).filter((collection) => collection.collectionId);
    const uniqueCollectionMap = new Map(collections.map((collection) => [collection.collectionId, collection]));
    const uniqueCollections = Array.from(uniqueCollectionMap.values());

    applyCollectionRelations(uniqueMemories, uniqueCollections, rawRelations);
    mergeAttachmentPages(uniqueMemories, rawAttachmentRows);

    return {
      meta: {
        format: 'xiaobu-memory-export-v1',
        parsedAt: new Date().toISOString(),
        appInfo,
        referenceVersions: REFERENCE_VERSIONS,
        matchesReferenceVersions: inspection.matchesReference,
        stats: {
          memories: uniqueMemories.length,
          collections: uniqueCollections.length,
          relations: rawRelations.length,
          attachmentRows: rawAttachmentRows.length,
          memoriesWithAttachments: uniqueMemories.filter((memory) => memory.attachmentCount > 0).length,
          attachments: uniqueMemories.reduce((sum, memory) => sum + memory.attachmentCount, 0)
        }
      },
      memories: uniqueMemories,
      collections: uniqueCollections,
      attachmentArchive: files.zipFile || null
    };
  }

  const api = {
    REFERENCE_VERSIONS,
    formatExpected,
    buildFileIndex,
    extractEncryptInfo,
    inspectBackup,
    parseBackup,
    normalizeMemory,
    normalizeCollection,
    applyCollectionRelations
  };

  global.XiaobuParser = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
