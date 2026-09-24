import type { BlobDetection } from './blobDetection';

export interface TrackedBlob extends BlobDetection {
  id: number;
}

// By default, a new blob must be detected this many frames in a row before it's reported,
// so one-frame noise (a stray split or speck) never shows up as a blob or a figure in the 3D view.
const DEFAULT_MIN_CONFIRM_FRAMES = 3;
// By default, how many frames in a row a confirmed blob may go undetected before it's
// dropped, so a brief dropout doesn't bring it back under a new ID.
const DEFAULT_MAX_MISSED_FRAMES = 10;

export interface BlobTrackerOptions {
  /** Furthest (in processing pixels) a blob may move between frames and keep its ID. */
  maxDistance?: number;
  /** Frames a confirmed blob may go undetected before it's dropped. */
  maxMissedFrames?: number;
  /** Frames in a row a new blob must be detected before it's reported. */
  minConfirmFrames?: number;
  /**
   * How much of its previous position and size a blob keeps each frame (0–1); 0 follows
   * the detections exactly, higher values steady a jittery blob at the cost of some lag.
   */
  smoothing?: number;
}

/**
 * Assigns stable IDs to per-frame blob detections by greedily matching
 * each detection to the nearest previously tracked blob within maxDistance.
 * New blobs are held back until confirmed; confirmed blobs that go briefly undetected
 * keep their last position and ID.
 */
export class BlobTracker {
  private nextId = 0;
  private tracked: { blob: TrackedBlob; hits: number; missed: number }[] = [];
  private maxDistance: number;
  private maxMissedFrames: number;
  private minConfirmFrames: number;
  private smoothing: number;

  constructor({
    maxDistance = 60,
    maxMissedFrames = DEFAULT_MAX_MISSED_FRAMES,
    minConfirmFrames = DEFAULT_MIN_CONFIRM_FRAMES,
    smoothing = 0,
  }: BlobTrackerOptions = {}) {
    this.maxDistance = maxDistance;
    this.maxMissedFrames = maxMissedFrames;
    this.minConfirmFrames = minConfirmFrames;
    this.smoothing = smoothing;
  }

  update(detections: BlobDetection[]): TrackedBlob[] {
    const pairs: { ti: number; di: number; dist: number }[] = [];
    this.tracked.forEach(({ blob: t }, ti) => {
      detections.forEach((d, di) => {
        const dist = Math.hypot(t.x - d.x, t.y - d.y);
        if (dist <= this.maxDistance) pairs.push({ ti, di, dist });
      });
    });
    pairs.sort((a, b) => a.dist - b.dist);

    const matchedTracked = new Set<number>();
    const matchedDet = new Set<number>();
    const next: typeof this.tracked = [];

    for (const { ti, di } of pairs) {
      if (matchedTracked.has(ti) || matchedDet.has(di)) continue;
      matchedTracked.add(ti);
      matchedDet.add(di);
      const t = this.tracked[ti];
      const d = detections[di];
      const keep = this.smoothing;
      const mix = (prev: number, now: number) => prev * keep + now * (1 - keep);
      next.push({
        blob: {
          id: t.blob.id,
          x: mix(t.blob.x, d.x),
          y: mix(t.blob.y, d.y),
          radius: mix(t.blob.radius, d.radius),
          area: mix(t.blob.area, d.area),
        },
        hits: t.hits + 1,
        missed: 0,
      });
    }

    this.tracked.forEach((t, ti) => {
      const isConfirmed = t.hits >= this.minConfirmFrames;
      if (!matchedTracked.has(ti) && isConfirmed && t.missed < this.maxMissedFrames) {
        next.push({ ...t, missed: t.missed + 1 });
      }
    });

    detections.forEach((d, di) => {
      if (!matchedDet.has(di)) {
        next.push({ blob: { id: this.nextId++, ...d }, hits: 1, missed: 0 });
      }
    });

    this.tracked = next;
    return next.filter((t) => t.hits >= this.minConfirmFrames).map((t) => t.blob);
  }
}
