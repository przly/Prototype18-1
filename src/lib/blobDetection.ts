/** What makes a pixel part of a blob: being darker than the threshold, or being red enough. */
export type DetectionMode = 'dark' | 'red';
/**
 * Which pixels to pick up: a blob mode with its threshold, or (for the targets) every
 * pixel whose hue is within `tolerance` degrees of `hue`.
 */
export type MaskSpec =
  | { mode: DetectionMode; threshold: number }
  | { mode: 'color'; hue: number; tolerance: number };

export interface BlobDetection {
  x: number;
  y: number;
  radius: number;
  area: number;
}

// A core must be at least this fraction of the component's thickest point to count,
// so small bumps along a blob's edge don't get split off as their own blob.
const MIN_PEAK_RATIO = 0.5;
// Two cores are only kept apart if their centers are further apart than this fraction
// of their combined radii. Two circles just touching are at 1.0; lower splits more eagerly.
const PEAK_SEPARATION = 0.75;

// Radius (in processing pixels) of the box blur applied before thresholding. Camera noise
// otherwise leaves speckled holes in the mask, and every hole creates a new distance peak,
// so one area gets split into a different set of blobs every frame.
const SMOOTH_RADIUS = 2;

// Below this chroma (max minus min channel, 0–255) a pixel is too grey, dark or washed out
// for its hue to mean anything, so it never matches a colour.
const MIN_COLOR_CHROMA = 30;

/** Hue of an RGB colour in degrees (0–360); 0 for greys, which have no hue. */
export function rgbToHue(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const chroma = max - Math.min(r, g, b);
  if (chroma === 0) return 0;
  let hue: number;
  if (max === r) hue = ((g - b) / chroma) % 6;
  else if (max === g) hue = (b - r) / chroma + 2;
  else hue = (r - g) / chroma + 4;
  return (hue * 60 + 360) % 360;
}

/** Whether an RGB colour has enough colour in it to be matched by hue. */
export function hasUsableHue(r: number, g: number, b: number): boolean {
  return Math.max(r, g, b) - Math.min(r, g, b) >= MIN_COLOR_CHROMA;
}

/**
 * Marks which pixels belong to a blob. In 'dark' mode a pixel's luminance must be below
 * the threshold; in 'red' mode its red channel must beat both green and blue by more than
 * the threshold, which skips whites, greys and darks as well as most skin tones.
 * In 'color' mode a pixel matches when it has a usable hue within the tolerance of the
 * wanted hue, so the same object keeps matching as it gets lighter or darker.
 * The per-pixel value is box-blurred first, so noise can't punch holes in the mask.
 */
function computeMask(imageData: ImageData, spec: MaskSpec): Uint8Array {
  const { width, height, data } = imageData;
  const size = width * height;

  const value = new Float32Array(size);
  for (let i = 0, p = 0; i < size; i++, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    if (spec.mode === 'color') {
      const diff = Math.abs(rgbToHue(r, g, b) - spec.hue);
      const hueDistance = Math.min(diff, 360 - diff);
      value[i] = hasUsableHue(r, g, b) && hueDistance <= spec.tolerance ? 1 : 0;
    } else {
      value[i] = spec.mode === 'red' ? r - Math.max(g, b) : 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }

  const smoothed = boxBlur(value, width, height, SMOOTH_RADIUS);
  const mask = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    // A colour match is 0 or 1 per pixel, so after blurring a majority of the neighbourhood must match.
    const isMatch =
      spec.mode === 'color'
        ? smoothed[i] > 0.5
        : spec.mode === 'dark'
          ? smoothed[i] < spec.threshold
          : smoothed[i] > spec.threshold;
    mask[i] = isMatch ? 1 : 0;
  }
  return mask;
}

/** Separable box blur; the window is clamped at the image edges. */
function boxBlur(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      let sum = 0;
      for (let k = x0; k <= x1; k++) sum += src[row + k];
      tmp[row + x] = sum / (x1 - x0 + 1);
    }
  }

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(height - 1, y + radius);
      let sum = 0;
      for (let k = y0; k <= y1; k++) sum += tmp[k * width + x];
      out[y * width + x] = sum / (y1 - y0 + 1);
    }
  }

  return out;
}

/**
 * Finds roughly-circular blobs in an image by thresholding each pixel (see computeMask)
 * and iterative flood fill (connected-component labeling). Components made of
 * several touching blobs are split apart at their distance-transform peaks, unless
 * `splitTouching` is off, in which case every connected area is one detection.
 */
export function detectBlobs(
  imageData: ImageData,
  spec: MaskSpec,
  minArea: number,
  maxArea: number,
  splitTouching = true
): BlobDetection[] {
  const { width, height } = imageData;
  const size = width * height;

  const mask = computeMask(imageData, spec);
  const dist = splitTouching ? chamferDistance(mask, width, height) : null;
  const visited = new Uint8Array(size);
  const stack = new Int32Array(size);
  const members = new Int32Array(size);
  const blobs: BlobDetection[] = [];

  for (let start = 0; start < size; start++) {
    if (mask[start] === 0 || visited[start] === 1) continue;

    let stackSize = 0;
    stack[stackSize++] = start;
    visited[start] = 1;

    let count = 0;

    while (stackSize > 0) {
      const idx = stack[--stackSize];
      const x = idx % width;
      const y = (idx / width) | 0;

      members[count++] = idx;

      if (x > 0) {
        const n = idx - 1;
        if (mask[n] === 1 && visited[n] === 0) {
          visited[n] = 1;
          stack[stackSize++] = n;
        }
      }
      if (x < width - 1) {
        const n = idx + 1;
        if (mask[n] === 1 && visited[n] === 0) {
          visited[n] = 1;
          stack[stackSize++] = n;
        }
      }
      if (y > 0) {
        const n = idx - width;
        if (mask[n] === 1 && visited[n] === 0) {
          visited[n] = 1;
          stack[stackSize++] = n;
        }
      }
      if (y < height - 1) {
        const n = idx + width;
        if (mask[n] === 1 && visited[n] === 0) {
          visited[n] = 1;
          stack[stackSize++] = n;
        }
      }
    }

    if (count < minArea) continue;

    const parts = dist
      ? splitComponent(members, count, dist, width, height)
      : [wholeComponent(members, count, width)];
    for (const blob of parts) {
      if (blob.area >= minArea && blob.area <= maxArea) blobs.push(blob);
    }
  }

  return blobs;
}

/** One connected component as a single detection, centered on its centroid. */
function wholeComponent(members: Int32Array, count: number, width: number): BlobDetection {
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < count; i++) {
    sumX += members[i] % width;
    sumY += (members[i] / width) | 0;
  }
  return { x: sumX / count, y: sumY / count, radius: Math.sqrt(count / Math.PI), area: count };
}

/**
 * Splits one connected component into its individual round blobs. Each pixel's distance
 * to the background peaks at the center of every blob, so separate peaks mean separate
 * blobs; pixels are then handed to whichever peak's circle they sit deepest inside.
 */
function splitComponent(
  members: Int32Array,
  count: number,
  dist: Uint16Array,
  width: number,
  height: number
): BlobDetection[] {
  let maxDist = 0;
  for (let i = 0; i < count; i++) maxDist = Math.max(maxDist, dist[members[i]]);
  const minPeak = maxDist * MIN_PEAK_RATIO;

  const candidates: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < count; i++) {
    const idx = members[i];
    const d = dist[idx];
    if (d < minPeak) continue;
    const x = idx % width;
    const y = (idx / width) | 0;
    let isPeak = true;
    for (let dy = -1; dy <= 1 && isPeak; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (dist[ny * width + nx] > d) {
          isPeak = false;
          break;
        }
      }
    }
    if (isPeak) candidates.push({ x, y, r: d / CHAMFER_STRAIGHT });
  }

  candidates.sort((a, b) => b.r - a.r);
  const peaks: typeof candidates = [];
  for (const c of candidates) {
    const isSeparate = peaks.every(
      (p) => Math.hypot(p.x - c.x, p.y - c.y) > PEAK_SEPARATION * (p.r + c.r)
    );
    if (isSeparate) peaks.push(c);
  }

  const sumX = new Float64Array(Math.max(peaks.length, 1));
  const sumY = new Float64Array(sumX.length);
  const area = new Uint32Array(sumX.length);

  for (let i = 0; i < count; i++) {
    const idx = members[i];
    const x = idx % width;
    const y = (idx / width) | 0;
    let best = 0;
    if (peaks.length > 1) {
      let bestScore = Infinity;
      peaks.forEach((p, pi) => {
        const score = Math.hypot(p.x - x, p.y - y) - p.r;
        if (score < bestScore) {
          bestScore = score;
          best = pi;
        }
      });
    }
    sumX[best] += x;
    sumY[best] += y;
    area[best]++;
  }

  const result: BlobDetection[] = [];
  for (let i = 0; i < area.length; i++) {
    if (area[i] === 0) continue;
    result.push({
      x: sumX[i] / area[i],
      y: sumY[i] / area[i],
      radius: Math.sqrt(area[i] / Math.PI),
      area: area[i],
    });
  }
  return result;
}

const CHAMFER_STRAIGHT = 3;
const CHAMFER_DIAGONAL = 4;

/**
 * Approximate distance from every foreground pixel to the nearest background pixel,
 * using a two-pass 3-4 chamfer transform (divide by CHAMFER_STRAIGHT for pixels).
 * Anything outside the image counts as background.
 */
function chamferDistance(mask: Uint8Array, width: number, height: number): Uint16Array {
  const d = new Uint16Array(width * height);
  const INF = 0xffff;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask[i] === 0) continue;
      let v = INF;
      v = Math.min(v, (x > 0 ? d[i - 1] : 0) + CHAMFER_STRAIGHT);
      v = Math.min(v, (y > 0 ? d[i - width] : 0) + CHAMFER_STRAIGHT);
      v = Math.min(v, (x > 0 && y > 0 ? d[i - width - 1] : 0) + CHAMFER_DIAGONAL);
      v = Math.min(v, (x < width - 1 && y > 0 ? d[i - width + 1] : 0) + CHAMFER_DIAGONAL);
      d[i] = v;
    }
  }

  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (mask[i] === 0) continue;
      let v = d[i];
      v = Math.min(v, (x < width - 1 ? d[i + 1] : 0) + CHAMFER_STRAIGHT);
      v = Math.min(v, (y < height - 1 ? d[i + width] : 0) + CHAMFER_STRAIGHT);
      v = Math.min(v, (x < width - 1 && y < height - 1 ? d[i + width + 1] : 0) + CHAMFER_DIAGONAL);
      v = Math.min(v, (x > 0 && y < height - 1 ? d[i + width - 1] : 0) + CHAMFER_DIAGONAL);
      d[i] = v;
    }
  }

  return d;
}

/**
 * Highlights every pixel that passes the threshold in green, transparent elsewhere —
 * a focus-peaking-style preview of what the current mode would pick up as a blob.
 */
export function computeThresholdPeaking(
  imageData: ImageData,
  spec: MaskSpec
): ImageData {
  const { width, height } = imageData;
  const mask = computeMask(imageData, spec);
  const out = new ImageData(width, height);
  const outData = out.data;

  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    if (mask[i] === 1) {
      outData[p] = 57;
      outData[p + 1] = 255;
      outData[p + 2] = 106;
      outData[p + 3] = 170;
    }
  }

  return out;
}
