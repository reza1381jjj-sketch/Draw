# Real Quality Image Saver

A Chrome extension (Manifest V3) that finds and downloads the **original,
full-resolution** version of images on any website — instead of the
resized/compressed thumbnail the page actually displays.

## How it works

Sites almost never show you the real file. They serve a shrunk copy through
`srcset`, lazy-load attributes (`data-src`), or a CDN resize URL
(`?w=300&q=60`, `-300x200.jpg`, `/236x/`, `._SX300_`, etc). This extension:

1. Scans every `<img>` and large CSS `background-image` on the page.
2. For each one, builds a list of candidate "real" URLs: the largest
   `srcset`/`<picture>` candidate, lazy-load attributes, the URL with
   resize query params stripped, and known CDN-specific fixes (Twitter/X,
   Google user-content, Pinterest, Shopify, Amazon, Wikimedia, Imgur,
   Squarespace, Wix).
3. Actually loads each candidate in the browser and compares real pixel
   dimensions, picking the largest one that successfully loads. Nothing is
   guessed blindly — if an "upgrade" doesn't load, it's discarded and the
   original is used.
4. Lets you download one, many, or all of the resolved images via
   `chrome.downloads`.

All processing happens locally in your browser. No image or URL is sent
anywhere except directly to the site/CDN that already hosts it.

## Install (unpacked, for personal use)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this `chrome-extension/` folder.
4. Pin the extension (puzzle-piece icon → pin) for quick access.

## Use

- **Whole page:** click the toolbar icon to open the popup. It scans the
  current tab and lists every image it found, with resolved dimensions.
  Check the ones you want (or "Select all") and click **Download selected**.
- **Single image:** right-click any image on a page and choose
  **"Download image (real quality)"** — it resolves the best version and
  saves it immediately, no popup needed.
- Click **Rescan** if you scroll/load more content and want to pick up new
  images.

## Limitations

- Signed/tokenized CDN URLs (e.g. private Facebook/Instagram media) can't be
  "upgraded" past what the page already loaded — there's no public original
  URL to guess.
- Very heavy pages are capped at ~400 detected images per scan to stay
  responsive.
- This is provided as an unpacked extension for personal use; publishing it
  to the Chrome Web Store would need a developer account and store listing,
  which is a separate step if you want that.
