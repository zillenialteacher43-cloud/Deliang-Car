import * as THREE from 'three';
import { MapId } from './types';

function createCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

function heightMapToNormalTexture(
  heights: Float32Array,
  size: number,
  strength: number,
  maxAnisotropy: number,
  repeatClampX = false
): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const d = img.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const ym = (y - 1 + size) % size;
      const yp = (y + 1) % size;

      const dx = (heights[y * size + xp] - heights[y * size + xm]) * strength;
      const dy = (heights[yp * size + x] - heights[ym * size + x]) * strength;

      let nx = -dx;
      let ny = -dy;
      let nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len;
      ny /= len;
      nz /= len;

      const idx = (y * size + x) * 4;
      d[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      d[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      d[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = repeatClampX ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createAsphaltTextures(
  maxAnisotropy: number,
  wetness: number
): {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
} {
  const size = 512;
  const [canvas, ctx] = createCanvas(size, size);
  const [rCanvas, rCtx] = createCanvas(size, size);
  const heights = new Float32Array(size * size);

  ctx.fillStyle = wetness > 0.5 ? '#181d27' : '#262a33';
  ctx.fillRect(0, 0, size, size);

  const baseRough = Math.round((1 - wetness * 0.58) * 208);
  rCtx.fillStyle = `rgb(${baseRough},${baseRough},${baseRough})`;
  rCtx.fillRect(0, 0, size, size);

  const imgData = ctx.getImageData(0, 0, size, size);
  const rData = rCtx.getImageData(0, 0, size, size);
  const d = imgData.data;
  const rd = rData.data;

  for (let i = 0; i < d.length; i += 4) {
    const pIdx = i / 4;
    const px = pIdx % size;
    const py = Math.floor(pIdx / size);
    const noiseA = Math.sin(px * 0.45 + py * 0.37) * Math.cos(py * 0.51 - px * 0.29);
    const grain = (Math.random() - 0.5) * 28 + noiseA * 6;
    heights[pIdx] = grain * 0.04;

    const distFromCenter = Math.abs(px / size - 0.5);
    const groove = Math.exp(-Math.pow((distFromCenter - 0.16) / 0.11, 2)) * 13;

    d[i] = Math.max(10, Math.min(255, d[i] + grain - groove));
    d[i + 1] = Math.max(10, Math.min(255, d[i + 1] + grain - groove));
    d[i + 2] = Math.max(12, Math.min(255, d[i + 2] + grain - groove));

    const puddleNoise =
      Math.sin(px * 0.028 + py * 0.019) * Math.cos(py * 0.024 - px * 0.017);
    let rVal = rd[i] + grain * 1.3;
    if (wetness > 0.4 && puddleNoise > 0.22) {
      rVal = 26; // mirror-like wet puddle streaks
      heights[pIdx] *= 0.15;
    }
    rVal = Math.max(18, Math.min(246, rVal));
    rd[i] = rVal;
    rd[i + 1] = rVal;
    rd[i + 2] = rVal;
  }
  ctx.putImageData(imgData, 0, 0);
  rCtx.putImageData(rData, 0, 0);

  // Outer white solid track edge lines + subtle weathered breaks
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(14, 0, 10, size);
  ctx.fillRect(size - 24, 0, 10, size);

  // Center dashed lane divider
  ctx.fillStyle = wetness > 0.5 ? '#cbd5e1' : '#f1f5f9';
  const dashH = 64;
  const gapH = 64;
  for (let y = 16; y < size; y += dashH + gapH) {
    ctx.fillRect(size / 2 - 4, y, 8, dashH);
  }

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAnisotropy;
  map.needsUpdate = true;

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.wrapS = THREE.ClampToEdgeWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = maxAnisotropy;
  roughnessMap.needsUpdate = true;

  const normalMap = heightMapToNormalTexture(heights, size, 1.35, maxAnisotropy, true);

  return { map, roughnessMap, normalMap };
}

export function createCarbonTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 64;
  const [canvas, ctx] = createCanvas(size, size);
  ctx.fillStyle = '#11141a';
  ctx.fillRect(0, 0, size, size);

  for (let y = 0; y < size; y += 8) {
    for (let x = 0; x < size; x += 8) {
      ctx.fillStyle = (x + y) % 16 === 0 ? '#1f242e' : '#161a22';
      ctx.fillRect(x, y, 7, 4);
      ctx.fillStyle = (x + y) % 16 === 0 ? '#161a22' : '#252b36';
      ctx.fillRect(x, y + 4, 7, 4);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export interface LiveDashTexture {
  texture: THREE.CanvasTexture;
  update: (speedKmh: number, gear: number, rpmRatio: number, nitro: number) => void;
}

export function createCockpitDashTexture(maxAnisotropy: number): LiveDashTexture {
  const [canvas, ctx] = createCanvas(512, 192);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;

  let lastSpeed = -1;
  let lastGear = -1;
  let lastRpmStep = -1;

  const update = (speedKmh: number, gear: number, rpmRatio: number, nitro: number) => {
    const rpmStep = Math.round(rpmRatio * 18);
    if (speedKmh === lastSpeed && gear === lastGear && rpmStep === lastRpmStep) return;
    lastSpeed = speedKmh;
    lastGear = gear;
    lastRpmStep = rpmStep;

    ctx.fillStyle = '#060a12';
    ctx.fillRect(0, 0, 512, 192);

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 3;
    ctx.strokeRect(8, 8, 496, 176);

    // 18-segment LED RPM shift bar along the top
    const totalBars = 18;
    const activeBars = Math.round(rpmRatio * totalBars);
    for (let i = 0; i < totalBars; i++) {
      if (i < activeBars) {
        ctx.fillStyle = i >= 14 ? '#ef4444' : i >= 10 ? '#f59e0b' : '#22c55e';
      } else {
        ctx.fillStyle = '#182235';
      }
      ctx.fillRect(22 + i * 26, 20, 21, 18);
    }

    // Center Gear indicator box
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(216, 52, 80, 96);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.strokeRect(216, 52, 80, 96);

    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 64px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(gear), 256, 120);

    // Left Speed Readout
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 58px monospace';
    ctx.fillText(String(speedKmh).padStart(3, '0'), 28, 114);
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('KM/H', 32, 144);

    // Right Nitro & Telemetry
    ctx.textAlign = 'right';
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 26px monospace';
    ctx.fillText(`N2O ${Math.round(nitro)}%`, 484, 92);

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(326, 108, 158, 14);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(326, 108, Math.round((158 * Math.max(0, Math.min(100, nitro))) / 100), 14);

    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 15px monospace';
    ctx.fillText('GT3 · ABS · TC', 484, 150);

    texture.needsUpdate = true;
  };

  update(0, 1, 0.2, 100);
  return { texture, update };
}

export function createLeatherTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 128;
  const [canvas, ctx] = createCanvas(size, size);
  ctx.fillStyle = '#14171f';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.18)';
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createHighwayGantryTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 128);
  ctx.fillStyle = '#064e3b';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, 496, 112);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText('METRO EXPRESSWAY  ·  APEX GP', 28, 62);
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 24px monospace';
  ctx.fillText('>>>  JALUR UTAMA  >>>', 100, 102);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createWaterNormalTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      heights[y * size + x] =
        Math.sin(u * 3 + v * 2) * 0.4 +
        Math.cos(u * 5 - v * 4) * 0.28 +
        Math.sin(u * 9 + v * 7) * 0.14;
    }
  }
  return heightMapToNormalTexture(heights, size, 1.8, maxAnisotropy, false);
}

export function createChevronSignTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(256, 128);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 244, 116);

  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 18;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const ox of [52, 118, 184]) {
    ctx.beginPath();
    ctx.moveTo(ox - 24, 28);
    ctx.lineTo(ox + 14, 64);
    ctx.lineTo(ox - 24, 100);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createCurbTexture(
  primary: string,
  secondary: string,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(128, 256);
  ctx.fillStyle = primary;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = secondary;
  ctx.fillRect(0, 128, 128, 128);

  // Scuff & tire marks on curb apex
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  for (let i = 0; i < 450; i++) {
    ctx.fillRect(Math.random() * 128, Math.random() * 256, 2, 3);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createTerrainTexture(
  mapId: MapId,
  maxAnisotropy: number
): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
  const size = 512;
  const [canvas, ctx] = createCanvas(size, size);
  const heights = new Float32Array(size * size);

  const palettes: Record<MapId, [string, string, string]> = {
    alpine: ['#355c2d', '#47723a', '#284622'],
    canyon: ['#a65938', '#894225', '#be6f48'],
    midnight: ['#131926', '#192234', '#0d121d'],
    coastal: ['#d8c092', '#c7ab78', '#e3cea2'],
  };
  const [c1, c2, c3] = palettes[mapId];

  ctx.fillStyle = c1;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 1800; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 3 + Math.random() * 20;
    ctx.fillStyle = i % 2 === 0 ? c2 : c3;
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      heights[y * size + x] =
        (Math.random() - 0.5) * 0.6 + Math.sin(x * 0.09) * Math.cos(y * 0.09) * 0.4;
    }
  }

  if (mapId === 'midnight') {
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.16)';
    ctx.lineWidth = 2;
    for (let g = 0; g <= size; g += 64) {
      ctx.beginPath();
      ctx.moveTo(g, 0);
      ctx.lineTo(g, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, g);
      ctx.lineTo(size, g);
      ctx.stroke();
    }
  }

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(38, 38);
  map.anisotropy = maxAnisotropy;
  map.needsUpdate = true;

  const normalMap = heightMapToNormalTexture(heights, size, 1.1, maxAnisotropy, false);
  normalMap.repeat.set(38, 38);

  return { map, normalMap };
}

export function createCheckeredTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 128);
  const cols = 16;
  const rows = 4;
  const cw = 512 / cols;
  const rh = 128 / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#f8fafc' : '#0f172a';
      ctx.fillRect(c * cw, r * rh, cw, rh);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(256, 256);
  const grad = ctx.createRadialGradient(128, 128, 24, 128, 128, 124);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.9)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.48)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createBuildingFacadeTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(256, 512);
  ctx.fillStyle = '#090e1a';
  ctx.fillRect(0, 0, 256, 512);

  const cols = 8;
  const rows = 24;
  const padX = 8;
  const padY = 6;
  const w = 256 / cols - padX * 2;
  const h = 512 / rows - padY * 2;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = Math.random();
      if (lit > 0.38) {
        if (lit > 0.86) ctx.fillStyle = '#38bdf8';
        else if (lit > 0.65) ctx.fillStyle = '#fde68a';
        else ctx.fillStyle = '#f59e0b';
        ctx.globalAlpha = 0.6 + Math.random() * 0.4;
      } else {
        ctx.fillStyle = '#151f33';
        ctx.globalAlpha = 0.85;
      }
      ctx.fillRect(c * (256 / cols) + padX, r * (512 / rows) + padY, w, h);
    }
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createSkyDomeTexture(
  topColor: string,
  horizonColor: string,
  isNight: boolean
): THREE.CanvasTexture {
  const w = 1024;
  const h = 512;
  const [canvas, ctx] = createCanvas(w, h);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, topColor);
  grad.addColorStop(0.52, horizonColor);
  grad.addColorStop(1, horizonColor);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  if (isNight) {
    // Crisp starfield
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 420; i++) {
      ctx.globalAlpha = 0.25 + Math.random() * 0.75;
      const r = Math.random() > 0.9 ? 1.8 : 1.1;
      ctx.fillRect(Math.random() * w, Math.random() * (h * 0.48), r, r);
    }
    ctx.globalAlpha = 1;
  } else {
    // Soft realistic atmospheric cloud wisps
    for (let c = 0; c < 110; c++) {
      const cx = Math.random() * w;
      const cy = h * (0.14 + Math.random() * 0.3);
      const rx = 38 + Math.random() * 95;
      const ry = 7 + Math.random() * 18;
      const cGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, rx);
      cGrad.addColorStop(0, 'rgba(255, 255, 255, 0.26)');
      cGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = cGrad;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, ry / rx);
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
