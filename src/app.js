(function (global) {
  'use strict';

  let selectedFiles = null;
  let inspection = null;
  let currentDataset = null;
  let viewerInstance = null;

  const $ = (selector) => document.querySelector(selector);
  const screens = ['welcome', 'inspect', 'progress', 'library'];

  function showScreen(name) {
    for (const screen of screens) {
      const node = document.querySelector(`[data-screen="${screen}"]`);
      if (node) node.hidden = screen !== name;
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function setError(message) {
    const box = $('[data-role="error"]');
    box.textContent = message || '';
    box.hidden = !message;
  }

  function escapeHtml(value) {
    return global.XiaobuViewer?.escapeHtml(value) || String(value ?? '');
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
    return `${(value / 1024 ** 3).toFixed(1)} GB`;
  }

  function rootFolderName(files) {
    const first = Array.from(files || [])[0];
    return first?.webkitRelativePath?.split('/')[0] || first?.name || '所选文件夹';
  }

  async function handleFolder(files) {
    setError('');
    selectedFiles = files;
    if (!files?.length) return;
    showScreen('inspect');
    $('[data-role="inspect-title"]').textContent = `正在检查 ${rootFolderName(files)}…`;
    $('[data-role="inspect-body"]').innerHTML = '<div class="skeleton-lines"><i></i><i></i><i></i></div>';
    $('[data-role="parse-button"]').disabled = true;

    try {
      inspection = await global.XiaobuParser.inspectBackup(files);
      renderInspection();
    } catch (error) {
      inspection = null;
      $('[data-role="inspect-title"]').textContent = '没有识别到可解析的备份';
      $('[data-role="inspect-body"]').innerHTML = `<div class="notice danger">${escapeHtml(error.message || error)}</div>`;
    }
  }

  function renderInspection() {
    const info = inspection.appInfo;
    const fileInfo = inspection.files;
    const rows = inspection.checks.map((check) => `
      <div class="compat-row ${check.ok ? 'ok' : 'bad'}">
        <span>${check.ok ? '✓' : '×'}</span>
        <strong>${escapeHtml(check.name)}</strong>
        <em>${escapeHtml(check.actual || '未知')}</em>
        <small>${check.ok ? '已验证' : `当前工具只验证 ${escapeHtml(check.expected)}`}</small>
      </div>`).join('');

    $('[data-role="inspect-title"]').textContent = inspection.compatible ? '发现可解析的小布记忆备份' : '发现小布记忆备份，但版本尚未验证';
    $('[data-role="inspect-body"]').innerHTML = `
      <div class="inspect-grid">
        <div class="inspect-card"><span>记忆页</span><strong>${fileInfo.memoryPages.length}</strong><small>memory_page_*</small></div>
        <div class="inspect-card"><span>合集页</span><strong>${fileInfo.collectionPages.length}</strong><small>memory_collections_page_*</small></div>
        <div class="inspect-card"><span>关系页</span><strong>${fileInfo.relationPages.length}</strong><small>memory_collection_mcr_page_*</small></div>
        <div class="inspect-card"><span>附件归档</span><strong>${fileInfo.zipFile ? formatBytes(fileInfo.zipFile.size) : '未包含'}</strong><small>file_backup.zip</small></div>
      </div>
      <div class="compat-list">${rows}</div>
      <div class="backup-meta">
        <span>flavor</span><strong>${escapeHtml(info.flavor || '—')}</strong>
        <span>device type</span><strong>${escapeHtml(info.device_type || '—')}</strong>
        <span>备份数据不会上传</span><strong>仅当前浏览器读取</strong>
      </div>
      ${inspection.compatible ? '<div class="notice success">版本与当前已验证组合一致，可以开始本地解析。</div>' : '<div class="notice warning">为避免误解析，未知版本默认停止。可以在 GitHub 提交 issue 帮助适配。</div>'}
    `;
    $('[data-role="parse-button"]').disabled = !inspection.compatible;
  }

  async function startParse() {
    if (!selectedFiles || !inspection?.compatible) return;
    setError('');
    showScreen('progress');
    const progressBar = $('[data-role="progress-bar"]');
    const progressText = $('[data-role="progress-text"]');
    const progressPhase = $('[data-role="progress-phase"]');
    progressBar.style.width = '1%';
    progressText.textContent = '正在恢复 AIMemory 加密密钥…';
    progressPhase.textContent = '所有解密均在本地完成';

    try {
      currentDataset = await global.XiaobuParser.parseBackup(selectedFiles, (progress) => {
        const percent = progress.total ? Math.max(2, Math.round((progress.done / progress.total) * 100)) : 2;
        progressBar.style.width = `${percent}%`;
        progressText.textContent = `${progress.phase} · ${progress.current} / ${progress.phaseTotal}`;
        progressPhase.textContent = `总进度 ${progress.done} / ${progress.total}`;
      });
      progressBar.style.width = '100%';
      progressText.textContent = `完成：${currentDataset.meta.stats.memories} 条记忆，${currentDataset.meta.stats.collections} 个合集`;
      progressPhase.textContent = '正在打开离线记忆库…';
      setTimeout(() => openLibrary(currentDataset), 250);
    } catch (error) {
      showScreen('inspect');
      setError(error.message || String(error));
    }
  }

  function loadDemo() {
    currentDataset = JSON.parse(JSON.stringify(global.XIAOBU_DEMO_DATA));
    openLibrary(currentDataset);
  }

  function openLibrary(dataset) {
    showScreen('library');
    const root = $('[data-role="viewer-root"]');
    root.innerHTML = '';
    viewerInstance = global.XiaobuViewer.createViewer(root, dataset, { onBack: backToImporter });
    const backButton = root.querySelector('[data-role="back"]');
    if (backButton) backButton.addEventListener('click', backToImporter);
    $('[data-role="library-demo-badge"]').hidden = !dataset.meta?.demo;
    $('[data-role="export-json"]').disabled = false;
    $('[data-role="export-html"]').disabled = false;
  }

  function backToImporter() {
    showScreen(selectedFiles?.length ? 'inspect' : 'welcome');
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function timestampName() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  }

  function exportJson() {
    if (!currentDataset) return;
    const clean = {
      meta: currentDataset.meta,
      memories: currentDataset.memories,
      collections: currentDataset.collections
    };
    downloadBlob(new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json;charset=utf-8' }), `xiaobu-memories-${timestampName()}.json`);
  }

  function exportHtml() {
    if (!currentDataset) return;
    const html = global.XiaobuViewer.portableHtml(currentDataset);
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `xiaobu-memory-library-${timestampName()}.html`);
  }

  function copyBackupPath() {
    const text = '内部存储/Android/data/com.coloros.backuprestore/Backup/Data';
    navigator.clipboard?.writeText(text).then(() => {
      const button = $('[data-role="copy-path"]');
      const old = button.textContent;
      button.textContent = '已复制';
      setTimeout(() => { button.textContent = old; }, 1200);
    }).catch(() => {});
  }

  function bind() {
    const folderInput = $('[data-role="folder-input"]');
    folderInput.addEventListener('change', (event) => handleFolder(event.target.files));
    document.querySelectorAll('[data-action="choose-folder"]').forEach((button) => button.addEventListener('click', () => folderInput.click()));
    $('[data-role="parse-button"]').addEventListener('click', startParse);
    document.querySelectorAll('[data-action="demo"]').forEach((button) => button.addEventListener('click', loadDemo));
    $('[data-role="inspect-back"]').addEventListener('click', () => showScreen('welcome'));
    $('[data-role="copy-path"]').addEventListener('click', copyBackupPath);
    $('[data-role="export-json"]').addEventListener('click', exportJson);
    $('[data-role="export-html"]').addEventListener('click', exportHtml);
  }

  document.addEventListener('DOMContentLoaded', () => {
    bind();
    showScreen('welcome');
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
