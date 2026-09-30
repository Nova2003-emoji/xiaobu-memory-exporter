# 小布记忆导出助手 / Xiaobu Memory Exporter

一个 **local-first、纯静态 HTML/JavaScript** 的小布记忆导出工具：从 OPPO/ColorOS 官方本地备份开始，在浏览器本地恢复 AIMemory 记忆、合集关系和附件索引，并导出可搜索 JSON 或单文件离线 HTML。

> 非 OPPO 官方产品。只处理用户自己创建、自己选择的本地备份。项目不包含 OPPO APK、用户备份、用户记忆、附件、`cryto_key` 或任何真实 AES 密钥。

## 在线使用

GitHub Pages：

`https://xiaosong123413-del.github.io/xiaobu-memory-exporter/`

也可以直接下载仓库后双击 `index.html`。推荐最新版 Chrome / Edge。

## 使用流程

1. 在 OPPO 手机进入 **备份与迁移 → 本地备份 → 新建备份**。
2. 只选择系统备份项目中的 **小布记忆**，完成本地备份。
3. 将完整的时间戳目录复制到电脑，例如：

   ```text
   内部存储/Android/data/com.coloros.backuprestore/Backup/Data/2026-08-08-155929/
   ```

4. 打开本工具，点击 **选择电脑上的备份文件夹**，选择上面的时间戳目录。
5. 工具先检查目录结构是否完整；确认后点击 **开始本地解析**。
6. 在网页中搜索/筛选记忆，或导出：
   - `xiaobu-memories-*.json`
   - `xiaobu-memory-library-*.html`（单文件、离线可搜索）

不要只选择 `BreenoMemory/`：ColorOS 外层解密参数位于时间戳目录根部的 `backup_config_new.db`。

## 版本兼容性

下列组合已端到端验证：

| 组件 | 已验证版本 |
|---|---|
| AIMemory (`com.oplus.aimemory`) | `16.10.1`、`16.11.4` |
| AIMemory `database_version` | `46` |
| Android | `16` |
| ColorOS internal | `38`（测试设备对应 ColorOS 16.1） |
| Backup & Restore / Clone Phone (`com.coloros.backuprestore`) | `16.14.2`（仅记录，见下） |

> `16.11.4` 的实测规模：725 条记忆、18 个合集、2979 条合集关系、2196 条附件记录，解析耗时约 5 秒。

表中前四项会逐项自动对照当前备份。最后一项 `Backup & Restore` **不会被自动校验** —— `app_info.json` 中不存在该字段，工具无法读取，只能靠用户自行确认。若你的 Backup & Restore 版本与此不同，通常不影响解析结果。

**版本不匹配不会阻止解析。** 工具会在检查页把当前版本与上表逐项对照并标出差异，仅作参考。

这样设计是安全的：AIMemory 每个记忆页都由 AES-256-GCM 的 authentication tag 保护，密钥或格式不匹配时会直接抛错并停止，不会像某些工具那样把随机可读字节当成解密成功。所以版本差异最坏的结果是「明确失败」，而不是「产出错误数据」。

欢迎提交 issue，附上 **不含私人内容** 的 `app_info.json` 版本字段和目录结构，用于把新版本加入已验证列表。

## 隐私模型

- 无上传 API。
- 备份文件由 `<input type="file" webkitdirectory>` 在用户明确授权后读取。
- AES 解密使用浏览器 Web Crypto API。
- 恢复出的 AIMemory AES-256 key 只存在于当前页面内存中。
- 导出的 JSON / HTML **不会写入密钥**。
- GitHub 仓库只提供合成 Demo，不包含任何真实用户记忆。
- 附件 ZIP 采用懒索引：浏览器读取 ZIP 中央目录，用户点开附件时才解压对应条目，避免一次把数百 MB 文件全部展开进内存。

## 已还原的数据链路

```text
ColorOS 官方本地备份
        │
        ├─ backup_config_new.db
        │      └─ EncryptInfo.random + EncryptInfo.iv
        │
        ├─ BreenoMemory/BreenoMemorySecure/cryto_key
        │      └─ ColorOS AES-CBC 外层
        │
        ├─ BreenoMemory/database/memory_page_*
        │      └─ AIMemory AES-256-GCM → JSON
        │
        ├─ memory_collections_page_*
        │      └─ 合集元数据
        │
        ├─ memory_collection_mcr_page_*
        │      └─ collectionId ↔ memoryId 真实关系
        │
        ├─ memory_attach_info_page_*
        │      └─ 附件元数据，与 memory_page_* 内嵌的附件合并去重
        │
        └─ BreenoMemory/files/file_backup.zip
               └─ Attachment / DataCenter / MemoryCache / ...
```

备份里还可能存在当前工具不读取的页面，例如 `bills_page_*` 和 `memory_deepseek_*`。它们不影响记忆解析，导出结果中不包含这些内容。

### ColorOS 外层

在已验证的 Backup & Restore `16.14.2` 中：

- 文件算法：`AES/CBC/PKCS5Padding`
- `random`：32 位字母数字字符串
- 固定材料：由 APK 内置 `BackupRestoreFile` 指定位置字符与 `BackupRestoreFile_salt` 构造
- 密钥派生：`HmacSHA256(fixedMaterial, key=random)` 后，ColorOS 实现对每个 digest byte 只保留高半字节，最终得到 32 个 ASCII 十六进制字符作为 AES-256 key
- IV：持久化 `iv` 十进制字符串的前 16 个 UTF-8 bytes
- 解开 `cryto_key` 后得到 44 字节 Base64，解码为 AIMemory 32-byte AES key

### AIMemory 内层

已验证 `memory_page_*` 等页面格式：

```text
Base64 decode
→ 前 16 bytes = GCM IV
→ 剩余 = ciphertext + 128-bit authentication tag
→ AES-256-GCM
→ UTF-8 JSON
```

解析时每页都依赖 GCM authentication tag；认证失败会停止，不会把随机可读字符当成成功结果。

## 附件

`BreenoMemory/files/file_backup.zip` 在已验证版本中是标准 ZIP，不需要第二层 AIMemory 解密。工具会建立中央目录索引，并按记录中的 `path` / `uri` 尝试映射：

```text
DataCenter/...
Attachment/...
MemoryCache/...
```

支持 ZIP `stored`（method 0）和 `deflate`（method 8）。Deflate 预览依赖 Chromium 的 `DecompressionStream('deflate-raw')`。

`resolve()` 可识别以下路径形式：

```text
Attachment/photo.png                                        直接命中
/storage/emulated/0/.../com.oplus.aimemory/files/Attachment/x  取 /files/ 之后的后缀
content://com.oplus.aimemory.dataCenterFileProvider/DataCenter/x  去掉 provider 前缀
```

### 附件的已知限制

实测一份 970 MB 的 `file_backup.zip`（2292 条中央目录记录）：

- 2196 条附件记录中，725 条的 `path` 与 `uri` **均为空**，是占位记录而非真实文件引用。
- 剩余 1471 条有真实路径引用的附件中，1464 条能在 ZIP 中定位（约 **99.5%**）。
- 未能定位的条目会在详情页显示「在附件 ZIP 中未找到对应文件」，不影响其余数据。

其他限制：

- **不支持 ZIP64。** 条目数超过 65535 或单文件超过 4 GB 的 ZIP 无法索引。
- **单条解压无大小上限。** 点击预览会把该条目完整解压进内存，超大视频附件可能耗尽内存。此时请改用「保存」链接下载，或先用系统工具单独解压该 ZIP。

导出的 **单文件 HTML 默认不嵌入附件二进制**，避免一个 HTML 膨胀到数百 MB；它保留文本、摘要、标签、合集和元数据。

## 本地开发

不需要构建步骤。

```bash
npm test
npm run serve
```

打开：

```text
http://127.0.0.1:18766/
```

测试全部使用合成密钥、合成加密页和合成记忆，不依赖私人备份。

`npm run serve` 使用 `python -m http.server 18766`。若系统没有 Python，可用任意静态服务器替代，例如：

```bash
npx serve -l 18766
```

## 常见问题

**「没有识别到完整的小布记忆官方备份，缺少：…」**

选择目录层级选错了。需要选中 `Backup/Data/<时间戳>/` 这一层，它同时包含 `backup_config_new.db` 和 `BreenoMemory/`。只选 `BreenoMemory/` 会缺少解密外层所需的参数。

**「AIMemory AES-GCM 认证失败；页文件、密钥或版本不匹配。」**

这说明确实读到了加密页，但用当前解出的密钥打不开它。可能是 `backup_config_new.db` 中存在多组历史 `EncryptInfo`（多次本地备份后 SQLite 空闲页会残留旧值），工具无法唯一确定该用哪一组；也可能是该备份的格式或密钥派生方式与当前实现不同。工具在这两种情况下都会拒绝猜测并报错，不会输出错误数据。请附上不含私人内容的 `app_info.json` 版本字段与目录结构提交 issue。

**点击「导出 JSON / 导出单文件 HTML」没有反应，或下载到的文件打不开**

某些下载管理器（如 IDM）的浏览器扩展会拦截页面触发的下载。工具本身不发起任何网络请求，导出走的是浏览器本地 `Blob` 下载。遇到这种情况，在该软件设置中把 `localhost` / `127.0.0.1` 加入不接管的列表，或临时关闭其浏览器集成。

**提示需要最新版 Chrome / Edge**

附件预览依赖 `DecompressionStream('deflate-raw')`，解密依赖 Web Crypto 的 `AES-GCM` / `HMAC`。Chrome 103+、Firefox 113+、Safari 16.4+ 均可满足；更旧的浏览器能解析记忆文本，但无法预览 deflate 附件。本项目的测试与实测均在 Chromium 上完成。

## 项目结构

```text
index.html
styles.css
src/
  crypto.js       # ColorOS/AIMemory crypto
  parser.js       # 备份识别、解密、标准化、合集关系
  zip.js          # 附件 ZIP 懒索引与按需解压
  viewer.js       # 搜索/筛选/详情/离线 HTML 导出
  app.js          # 导入向导与流程状态
  demo.js         # 纯合成公开 Demo
tests/
  core.test.js
```

## 设计边界

- 不 Root。
- 不恢复备份。
- 不修改手机或原始备份。
- 不尝试绕过用户文件授权。
- 不承诺所有 ColorOS / OPPO / OnePlus / realme 版本通用。
- 不分发 OPPO 的 APK 或 APK assets。

## 参考

- OPPO 官方支持页面：ColorOS 本地备份与恢复说明（ColorOS 12+ 的本地备份位于 `Android/data/com.coloros.backuprestore/Backup/Data`）。
- MDN Web Crypto API：浏览器内 `AES-CBC`、`AES-GCM`、`HMAC`。
- MDN File API / directory file input：由用户在本地显式选择备份目录。

## License

MIT
