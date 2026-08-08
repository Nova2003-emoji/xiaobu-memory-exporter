(function (global) {
  'use strict';

  const PAGE_SIZE = 60;
  const dayMs = 86_400_000;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function unique(values) {
    return Array.from(new Set((values || []).filter(Boolean)));
  }

  function countBy(values) {
    const counts = {};
    for (const value of values) {
      const key = String(value || '').trim();
      if (key) counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }

  function humanDate(timestamp) {
    if (!timestamp) return '未知时间';
    try {
      return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(timestamp));
    } catch (error) {
      return '未知时间';
    }
  }

  function firstChar(value) {
    return String(value || '记').trim()[0] || '记';
  }

  function sourceColor(source) {
    const palette = ['#58745f', '#796c59', '#5f7286', '#80665f', '#6b6d88', '#667c70', '#877456', '#657d7a'];
    let hash = 0;
    for (const char of String(source || '')) hash += char.charCodeAt(0);
    return palette[Math.abs(hash) % palette.length];
  }

  function searchable(memory) {
    return [
      memory.title,
      memory.summary,
      memory.dataText,
      memory.dataTextCleanup,
      memory.appName,
      ...(memory.labels || []),
      ...(memory.keywords || []),
      ...(memory.collectionNames || [])
    ].join('\n').toLowerCase();
  }

  function getAllTags(memory) {
    return unique([...(memory.keywords || []), ...(memory.labels || [])]);
  }

  async function buildAttachmentRuntime(dataset) {
    if (!dataset?.attachmentArchive || !global.XiaobuZip) return null;
    try {
      return await global.XiaobuZip.indexZip(dataset.attachmentArchive);
    } catch (error) {
      console.warn('附件 ZIP 索引失败：', error);
      return null;
    }
  }

  function createViewer(root, dataset, options = {}) {
    if (!root) throw new Error('缺少记忆库容器。');
    const memories = Array.isArray(dataset?.memories) ? dataset.memories : [];
    const collections = Array.isArray(dataset?.collections) ? dataset.collections : [];
    const state = {
      query: '', source: null, collection: null, tag: null, quick: 'all', view: 'grid',
      limit: PAGE_SIZE, selected: null, tab: 'summary', collectionsExpanded: false
    };
    let zipIndex = null;
    let disposedUrls = [];

    root.innerHTML = viewerMarkup(options);
    const q = (selector) => root.querySelector(selector);
    const sourceCounts = countBy(memories.map((memory) => memory.appName || '未知来源'));
    const collectionCounts = countBy(memories.flatMap((memory) => memory.collectionNames || []));
    const tagCounts = countBy(memories.flatMap(getAllTags));
    const drawer = q('[data-role="drawer"]');
    const overlay = q('[data-role="overlay"]');
    const searchInput = q('[data-role="search"]');
    const grid = q('[data-role="grid"]');

    buildAttachmentRuntime(dataset).then((value) => { zipIndex = value; });

    function filteredMemories() {
      const query = state.query.trim().toLowerCase();
      const now = Date.now();
      return memories.filter((memory) => {
        if (query && !searchable(memory).includes(query)) return false;
        if (state.source && (memory.appName || '未知来源') !== state.source) return false;
        if (state.collection && !(memory.collectionNames || []).includes(state.collection)) return false;
        if (state.tag && !getAllTags(memory).includes(state.tag)) return false;
        if (state.quick === 'recent' && !(memory.createdTime && now - memory.createdTime < 7 * dayMs)) return false;
        if (state.quick === 'attachments' && !(memory.attachmentCount > 0)) return false;
        return true;
      }).sort((a, b) => (b.createdTime || 0) - (a.createdTime || 0));
    }

    function navButton(label, count, active, callback) {
      const button = document.createElement('button');
      button.className = 'viewer-nav-button' + (active ? ' active' : '');
      button.innerHTML = `<span class="viewer-dot"></span><span>${escapeHtml(label)}</span><span class="viewer-count">${count ?? ''}</span>`;
      button.addEventListener('click', callback);
      return button;
    }

    function resetLimit() {
      state.limit = PAGE_SIZE;
    }

    function renderSidebar() {
      const quick = q('[data-role="quick-filters"]');
      quick.innerHTML = '';
      const quickItems = [
        ['all', '全部记忆', memories.length],
        ['recent', '最近 7 天', memories.filter((memory) => memory.createdTime && Date.now() - memory.createdTime < 7 * dayMs).length],
        ['attachments', '包含附件', memories.filter((memory) => memory.attachmentCount > 0).length]
      ];
      for (const [key, label, count] of quickItems) {
        quick.appendChild(navButton(label, count, state.quick === key, () => {
          state.quick = key;
          state.source = state.collection = state.tag = null;
          resetLimit();
          renderAll();
        }));
      }

      const sourceBox = q('[data-role="source-filters"]');
      sourceBox.innerHTML = '';
      for (const [name, count] of Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
        sourceBox.appendChild(navButton(name, count, state.source === name, () => {
          state.source = state.source === name ? null : name;
          state.quick = 'all'; resetLimit(); renderAll();
        }));
      }

      const collectionBox = q('[data-role="collection-filters"]');
      collectionBox.innerHTML = '';
      const collectionEntries = Object.entries(collectionCounts).sort((a, b) => b[1] - a[1]);
      const visibleCollections = state.collectionsExpanded ? collectionEntries : collectionEntries.slice(0, 8);
      for (const [name, count] of visibleCollections) {
        collectionBox.appendChild(navButton(name, count, state.collection === name, () => {
          state.collection = state.collection === name ? null : name;
          state.quick = 'all'; resetLimit(); renderAll();
        }));
      }
      const more = q('[data-role="more-collections"]');
      more.hidden = collectionEntries.length <= 8;
      more.textContent = state.collectionsExpanded ? '收起合集' : '显示更多合集';

      const tagsBox = q('[data-role="tags"]');
      tagsBox.innerHTML = '';
      for (const [tag, count] of Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 22)) {
        const button = document.createElement('button');
        button.className = 'viewer-tag-button' + (state.tag === tag ? ' active' : '');
        button.textContent = `${tag} · ${count}`;
        button.addEventListener('click', () => {
          state.tag = state.tag === tag ? null : tag;
          state.quick = 'all'; resetLimit(); renderAll();
        });
        tagsBox.appendChild(button);
      }
    }

    function createCard(memory) {
      const card = document.createElement('article');
      card.className = 'viewer-card';
      const source = memory.appName || '未知来源';
      const tags = getAllTags(memory).slice(0, 4);
      const summary = String(memory.summary || memory.dataText || '暂无摘要').replace(/#{1,6}\s?/g, '').trim();
      card.innerHTML = `
        <div class="viewer-card-head">
          <span class="viewer-source"><span class="viewer-source-badge" style="background:${sourceColor(source)}">${escapeHtml(firstChar(source))}</span>${escapeHtml(source)}</span>
          <span class="viewer-date">${escapeHtml(humanDate(memory.createdTime))}</span>
        </div>
        <h3>${escapeHtml(memory.title || '未命名记忆')}</h3>
        <div class="viewer-summary">${escapeHtml(summary)}</div>
        <div class="viewer-chips">
          ${tags.map((tag) => `<span class="viewer-chip">${escapeHtml(tag)}</span>`).join('')}
          ${(memory.collectionNames || []).slice(0, 2).map((name) => `<span class="viewer-chip collection">⌁ ${escapeHtml(name)}</span>`).join('')}
        </div>
        ${memory.attachmentCount ? `<span class="viewer-attachment-mark">附件 ${memory.attachmentCount}</span>` : ''}
      `;
      card.addEventListener('click', () => openDetail(memory));
      return card;
    }

    function renderCards() {
      const list = filteredMemories();
      grid.className = 'viewer-grid' + (state.view === 'list' ? ' list' : '');
      grid.innerHTML = '';
      for (const memory of list.slice(0, state.limit)) grid.appendChild(createCard(memory));
      if (!list.length) {
        grid.innerHTML = '<div class="viewer-empty"><strong>没有找到匹配的记忆</strong><span>换一个关键词，或者清除筛选。</span></div>';
      }
      const loadMore = q('[data-role="load-more"]');
      loadMore.hidden = list.length <= state.limit;
      q('[data-role="result-count"]').textContent = `显示 ${Math.min(state.limit, list.length)} / ${list.length} 条`;
      renderActiveFilters();
    }

    function renderStats() {
      q('[data-role="stat-total"]').textContent = memories.length;
      q('[data-role="stat-sources"]').textContent = Object.keys(sourceCounts).length;
      q('[data-role="stat-tags"]').textContent = Object.keys(tagCounts).length;
      q('[data-role="stat-collections"]').textContent = collections.length || Object.keys(collectionCounts).length;
    }

    function renderActiveFilters() {
      const box = q('[data-role="active-filters"]');
      box.innerHTML = '';
      const items = [
        ['来源', state.source, () => { state.source = null; }],
        ['合集', state.collection, () => { state.collection = null; }],
        ['标签', state.tag, () => { state.tag = null; }],
        ['搜索', state.query, () => { state.query = ''; searchInput.value = ''; }]
      ];
      for (const [kind, value, clear] of items) {
        if (!value) continue;
        const pill = document.createElement('span');
        pill.className = 'viewer-active-filter';
        pill.innerHTML = `${escapeHtml(kind)}：${escapeHtml(value)} <button aria-label="清除">×</button>`;
        pill.querySelector('button').addEventListener('click', () => { clear(); resetLimit(); renderAll(); });
        box.appendChild(pill);
      }
    }

    function renderAll() {
      renderSidebar();
      renderCards();
      renderStats();
    }

    function closeDetail() {
      drawer.classList.remove('open');
      overlay.classList.remove('show');
      for (const url of disposedUrls) URL.revokeObjectURL(url);
      disposedUrls = [];
    }

    function detailChips(values) {
      return unique(values).map((value) => `<span class="viewer-chip">${escapeHtml(value)}</span>`).join('');
    }

    function openDetail(memory) {
      state.selected = memory;
      state.tab = 'summary';
      q('[data-role="detail-source"]').textContent = `${memory.appName || '未知来源'} · ${humanDate(memory.createdTime)}`;
      q('[data-role="detail-title"]').textContent = memory.title || '未命名记忆';
      const origin = q('[data-role="origin-link"]');
      origin.hidden = !memory.deeplink;
      origin.href = memory.deeplink || '#';
      q('[data-role="detail-meta"]').innerHTML = detailChips([...(memory.keywords || []), ...(memory.labels || []), ...(memory.collectionNames || [])]);
      root.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === 'summary'));
      renderDetailBody();
      drawer.classList.add('open');
      overlay.classList.add('show');
    }

    async function renderAttachment(button, attachment) {
      if (!zipIndex) {
        button.textContent = dataset.attachmentArchive ? '附件索引尚未就绪，请稍后重试' : '本次未导入附件 ZIP';
        button.disabled = true;
        return;
      }
      const entry = zipIndex.resolve(attachment.path || attachment.uri);
      if (!entry) {
        button.textContent = '在附件 ZIP 中未找到对应文件';
        button.disabled = true;
        return;
      }
      button.disabled = true;
      button.textContent = '正在读取附件…';
      try {
        const blob = await global.XiaobuZip.extractEntry(zipIndex, entry);
        const url = URL.createObjectURL(blob);
        disposedUrls.push(url);
        const preview = document.createElement('div');
        preview.className = 'viewer-attachment-preview';
        const lower = entry.name.toLowerCase();
        if (/\.(png|jpe?g|webp|gif|bmp|avif)$/.test(lower)) preview.innerHTML = `<img src="${url}" alt="附件预览">`;
        else if (/\.(mp3|m4a|wav|aac|ogg)$/.test(lower)) preview.innerHTML = `<audio controls src="${url}"></audio>`;
        else if (/\.(mp4|webm|mov)$/.test(lower)) preview.innerHTML = `<video controls src="${url}"></video>`;
        else preview.innerHTML = `<a class="viewer-file-link" href="${url}" download="${escapeHtml(entry.name.split('/').pop())}">保存 ${escapeHtml(entry.name.split('/').pop())}</a>`;
        button.replaceWith(preview);
      } catch (error) {
        button.disabled = false;
        button.textContent = error.message || '附件读取失败';
      }
    }

    function attachmentsMarkup(memory) {
      if (!(memory.attachments || []).length) return '';
      return `<div class="viewer-detail-block"><h4>附件</h4><div data-role="attachment-list" class="viewer-attachment-list">${memory.attachments.map((attachment, index) => `
        <button class="viewer-attachment-button" data-attachment-index="${index}">
          <span>${escapeHtml(attachment.caption || attachment.path?.split('/').pop() || attachment.uri?.split('/').pop() || `附件 ${index + 1}`)}</span>
          <small>${attachment.size ? `${Math.round(attachment.size / 1024)} KB` : '点击预览'}</small>
        </button>`).join('')}</div></div>`;
    }

    function renderDetailBody() {
      const memory = state.selected;
      if (!memory) return;
      const body = q('[data-role="detail-body"]');
      if (state.tab === 'summary') {
        body.innerHTML = `
          <div class="viewer-detail-block"><h4>小布整理</h4><div class="viewer-detail-text">${escapeHtml(memory.summary || '暂无摘要')}</div></div>
          ${(memory.keywords || []).length ? `<div class="viewer-detail-block"><h4>关键词</h4><div class="viewer-chips">${detailChips(memory.keywords)}</div></div>` : ''}
          ${(memory.collectionNames || []).length ? `<div class="viewer-detail-block"><h4>所在合集</h4><div class="viewer-chips">${detailChips(memory.collectionNames)}</div></div>` : ''}
          ${attachmentsMarkup(memory)}
        `;
        body.querySelectorAll('[data-attachment-index]').forEach((button) => {
          const attachment = memory.attachments[Number(button.dataset.attachmentIndex)];
          button.addEventListener('click', () => renderAttachment(button, attachment));
        });
      } else if (state.tab === 'text') {
        body.innerHTML = `<div class="viewer-detail-block"><h4>OCR / 原始正文</h4><div class="viewer-detail-text">${escapeHtml(memory.dataText || memory.dataTextCleanup || '暂无正文')}</div></div>`;
      } else {
        body.innerHTML = `<div class="viewer-meta-table">
          <div>来源</div><div>${escapeHtml(memory.appName || '—')}</div>
          <div>创建时间</div><div>${escapeHtml(memory.createdTime ? new Date(memory.createdTime).toLocaleString('zh-CN') : '—')}</div>
          <div>记忆 ID</div><div>${escapeHtml(memory.memoryId || '—')}</div>
          <div>包名</div><div>${escapeHtml(memory.packageName || '—')}</div>
          <div>场景</div><div>${escapeHtml(memory.sceneName || '—')}</div>
          <div>附件</div><div>${memory.attachmentCount || 0}</div>
          <div>原链接</div><div>${memory.deeplink ? `<a href="${escapeHtml(memory.deeplink)}" target="_blank" rel="noreferrer">${escapeHtml(memory.deeplink)}</a>` : '—'}</div>
        </div>`;
      }
    }

    searchInput.addEventListener('input', (event) => { state.query = event.target.value; resetLimit(); renderCards(); });
    q('[data-role="grid-view"]').addEventListener('click', () => {
      state.view = 'grid'; q('[data-role="grid-view"]').classList.add('active'); q('[data-role="list-view"]').classList.remove('active'); renderCards();
    });
    q('[data-role="list-view"]').addEventListener('click', () => {
      state.view = 'list'; q('[data-role="list-view"]').classList.add('active'); q('[data-role="grid-view"]').classList.remove('active'); renderCards();
    });
    q('[data-role="reset"]').addEventListener('click', () => {
      Object.assign(state, { query: '', source: null, collection: null, tag: null, quick: 'all', limit: PAGE_SIZE });
      searchInput.value = ''; renderAll();
    });
    q('[data-role="more-collections"]').addEventListener('click', () => { state.collectionsExpanded = !state.collectionsExpanded; renderSidebar(); });
    q('[data-role="load-more"]').addEventListener('click', () => { state.limit += PAGE_SIZE; renderCards(); });
    q('[data-role="close-drawer"]').addEventListener('click', closeDetail);
    overlay.addEventListener('click', closeDetail);
    root.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => {
      state.tab = button.dataset.tab;
      root.querySelectorAll('[data-tab]').forEach((item) => item.classList.toggle('active', item === button));
      renderDetailBody();
    }));
    root.addEventListener('keydown', (event) => {
      if (event.key === '/' && document.activeElement !== searchInput) { event.preventDefault(); searchInput.focus(); }
      if (event.key === 'Escape') closeDetail();
    });

    renderAll();
    return { state, render: renderAll, closeDetail };
  }

  function viewerMarkup(options) {
    const showBack = Boolean(options.onBack);
    return `
      <div class="viewer-shell">
        <aside class="viewer-sidebar">
          <div class="viewer-brand">
            <div class="viewer-kicker">PERSONAL MEMORY LIBRARY</div>
            <h2>小布记忆</h2>
            <p>把收藏、截图和摘记重新变成可搜索的个人资料库。</p>
            ${showBack ? '<button class="viewer-back" data-role="back">← 返回导入器</button>' : ''}
          </div>
          <section><div class="viewer-section-title">浏览</div><div data-role="quick-filters"></div></section>
          <section><div class="viewer-section-title">来源</div><div data-role="source-filters"></div></section>
          <section><div class="viewer-section-title">合集</div><div data-role="collection-filters"></div><button class="viewer-side-more" data-role="more-collections">显示更多合集</button></section>
          <section><div class="viewer-section-title">高频标签</div><div class="viewer-tag-cloud" data-role="tags"></div></section>
        </aside>
        <main class="viewer-main">
          <header class="viewer-topbar">
            <div class="viewer-search"><span>⌕</span><input name="memorySearch" data-role="search" placeholder="搜索标题、摘要、正文、标签、来源…"><kbd>/</kbd></div>
            <button class="viewer-tool active" data-role="grid-view">▦ 卡片</button>
            <button class="viewer-tool" data-role="list-view">☷ 列表</button>
            <button class="viewer-tool" data-role="reset">重置</button>
          </header>
          <div class="viewer-stats">
            <div><strong data-role="stat-total">0</strong><span>全部记忆</span></div>
            <div><strong data-role="stat-sources">0</strong><span>内容来源</span></div>
            <div><strong data-role="stat-tags">0</strong><span>标签</span></div>
            <div><strong data-role="stat-collections">0</strong><span>合集</span></div>
            <div class="viewer-stat-spacer"></div><div class="viewer-result-meta"><div data-role="active-filters"></div><span data-role="result-count"></span></div>
          </div>
          <div class="viewer-content"><div class="viewer-grid" data-role="grid"></div><button class="viewer-load-more" data-role="load-more" hidden>继续加载</button></div>
        </main>
        <div class="viewer-overlay" data-role="overlay"></div>
        <aside class="viewer-drawer" data-role="drawer">
          <div class="viewer-drawer-top">
            <div class="viewer-drawer-actions"><button data-role="close-drawer">×</button><a data-role="origin-link" target="_blank" rel="noreferrer">打开原页面 ↗</a></div>
            <div class="viewer-detail-source" data-role="detail-source"></div><h2 data-role="detail-title"></h2><div class="viewer-chips" data-role="detail-meta"></div>
          </div>
          <div class="viewer-tabs"><button class="active" data-tab="summary">摘要</button><button data-tab="text">原文</button><button data-tab="meta">信息</button></div>
          <div class="viewer-detail-body" data-role="detail-body"></div>
        </aside>
      </div>`;
  }

  function portableHtml(dataset) {
    const safeDataset = { meta: dataset.meta || {}, memories: dataset.memories || [], collections: dataset.collections || [] };
    const json = JSON.stringify(safeDataset).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>小布记忆 · 离线资料库</title><style>
      *{box-sizing:border-box}body{margin:0;background:#f6f6f3;color:#20231f;font-family:Segoe UI,Microsoft YaHei UI,sans-serif}header{position:sticky;top:0;z-index:2;padding:18px 5vw;background:rgba(246,246,243,.95);border-bottom:1px solid #e2e4dd;backdrop-filter:blur(14px)}header h1{margin:0 0 12px;font-size:22px}input{width:min(700px,100%);height:44px;border:1px solid #dfe2da;border-radius:12px;padding:0 14px;background:white;font:inherit}.meta{font-size:12px;color:#747970;margin-top:8px}.grid{padding:22px 5vw 60px;display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:12px}.card{background:white;border:1px solid #e2e4dd;border-radius:15px;padding:16px;cursor:pointer}.card:hover{border-color:#bbc5bb}.card small{color:#7a8077}.card h2{font-size:15px;line-height:1.5}.card p{font-size:12px;line-height:1.7;color:#686e66;white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}.chips{display:flex;gap:5px;flex-wrap:wrap}.chip{font-size:10px;padding:4px 7px;border-radius:999px;background:#eff1ec;color:#6c736a}.overlay{display:none;position:fixed;inset:0;background:#0003;z-index:4}.overlay.open{display:block}.detail{position:absolute;right:0;top:0;width:min(560px,94vw);height:100%;overflow:auto;background:white;padding:24px;box-shadow:-20px 0 60px #0002}.detail button{float:right;border:0;border-radius:8px;width:34px;height:34px}.detail h2{font-size:22px;line-height:1.5}.body{font-size:13px;line-height:1.85;white-space:pre-wrap;word-break:break-word}.empty{padding:60px;text-align:center;color:#777}@media(max-width:650px){.grid{grid-template-columns:1fr;padding:14px}.detail{width:100%}}
      </style></head><body><header><h1>小布记忆 · 离线资料库</h1><input id="q" placeholder="搜索标题、摘要、正文、标签、合集…"><div class="meta" id="meta"></div></header><main class="grid" id="grid"></main><div class="overlay" id="overlay"><article class="detail"><button id="close">×</button><small id="source"></small><h2 id="title"></h2><div class="chips" id="chips"></div><hr><div class="body" id="body"></div></article></div><script>const DATA=${json};const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const grid=document.getElementById('grid'),input=document.getElementById('q'),overlay=document.getElementById('overlay');function hay(m){return [m.title,m.summary,m.dataText,m.appName,...(m.labels||[]),...(m.keywords||[]),...(m.collectionNames||[])].join(' ').toLowerCase()}function render(){const q=input.value.trim().toLowerCase();const list=(DATA.memories||[]).filter(m=>!q||hay(m).includes(q));document.getElementById('meta').textContent='显示 '+list.length+' / '+(DATA.memories||[]).length+' 条 · 导出时间 '+new Date(DATA.meta?.parsedAt||Date.now()).toLocaleString('zh-CN');grid.innerHTML=list.map(m=>'<article class="card" data-id="'+esc(m.memoryId)+'"><small>'+esc(m.appName||'未知来源')+' · '+(m.createdTime?new Date(m.createdTime).toLocaleDateString('zh-CN'):'')+'</small><h2>'+esc(m.title||'未命名记忆')+'</h2><p>'+esc(m.summary||m.dataText||'暂无摘要')+'</p><div class="chips">'+[...(m.keywords||[]),...(m.collectionNames||[])].slice(0,5).map(t=>'<span class="chip">'+esc(t)+'</span>').join('')+'</div></article>').join('')||'<div class="empty">没有匹配结果</div>';grid.querySelectorAll('.card').forEach(el=>el.onclick=()=>open(DATA.memories.find(m=>m.memoryId===el.dataset.id))) }function open(m){if(!m)return;document.getElementById('source').textContent=(m.appName||'未知来源')+' · '+(m.createdTime?new Date(m.createdTime).toLocaleString('zh-CN'):'');document.getElementById('title').textContent=m.title||'未命名记忆';document.getElementById('chips').innerHTML=[...(m.keywords||[]),...(m.labels||[]),...(m.collectionNames||[])].slice(0,12).map(t=>'<span class="chip">'+esc(t)+'</span>').join('');document.getElementById('body').textContent=(m.summary?m.summary+'\n\n':'')+(m.dataText||m.dataTextCleanup||'');overlay.classList.add('open')}input.oninput=render;document.getElementById('close').onclick=()=>overlay.classList.remove('open');overlay.onclick=e=>{if(e.target===overlay)overlay.classList.remove('open')};document.onkeydown=e=>{if(e.key==='Escape')overlay.classList.remove('open')};render();<\/script></body></html>`;
  }

  const api = { createViewer, portableHtml, escapeHtml };
  global.XiaobuViewer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
