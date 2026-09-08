const listEl = document.getElementById('list');
const statusText = document.getElementById('statusText');
const selectAllEl = document.getElementById('selectAll');
const downloadSelectedBtn = document.getElementById('downloadSelectedBtn');
const rescanBtn = document.getElementById('rescanBtn');

const items = new Map(); // id -> item data
const rows = new Map();  // id -> row element
const selected = new Set();
let scanning = false;

function fmtDims(item) {
  if (!item.width || !item.height) return 'checking…';
  return `${item.width}×${item.height}`;
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname.split('/').pop();
  } catch (e) {
    return url;
  }
}

function updateToolbar() {
  downloadSelectedBtn.disabled = selected.size === 0;
  downloadSelectedBtn.textContent = selected.size > 0
    ? `Download selected (${selected.size})`
    : 'Download selected';
}

function upsertRow(item) {
  items.set(item.id, item);

  let row = rows.get(item.id);
  if (!row) {
    row = document.createElement('div');
    row.className = 'item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(item.id);
      else selected.delete(item.id);
      updateToolbar();
    });

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'thumb-wrap';
    const thumbImg = document.createElement('img');
    thumbImg.loading = 'lazy';
    thumbImg.referrerPolicy = 'no-referrer-when-downgrade';
    thumbWrap.appendChild(thumbImg);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const dims = document.createElement('div');
    dims.className = 'dims';
    const urlLine = document.createElement('div');
    urlLine.className = 'url';
    meta.appendChild(dims);
    meta.appendChild(urlLine);

    const dl = document.createElement('button');
    dl.className = 'item-download';
    dl.title = 'Download this image';
    dl.textContent = '⇩';
    dl.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'RQIS_DOWNLOAD', url: items.get(item.id).bestUrl });
    });

    row.appendChild(checkbox);
    row.appendChild(thumbWrap);
    row.appendChild(meta);
    row.appendChild(dl);
    row._checkbox = checkbox;
    row._thumbImg = thumbImg;
    row._dims = dims;
    row._urlLine = urlLine;

    rows.set(item.id, row);
    listEl.appendChild(row);
  }

  row._thumbImg.src = item.thumb;
  row._dims.textContent = fmtDims(item);
  if (item.improved) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'UPGRADED';
    if (!row._dims.querySelector('.badge')) row._dims.appendChild(badge);
  }
  row._urlLine.textContent = shortUrl(item.bestUrl);
  row._urlLine.title = item.bestUrl;
}

function clearList() {
  items.clear();
  rows.clear();
  selected.clear();
  listEl.innerHTML = '';
  updateToolbar();
}

function showEmptyIfNeeded() {
  if (items.size === 0) {
    listEl.innerHTML = '<div class="empty">No downloadable images found on this page.<br>Try scrolling the page to load more, then hit Rescan.</div>';
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'RQIS_ITEM') {
    upsertRow(message.item);
    statusText.textContent = `Found ${items.size} image${items.size === 1 ? '' : 's'}…`;
  }
});

async function scan() {
  if (scanning) return;
  scanning = true;
  clearList();
  statusText.textContent = 'Scanning page…';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null || !/^https?:/.test(tab.url || '')) {
    statusText.textContent = 'This page can’t be scanned.';
    scanning = false;
    showEmptyIfNeeded();
    return;
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['resolver.js'] });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        return await globalThis.__RQIS.scanPage((item) => {
          try { chrome.runtime.sendMessage({ type: 'RQIS_ITEM', item }); } catch (e) {}
        });
      }
    });
    const finalItems = (result && result.result) || [];
    finalItems.forEach(upsertRow);
    statusText.textContent = finalItems.length
      ? `${finalItems.length} image${finalItems.length === 1 ? '' : 's'} found`
      : 'No images found';
    showEmptyIfNeeded();
  } catch (e) {
    statusText.textContent = 'Could not scan this page.';
    showEmptyIfNeeded();
  } finally {
    scanning = false;
  }
}

selectAllEl.addEventListener('change', () => {
  selected.clear();
  rows.forEach((row, id) => {
    row._checkbox.checked = selectAllEl.checked;
    if (selectAllEl.checked) selected.add(id);
  });
  updateToolbar();
});

downloadSelectedBtn.addEventListener('click', () => {
  const urls = [...selected].map((id) => items.get(id).bestUrl).filter(Boolean);
  if (urls.length === 0) return;
  chrome.runtime.sendMessage({ type: 'RQIS_DOWNLOAD_MANY', urls });
});

rescanBtn.addEventListener('click', scan);

scan();
