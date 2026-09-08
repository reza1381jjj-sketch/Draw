const MENU_ID = 'rqis-download-best-quality';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Download image (real quality)',
    contexts: ['image']
  });
});

function filenameFromUrl(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() || 'image';
    return decodeURIComponent(last).replace(/[?#].*$/, '') || 'image.jpg';
  } catch (e) {
    return 'image.jpg';
  }
}

async function resolveBestUrlInFrame(tabId, frameId, srcUrl) {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: frameId != null ? [frameId] : undefined },
    files: ['resolver.js']
  });
  const [result] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: frameId != null ? [frameId] : undefined },
    func: async (url) => {
      const el = [...document.querySelectorAll('img')].find(
        (img) => (img.currentSrc || img.src) === url
      );
      const extra = [];
      if (el) {
        const picture = el.closest('picture');
        if (picture) {
          picture.querySelectorAll('source').forEach((s) => {
            const ss = s.getAttribute('srcset');
            if (ss) extra.push(ss.split(',')[0].trim().split(/\s+/)[0]);
          });
        }
        const ss = el.getAttribute('srcset');
        if (ss) extra.push(ss.split(',')[0].trim().split(/\s+/)[0]);
        for (const a of ['data-src', 'data-original', 'data-full', 'data-large']) {
          const v = el.getAttribute(a);
          if (v) extra.push(v);
        }
      }
      return await globalThis.__RQIS.pickBestForUrl(url, extra);
    },
    args: [srcUrl]
  });
  return result && result.result ? result.result : { url: srcUrl };
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.srcUrl || !tab || tab.id == null) return;
  try {
    const best = await resolveBestUrlInFrame(tab.id, info.frameId, info.srcUrl);
    chrome.downloads.download({
      url: best.url,
      filename: filenameFromUrl(best.url),
      conflictAction: 'uniquify',
      saveAs: false
    });
  } catch (e) {
    // Fall back to whatever the page reported if resolution failed.
    chrome.downloads.download({
      url: info.srcUrl,
      filename: filenameFromUrl(info.srcUrl),
      conflictAction: 'uniquify',
      saveAs: false
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'RQIS_DOWNLOAD') {
    chrome.downloads.download({
      url: message.url,
      filename: filenameFromUrl(message.url),
      conflictAction: 'uniquify',
      saveAs: false
    }, () => sendResponse({ ok: !chrome.runtime.lastError }));
    return true;
  }
  if (message && message.type === 'RQIS_DOWNLOAD_MANY') {
    (async () => {
      for (const url of message.urls) {
        await new Promise((resolve) => {
          chrome.downloads.download({
            url,
            filename: filenameFromUrl(url),
            conflictAction: 'uniquify',
            saveAs: false
          }, () => resolve());
        });
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
});
