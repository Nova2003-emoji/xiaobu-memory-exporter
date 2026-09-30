'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');

const XiaobuCrypto = require('../src/crypto.js');
global.XiaobuCrypto = XiaobuCrypto;
const XiaobuParser = require('../src/parser.js');

const encoder = new TextEncoder();

class VirtualFile {
  constructor(path, data) {
    this.webkitRelativePath = path;
    this.name = path.split('/').pop();
    this._bytes = typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data);
    this.size = this._bytes.byteLength;
  }
  async text() { return new TextDecoder().decode(this._bytes); }
  async arrayBuffer() { return this._bytes.slice().buffer; }
}

async function makeWrappedKey(random, ivText, rawAimemoryKey) {
  const base64Key = XiaobuCrypto.bytesToBase64(rawAimemoryKey);
  const outerKeyString = await XiaobuCrypto.deriveOuterKeyString(random);
  const key = await webcrypto.subtle.importKey('raw', encoder.encode(outerKeyString), { name: 'AES-CBC' }, false, ['encrypt']);
  const iv = encoder.encode(ivText).subarray(0, 16);
  return new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, encoder.encode(base64Key)));
}

async function makePage(value, rawAimemoryKey, ivSeed) {
  const key = await webcrypto.subtle.importKey('raw', rawAimemoryKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = new Uint8Array(16);
  iv.fill(ivSeed);
  const cipher = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, encoder.encode(JSON.stringify(value))));
  const packed = new Uint8Array(iv.length + cipher.length);
  packed.set(iv, 0); packed.set(cipher, iv.length);
  return XiaobuCrypto.bytesToBase64(packed);
}

test('ColorOS high-nibble HMAC derivation returns a 32-char AES key', async () => {
  const random = 'AbCdEf0123456789GhIjKl9876543210';
  const value = await XiaobuCrypto.deriveOuterKeyString(random);
  assert.match(value, /^[0-9a-f]{32}$/);

  const hmacKey = await webcrypto.subtle.importKey('raw', encoder.encode(random), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await webcrypto.subtle.sign('HMAC', hmacKey, encoder.encode(XiaobuCrypto.FIXED_KEY_MATERIAL)));
  const expected = Array.from(digest, (byte) => (byte >>> 4).toString(16)).join('');
  assert.equal(value, expected);
});

test('outer AES-CBC wrapper and AIMemory AES-GCM page both round-trip with synthetic keys', async () => {
  const random = 'Qwerty1234567890Asdfgh0987654321';
  const ivText = '-4894188051423819894';
  const rawKey = Uint8Array.from({ length: 32 }, (_, index) => (index * 17 + 9) & 255);
  const wrapped = await makeWrappedKey(random, ivText, rawKey);
  const unwrapped = await XiaobuCrypto.decryptOuterCrytoKey(wrapped, random, ivText);
  assert.deepEqual(Array.from(unwrapped.rawKey), Array.from(rawKey));

  const payload = [{ memory: { memoryId: 'synthetic-memory', dataText: 'hello' } }];
  const page = await makePage(payload, rawKey, 7);
  const cryptoKey = await XiaobuCrypto.importAimemoryKey(rawKey);
  const plaintext = await XiaobuCrypto.decryptAimemoryPayload(page, cryptoKey);
  assert.deepEqual(JSON.parse(plaintext), payload);
});

test('EncryptInfo scanner extracts only an unambiguous random/iv pair', () => {
  const random = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6';
  const iv = '-1234567890123456789';
  const bytes = encoder.encode(`SQLite-prefix\u0001${random}${iv}\u0000suffix`);
  assert.deepEqual(XiaobuParser.extractEncryptInfo(bytes.buffer), { random, iv });
});

const SYNTHETIC_RANDOM = 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4';
const SYNTHETIC_IV = '-8123456789012345678';

const BASE_APP_INFO = {
  android_version: '16', app_version: '16.10.1', coloros_version: '38', database_version: 46, flavor: 'domestic', device_type: 'phone'
};

async function buildSyntheticBackup(appInfoOverrides = {}) {
  const random = SYNTHETIC_RANDOM;
  const ivText = SYNTHETIC_IV;
  const rawKey = Uint8Array.from({ length: 32 }, (_, index) => (index * 11 + 5) & 255);
  const wrapped = await makeWrappedKey(random, ivText, rawKey);

  const rawMemories = [
    {
      memory: {
        memoryId: 'm-001', appName: '合成来源', packageName: 'demo.package', createdTime: 1700000000000,
        dataText: '这是用于自动化测试的合成正文。', dataSource: 'directService', sceneName: 'article_info',
        dataAbstract: { title: '合成记忆一', summary: '合成摘要一', keywords: ['测试', '本地'] }
      },
      labels: [{ labelName: '示例标签' }], attachments: [], entities: []
    },
    {
      memory: {
        memoryId: 'm-002', appName: '合成来源', packageName: 'demo.package', createdTime: 1700000001000,
        dataText: '第二条合成正文。', dataAbstract: { title: '合成记忆二', summary: '合成摘要二', keywords: [] }
      }, labels: [], attachments: [], entities: []
    }
  ];
  const rawCollections = [{ collectionId: 'c-001', collectionName: '合成合集', collectionDescription: '测试合集' }];
  const rawRelations = [{ collectionId: 'c-001', memoryId: 'm-001' }];

  return [
    new VirtualFile('2026-01-01-120000/backup_config_new.db', encoder.encode(`db${random}${ivText}tail`)),
    new VirtualFile('2026-01-01-120000/BreenoMemory/app_info.json', JSON.stringify({ ...BASE_APP_INFO, ...appInfoOverrides })),
    new VirtualFile('2026-01-01-120000/BreenoMemory/BreenoMemorySecure/cryto_key', wrapped),
    new VirtualFile('2026-01-01-120000/BreenoMemory/database/memory_page_0', await makePage(rawMemories, rawKey, 1)),
    new VirtualFile('2026-01-01-120000/BreenoMemory/database/memory_collections_page_1', await makePage(rawCollections, rawKey, 2)),
    new VirtualFile('2026-01-01-120000/BreenoMemory/database/memory_collection_mcr_page_1', await makePage(rawRelations, rawKey, 3))
  ];
}

test('full synthetic backup parses memories, collections and true collection relations', async () => {
  const parsed = await XiaobuParser.parseBackup(await buildSyntheticBackup());
  assert.equal(parsed.memories.length, 2);
  assert.equal(parsed.collections.length, 1);
  assert.deepEqual(parsed.memories.find((memory) => memory.memoryId === 'm-001').collectionNames, ['合成合集']);
  assert.equal(parsed.memories.find((memory) => memory.memoryId === 'm-001').title, '合成记忆一');
  assert.equal(parsed.meta.stats.memories, 2);
  assert.equal(parsed.meta.matchesReferenceVersions, true);
});

test('version mismatch is reported but never blocks parsing', async () => {
  const files = await buildSyntheticBackup({ app_version: '17.2.0', database_version: 51, coloros_version: '41' });
  const inspection = await XiaobuParser.inspectBackup(files);

  assert.equal(inspection.matchesReference, false);
  assert.deepEqual(
    inspection.checks.filter((item) => !item.ok).map((item) => item.name),
    ['AIMemory', 'database_version', 'ColorOS internal']
  );

  const parsed = await XiaobuParser.parseBackup(files);
  assert.equal(parsed.memories.length, 2);
  assert.equal(parsed.memories.find((memory) => memory.memoryId === 'm-001').title, '合成记忆一');
  assert.equal(parsed.meta.matchesReferenceVersions, false);
});

test('every reference version in the list is accepted, not just the first', async () => {
  const declared = XiaobuParser.REFERENCE_VERSIONS.appVersion;
  assert.ok(Array.isArray(declared) && declared.length > 1, '应声明多个已验证版本');

  for (const version of declared) {
    const files = await buildSyntheticBackup({ app_version: version });
    const inspection = await XiaobuParser.inspectBackup(files);
    assert.equal(inspection.matchesReference, true, `${version} 应被接受`);
    const check = inspection.checks.find((item) => item.name === 'AIMemory');
    assert.equal(check.ok, true);
    assert.equal(check.expected, declared.join(' / '));
  }
});

test('a listed version still fails loudly when the page key is wrong', async () => {
  // 兼容性放宽不等于放弃校验：格式或密钥不对时必须明确报错。
  const files = await buildSyntheticBackup({ app_version: '16.11.4' });
  assert.equal((await XiaobuParser.inspectBackup(files)).matchesReference, true);

  const wrongKey = Uint8Array.from({ length: 32 }, (_, index) => (index * 13 + 41) & 255);
  const idx = files.findIndex((file) => file.webkitRelativePath.endsWith('cryto_key'));
  files[idx] = new VirtualFile(
    files[idx].webkitRelativePath,
    await makeWrappedKey(SYNTHETIC_RANDOM, SYNTHETIC_IV, wrongKey)
  );

  await assert.rejects(() => XiaobuParser.parseBackup(files), /AES-GCM 认证失败/);
});

test('a wrong AES key still fails loudly instead of producing garbage', async () => {
  const files = await buildSyntheticBackup();
  // 保持外层 random/iv 不变（否则会在 CBC padding 阶段就失败），只替换被包裹的 AIMemory 密钥，
  // 这样才能验证内层 GCM 认证确实会拦住错误密钥。
  const wrongKey = Uint8Array.from({ length: 32 }, (_, index) => (index * 13 + 41) & 255);
  const idx = files.findIndex((file) => file.webkitRelativePath.endsWith('cryto_key'));
  files[idx] = new VirtualFile(
    files[idx].webkitRelativePath,
    await makeWrappedKey(SYNTHETIC_RANDOM, SYNTHETIC_IV, wrongKey)
  );

  await assert.rejects(() => XiaobuParser.parseBackup(files), /AES-GCM 认证失败/);
});
