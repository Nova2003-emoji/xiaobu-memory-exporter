(function (global) {
  'use strict';

  const FIXED_KEY_MATERIAL = 'rTMVTmZYZVMTTEGt-Backup_Restore-';
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder('utf-8', { fatal: true });

  function getCrypto() {
    if (global.crypto?.subtle) return global.crypto;
    if (typeof require === 'function') return require('node:crypto').webcrypto;
    throw new Error('当前环境不支持 Web Crypto API。请使用最新版 Chrome / Edge。');
  }

  function base64ToBytes(input) {
    const clean = String(input || '').replace(/\s+/g, '');
    if (typeof atob === 'function') {
      const binary = atob(clean);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    return Uint8Array.from(Buffer.from(clean, 'base64'));
  }

  function bytesToBase64(bytes) {
    if (typeof btoa === 'function') {
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
      }
      return btoa(binary);
    }
    return Buffer.from(bytes).toString('base64');
  }

  function highNibbleHex(bytes) {
    let out = '';
    for (const value of bytes) out += (value >>> 4).toString(16);
    return out;
  }

  async function deriveOuterKeyString(random) {
    if (!/^[A-Za-z0-9]{32}$/.test(random || '')) {
      throw new Error('备份 random 参数格式不符合已验证版本。');
    }
    const crypto = getCrypto();
    const hmacKey = await crypto.subtle.importKey(
      'raw',
      textEncoder.encode(random),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const digest = new Uint8Array(
      await crypto.subtle.sign('HMAC', hmacKey, textEncoder.encode(FIXED_KEY_MATERIAL))
    );
    // ColorOS 16.14.2 的实现不是常规 hex：每个 HMAC 字节仅保留高半字节，
    // 因而 32-byte digest 会变成 32 个 ASCII 十六进制字符，正好作为 AES-256 key。
    return highNibbleHex(digest);
  }

  async function decryptOuterCrytoKey(cipherBytes, random, ivText) {
    if (!(cipherBytes instanceof Uint8Array)) cipherBytes = new Uint8Array(cipherBytes);
    if (cipherBytes.length === 0 || cipherBytes.length % 16 !== 0) {
      throw new Error('cryto_key 长度不是 AES-CBC 块长度的整数倍。');
    }
    if (String(ivText || '').length < 16) throw new Error('备份 IV 参数长度不足 16 字节。');

    const crypto = getCrypto();
    const keyString = await deriveOuterKeyString(random);
    const aesKey = await crypto.subtle.importKey(
      'raw',
      textEncoder.encode(keyString),
      { name: 'AES-CBC' },
      false,
      ['decrypt']
    );
    const iv = textEncoder.encode(String(ivText)).subarray(0, 16);
    let plain;
    try {
      plain = new Uint8Array(
        await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, aesKey, cipherBytes)
      );
    } catch (error) {
      throw new Error('无法解开 ColorOS 外层密钥；备份版本可能不受支持。');
    }

    const base64Key = textDecoder.decode(plain).trim();
    if (!/^[A-Za-z0-9+/]{43}=$/.test(base64Key)) {
      throw new Error('外层解密完成，但结果不是 AIMemory 预期的 44 字节 Base64 密钥。');
    }
    const rawKey = base64ToBytes(base64Key);
    if (rawKey.length !== 32) throw new Error('AIMemory 密钥不是 256 bit。');
    return { rawKey, base64Key };
  }

  async function importAimemoryKey(rawKey) {
    const crypto = getCrypto();
    const bytes = rawKey instanceof Uint8Array ? rawKey : new Uint8Array(rawKey);
    if (bytes.length !== 32) throw new Error('AIMemory AES-GCM 密钥长度必须为 32 字节。');
    return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['decrypt']);
  }

  async function decryptAimemoryPayload(base64Text, cryptoKey) {
    const packed = base64ToBytes(base64Text);
    if (packed.length <= 32) throw new Error('AIMemory 加密页过短。');
    const iv = packed.subarray(0, 16);
    const ciphertextAndTag = packed.subarray(16);
    const crypto = getCrypto();
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, tagLength: 128 },
        cryptoKey,
        ciphertextAndTag
      );
      return textDecoder.decode(new Uint8Array(plain));
    } catch (error) {
      throw new Error('AIMemory AES-GCM 认证失败；页文件、密钥或版本不匹配。');
    }
  }

  const api = {
    FIXED_KEY_MATERIAL,
    base64ToBytes,
    bytesToBase64,
    deriveOuterKeyString,
    decryptOuterCrytoKey,
    importAimemoryKey,
    decryptAimemoryPayload
  };

  global.XiaobuCrypto = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
