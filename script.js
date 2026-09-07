const fileInput = document.getElementById('fileInput');
const sourceCanvas = document.getElementById('sourceCanvas');
const resultCanvas = document.getElementById('resultCanvas');
const thresholdInput = document.getElementById('threshold');
const thresholdValue = document.getElementById('thresholdValue');
const thicknessInput = document.getElementById('thickness');
const thicknessValue = document.getElementById('thicknessValue');
const invertInput = document.getElementById('invert');
const downloadBtn = document.getElementById('downloadBtn');
const placeholder = document.getElementById('placeholder');

const sourceCtx = sourceCanvas.getContext('2d');
const resultCtx = resultCanvas.getContext('2d');

let currentImage = null;

const MAX_DIMENSION = 1400;

fileInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const img = new Image();
  img.onload = () => {
    currentImage = img;
    placeholder.style.display = 'none';
    drawSource();
    process();
  };
  img.onerror = () => {
    alert('این فایل به عنوان عکس قابل خواندن نیست.');
  };
  img.src = URL.createObjectURL(file);
});

thresholdInput.addEventListener('input', () => {
  thresholdValue.textContent = thresholdInput.value;
  process();
});

thicknessInput.addEventListener('input', () => {
  thicknessValue.textContent = thicknessInput.value;
  process();
});

invertInput.addEventListener('change', process);

downloadBtn.addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = 'line-art.png';
  link.href = resultCanvas.toDataURL('image/png');
  link.click();
});

function drawSource() {
  const { width, height } = fitDimensions(currentImage.width, currentImage.height);
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  resultCanvas.width = width;
  resultCanvas.height = height;
  sourceCtx.drawImage(currentImage, 0, 0, width, height);
}

function fitDimensions(width, height) {
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

function process() {
  if (!currentImage) return;

  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const srcData = sourceCtx.getImageData(0, 0, width, height);
  const gray = toGrayscale(srcData, width, height);
  const edges = sobelEdges(gray, width, height);

  const threshold = Number(thresholdInput.value);
  const thickness = Number(thicknessInput.value);
  const invert = invertInput.checked;

  let mask = thresholdMask(edges, width, height, threshold);
  if (thickness > 1) {
    mask = dilateMask(mask, width, height, thickness - 1);
  }

  const outData = resultCtx.createImageData(width, height);
  for (let i = 0; i < mask.length; i++) {
    const isLine = mask[i];
    const value = invert
      ? (isLine ? 255 : 0)
      : (isLine ? 0 : 255);
    const offset = i * 4;
    outData.data[offset] = value;
    outData.data[offset + 1] = value;
    outData.data[offset + 2] = value;
    outData.data[offset + 3] = 255;
  }

  resultCtx.putImageData(outData, 0, 0);
  downloadBtn.disabled = false;
}

function toGrayscale(imageData, width, height) {
  const { data } = imageData;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return gray;
}

function sobelEdges(gray, width, height) {
  const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  const edges = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let sumX = 0;
      let sumY = 0;
      let k = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const value = gray[(y + ky) * width + (x + kx)];
          sumX += value * gx[k];
          sumY += value * gy[k];
          k++;
        }
      }
      edges[y * width + x] = Math.sqrt(sumX * sumX + sumY * sumY);
    }
  }
  return edges;
}

function thresholdMask(edges, width, height, threshold) {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < edges.length; i++) {
    mask[i] = edges[i] >= threshold ? 1 : 0;
  }
  return mask;
}

function dilateMask(mask, width, height, radius) {
  let current = mask;
  for (let step = 0; step < radius; step++) {
    const next = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (current[idx]) {
          next[idx] = 1;
          continue;
        }
        let found = 0;
        for (let dy = -1; dy <= 1 && !found; dy++) {
          for (let dx = -1; dx <= 1 && !found; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
              if (current[ny * width + nx]) found = 1;
            }
          }
        }
        next[idx] = found;
      }
    }
    current = next;
  }
  return current;
}
