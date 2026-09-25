import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { panelVariants } from '../lib/panelMotion';
import {
  computeThresholdPeaking,
  detectBlobs,
  rgbToHue,
  type DetectionMode,
  type MaskSpec,
} from '../lib/blobDetection';
import { hexToRgb, rgbToHex } from '../lib/color';
import { BlobTracker, type TrackedBlob } from '../lib/blobTracker';
import {
  createInitialTestCircles,
  createInitialTestTargets,
  paintTestScene,
  TEST_CANVAS_HEIGHT,
  TEST_CANVAS_WIDTH,
  TEST_CIRCLE_RADIUS,
  TEST_TARGET_RADIUS,
  type TestCircle,
} from '../lib/testScene';
import { InterestPoint } from './InterestPoint';
import { BlobScene } from './BlobScene';
import { TIMER_REGEN_RATE, timerRate } from '../lib/timer';
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Kbd } from '@/components/ui/kbd';

const PROCESS_WIDTH = 320;
// The grab area is set in pixels of a camera view this wide, and scaled to the view's real
// width, so a target covers the same part of the image however large the view is shown.
const TRIGGER_RADIUS_REFERENCE_WIDTH = 960;
// Targets are blue areas, so there's no upper size limit and touching areas aren't split.
const MAX_TARGET_AREA = Infinity;
// Half-width (in processing pixels) of the patch averaged when picking a colour, so one
// noisy pixel doesn't decide it.
const PICK_SAMPLE_RADIUS = 2;
// Targets sit still, so their tracking trades speed for steadiness (frame counts at ~60 fps):
// - a target may go unseen for about 1.5 s (e.g. while someone stands over it) and keep its
//   ID and timer;
// - a new one must be seen for about 0.25 s first, so a colour area that briefly breaks
//   into pieces doesn't flash up extra targets;
// - its position and size are smoothed, so pixel noise doesn't make it shake.
const TARGET_TRACKER_OPTIONS = { maxMissedFrames: 90, minConfirmFrames: 15, smoothing: 0.85 };

/** Which threshold's mask is previewed on the feed while its slider is dragged. */
export type PeakingSource = 'blobs' | 'targets';

interface Props {
  /** Whether the floating camera view is shown; it slides out to the right when not. */
  open: boolean;
  devices: MediaDeviceInfo[];
  deviceId: string | null;
  onDeviceChange: (id: string) => void;
  detectionMode: DetectionMode;
  threshold: number;
  minArea: number;
  maxArea: number;
  /** Colour of the target areas, as a hex string; matched by hue. */
  targetColor: string;
  /** How far (in degrees of hue) a pixel may be from targetColor and still count. */
  targetTolerance: number;
  targetMinArea: number;
  /** While on, clicking the camera view picks the colour under the cursor. */
  isPickingColor: boolean;
  onColorPick: (hex: string) => void;
  peaking: PeakingSource | null;
  triggerRadius: number;
  requiredConnections: number;
  testMode: boolean;
  /** Whether the camera is running; while off, nothing is tracked. Ignored in test mode. */
  cameraOn: boolean;
  /** Mirror the camera view left-to-right. */
  flipX: boolean;
  /** Mirror the camera view top-to-bottom. */
  flipY: boolean;
  /** Changes whenever the timers should restart from full. */
  timerResetCount: number;
  /** Full length of each target's countdown. */
  timerLengthMs: number;
  /** Spotlight brightness and beam haze, as multiples of normal. */
  spotlightLight: number;
  spotlightDensity: number;
}

// The feed box's height change, matching the panels' springs: no overshoot.
const FEED_HEIGHT_SPRING = { type: 'spring', bounce: 0, duration: 0.4 } as const;

export function CameraView({
  open,
  devices,
  deviceId,
  onDeviceChange,
  detectionMode,
  threshold,
  minArea,
  maxArea,
  targetColor,
  targetTolerance,
  targetMinArea,
  isPickingColor,
  onColorPick,
  peaking,
  triggerRadius,
  requiredConnections,
  testMode,
  cameraOn,
  flipX,
  flipY,
  timerResetCount,
  timerLengthMs,
  spotlightLight,
  spotlightDensity,
}: Props) {
  const reduceMotion = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);
  const testCanvasRef = useRef<HTMLCanvasElement>(null);
  const testCirclesRef = useRef<TestCircle[]>(createInitialTestCircles());
  const testTargetsRef = useRef<TestCircle[]>(createInitialTestTargets());
  // The test shape being dragged: a list (blob circles or blue targets) and its index there.
  const draggingTestShapeRef = useRef<{ shapes: TestCircle[]; index: number } | null>(null);
  const peakingCanvasRef = useRef<HTMLCanvasElement>(null);
  const trackerRef = useRef(new BlobTracker());
  const targetTrackerRef = useRef(new BlobTracker(TARGET_TRACKER_OPTIONS));
  // Holds the latest downscaled frame, which detection runs on and colours are picked from.
  const processCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const blobSpec: MaskSpec = { mode: detectionMode, threshold };
  const targetSpec: MaskSpec = {
    mode: 'color',
    hue: rgbToHue(...hexToRgb(targetColor)),
    tolerance: targetTolerance,
  };
  const params = {
    blobSpec,
    targetSpec,
    detectionMode,
    minArea,
    maxArea,
    targetMinArea,
    peaking,
    testMode,
  };
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const cameras = devices.map((d) => ({ value: d.deviceId, label: d.label || d.deviceId }));
  const [blobs, setBlobs] = useState<TrackedBlob[]>([]);
  // Blue areas in the feed, oldest first; each one is a target.
  const [targets, setTargets] = useState<TrackedBlob[]>([]);
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  // Height of the feed's content, which the feed box springs to instead of jumping when the
  // camera starts or stops and the picture changes shape. Null until first measured.
  const feedContentRef = useRef<HTMLDivElement>(null);
  const [feedHeight, setFeedHeight] = useState<number | null>(null);
  useEffect(() => {
    const content = feedContentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(([entry]) => {
      setFeedHeight(entry.borderBoxSize[0].blockSize);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  const [error, setError] = useState<string | null>(null);

  // Picks the average colour of a small patch of the latest frame under the click.
  function handlePickPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const canvas = processCanvasRef.current;
    const ctx = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !ctx || canvas.width === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // The feed is mirrored with CSS, so on a flipped axis the click maps back in reverse.
    const fx = (flipX ? rect.right - e.clientX : e.clientX - rect.left) / rect.width;
    const fy = (flipY ? rect.bottom - e.clientY : e.clientY - rect.top) / rect.height;
    const size = PICK_SAMPLE_RADIUS * 2 + 1;
    const clampPatch = (f: number, extent: number) =>
      Math.min(Math.max(Math.round(f * extent) - PICK_SAMPLE_RADIUS, 0), extent - size);
    const x = clampPatch(fx, canvas.width);
    const y = clampPatch(fy, canvas.height);
    const { data } = ctx.getImageData(x, y, size, size);
    const sum = [0, 0, 0];
    for (let p = 0; p < data.length; p += 4) {
      sum[0] += data[p];
      sum[1] += data[p + 1];
      sum[2] += data[p + 2];
    }
    const count = data.length / 4;
    onColorPick(rgbToHex(sum[0] / count, sum[1] / count, sum[2] / count));
  }

  function hitTestCircle(canvas: HTMLCanvasElement, e: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function handleTestCanvasPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = testCanvasRef.current;
    if (!canvas) return;
    const point = hitTestCircle(canvas, e);

    // Blob circles are painted over the targets, so they win when both are under the pointer.
    let hit: { shapes: TestCircle[]; index: number } | null = null;
    let hitDistance = Infinity;
    for (const [shapes, radius] of [
      [testCirclesRef.current, TEST_CIRCLE_RADIUS],
      [testTargetsRef.current, TEST_TARGET_RADIUS],
    ] as const) {
      for (let index = 0; index < shapes.length; index++) {
        const d = Math.hypot(shapes[index].x - point.x, shapes[index].y - point.y);
        if (d <= radius && d < hitDistance) {
          hitDistance = d;
          hit = { shapes, index };
        }
      }
      if (hit) break;
    }

    if (hit) {
      draggingTestShapeRef.current = hit;
      canvas.setPointerCapture(e.pointerId);
    }
  }

  function handleTestCanvasPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const dragging = draggingTestShapeRef.current;
    const canvas = testCanvasRef.current;
    if (!dragging || !canvas) return;
    const point = hitTestCircle(canvas, e);
    dragging.shapes[dragging.index] = {
      x: Math.min(Math.max(point.x, 0), TEST_CANVAS_WIDTH),
      y: Math.min(Math.max(point.y, 0), TEST_CANVAS_HEIGHT),
    };
  }

  function handleTestCanvasPointerUp() {
    draggingTestShapeRef.current = null;
  }

  const scaledTriggerRadius = triggerRadius * (displaySize.width / TRIGGER_RADIUS_REFERENCE_WIDTH);

  // Blobs within reach of each target, in the same order as targets.
  const connectedBlobsPerPoint = useMemo(
    () =>
      targets.map((t) =>
        blobs.filter(
          (b) => Math.hypot(b.x - t.x, b.y - t.y) <= b.radius + scaledTriggerRadius
        )
      ),
    [blobs, targets, scaledTriggerRadius]
  );

  const connectedIds = useMemo(
    () => new Set(connectedBlobsPerPoint.flat().map((b) => b.id)),
    [connectedBlobsPerPoint]
  );

  // Each target has its own countdown that only runs while its required connections are met,
  // speeding up for every extra connection; it pauses (keeping its progress) whenever the
  // target drops below the requirement.
  // The element currently showing the feed (webcam video or test canvas), projected onto the 3D floor.
  const [feedElement, setFeedElement] = useState<HTMLVideoElement | HTMLCanvasElement | null>(null);
  useEffect(() => {
    setFeedElement(testMode ? testCanvasRef.current : videoRef.current);
  }, [testMode]);

  // Time left per target ID. A target with no entry yet (just found) is at full length.
  const [timerRemainingById, setTimerRemainingById] = useState<Map<number, number>>(new Map());
  // Restart every countdown when the reset button is pressed.
  const [lastTimerReset, setLastTimerReset] = useState(timerResetCount);
  if (timerResetCount !== lastTimerReset) {
    setLastTimerReset(timerResetCount);
    setTimerRemainingById(new Map());
  }
  // When the timer length changes, each countdown keeps its progress: a full timer stays
  // full, one halfway through stays halfway through the new length.
  const [lastTimerLength, setLastTimerLength] = useState(timerLengthMs);
  if (timerLengthMs !== lastTimerLength) {
    setLastTimerLength(timerLengthMs);
    setTimerRemainingById(
      (times) =>
        new Map([...times].map(([id, t]) => [id, (t / lastTimerLength) * timerLengthMs]))
    );
  }
  const timerRemaining = targets.map((t) => timerRemainingById.get(t.id) ?? timerLengthMs);
  const timerRates = connectedBlobsPerPoint.map((c) => timerRate(c.length, requiredConnections));
  // Target ID → current countdown rate, read by the timer interval.
  const timerRatesRef = useRef(new Map<number, number>());
  timerRatesRef.current = new Map(targets.map((t, i) => [t.id, timerRates[i]]));
  const timerLengthRef = useRef(timerLengthMs);
  timerLengthRef.current = timerLengthMs;

  useEffect(() => {
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const elapsed = now - last;
      last = now;
      // Only current targets are kept, so a lost target's timer is forgotten. A countdown
      // that's stopped, short of its required connections, fills back up to full meanwhile.
      const length = timerLengthRef.current;
      setTimerRemainingById(
        (times) =>
          new Map(
            [...timerRatesRef.current].map(([targetId, rate]) => {
              const t = times.get(targetId) ?? length;
              return [
                targetId,
                rate > 0
                  ? Math.max(t - elapsed * rate, 0)
                  : Math.min(t + elapsed * TIMER_REGEN_RATE, length),
              ];
            })
          )
      );
    }, 100);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (testMode) {
      setError(null);
      return;
    }
    if (!cameraOn) {
      // No new frames arrive while it's off, so drop what was last seen.
      setError(null);
      setBlobs([]);
      setTargets([]);
      return;
    }

    const video = videoRef.current;
    let stream: MediaStream | null = null;
    let cancelled = false;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : true,
        });
        if (cancelled || !video) return;
        video.srcObject = stream;
        await video.play();
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not access camera');
      }
    }
    start();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      // Detaching the stream empties the video, so the last frame isn't tracked on.
      if (video) video.srcObject = null;
    };
  }, [deviceId, testMode, cameraOn]);

  useEffect(() => {
    const processCanvas = document.createElement('canvas');
    processCanvasRef.current = processCanvas;
    const ctx = processCanvas.getContext('2d', { willReadFrequently: true });
    let rafId: number;

    function tick() {
      const { blobSpec, targetSpec, detectionMode, minArea, maxArea, targetMinArea, peaking, testMode } =
        paramsRef.current;

      let sourceEl: HTMLVideoElement | HTMLCanvasElement | null = null;
      let sourceWidth = 0;
      let sourceHeight = 0;

      if (testMode) {
        const canvas = testCanvasRef.current;
        if (canvas) {
          paintTestScene(canvas, testCirclesRef.current, testTargetsRef.current, detectionMode);
          sourceEl = canvas;
          sourceWidth = canvas.width;
          sourceHeight = canvas.height;
        }
      } else {
        const video = videoRef.current;
        if (video && video.readyState >= 2 && video.videoWidth > 0) {
          sourceEl = video;
          sourceWidth = video.videoWidth;
          sourceHeight = video.videoHeight;
        }
      }

      if (ctx && sourceEl && sourceWidth > 0) {
        const scale = PROCESS_WIDTH / sourceWidth;
        const pw = PROCESS_WIDTH;
        const ph = Math.max(1, Math.round(sourceHeight * scale));
        if (processCanvas.width !== pw || processCanvas.height !== ph) {
          processCanvas.width = pw;
          processCanvas.height = ph;
        }

        ctx.drawImage(sourceEl, 0, 0, pw, ph);
        const imageData = ctx.getImageData(0, 0, pw, ph);

        const detections = detectBlobs(imageData, blobSpec, minArea, maxArea);
        const tracked = trackerRef.current.update(detections);
        const targetDetections = detectBlobs(
          imageData,
          targetSpec,
          targetMinArea,
          MAX_TARGET_AREA,
          false
        );
        const trackedTargets = targetTrackerRef.current
          .update(targetDetections)
          .sort((a, b) => a.id - b.id);

        if (peaking && peakingCanvasRef.current) {
          const peakingCanvas = peakingCanvasRef.current;
          if (peakingCanvas.width !== pw || peakingCanvas.height !== ph) {
            peakingCanvas.width = pw;
            peakingCanvas.height = ph;
          }
          const peakCtx = peakingCanvas.getContext('2d');
          peakCtx?.putImageData(
            computeThresholdPeaking(imageData, peaking === 'targets' ? targetSpec : blobSpec),
            0,
            0
          );
        }

        const clientWidth = sourceEl.clientWidth;
        const clientHeight = sourceEl.clientHeight;
        const scaleX = clientWidth / pw;
        const scaleY = clientHeight / ph;

        const toDisplay = (b: TrackedBlob) => ({
          ...b,
          x: b.x * scaleX,
          y: b.y * scaleY,
          radius: b.radius * ((scaleX + scaleY) / 2),
        });

        setDisplaySize({ width: clientWidth, height: clientHeight });
        setBlobs(tracked.map(toDisplay));
        setTargets(trackedTargets.map(toDisplay));
      }
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <>
      {/* Floating preview: camera picker above the feed, in a white frame. It stays mounted
          while hidden, so tracking carries on; the scene below takes the clicks meanwhile. */}
      <motion.div
        className="camera-view"
        style={{ pointerEvents: open ? undefined : 'none' }}
        inert={!open}
        variants={panelVariants(reduceMotion, 'right')}
        initial={false}
        animate={open ? 'open' : 'closed'}
      >
        <div className="flex min-h-8 items-center gap-2">
          {!testMode && (
            <Select
              items={cameras}
              value={deviceId}
              onValueChange={(v) => v && onDeviceChange(v)}
            >
              <SelectTrigger size="sm" className="min-w-0 flex-1">
                <SelectValue placeholder="No camera found" />
              </SelectTrigger>
              <SelectPopup>
                {cameras.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          )}
          <span className="ms-auto inline-flex shrink-0 items-center gap-1.5 pe-1 text-muted-foreground text-xs">
            <Kbd>C</Kbd>
            to hide
          </span>
        </div>
        <motion.div
          className="camera-view__feed"
          initial={false}
          animate={feedHeight === null ? undefined : { height: feedHeight }}
          transition={reduceMotion ? { duration: 0 } : FEED_HEIGHT_SPRING}
        >
          <div
            ref={feedContentRef}
            className="camera-view__mirror"
            style={{ transform: `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})` }}
          >
            {testMode ? (
              <canvas
                ref={testCanvasRef}
                width={TEST_CANVAS_WIDTH}
                height={TEST_CANVAS_HEIGHT}
                className="camera-view__video"
                onPointerDown={handleTestCanvasPointerDown}
                onPointerMove={handleTestCanvasPointerMove}
                onPointerUp={handleTestCanvasPointerUp}
                style={{ touchAction: 'none' }}
              />
            ) : (
              <video ref={videoRef} muted playsInline className="camera-view__video" />
            )}
            {peaking && (
              <canvas ref={peakingCanvasRef} className="camera-view__peaking" />
            )}
            <svg
              className="camera-view__overlay"
              width={displaySize.width}
              height={displaySize.height}
            >
            <AnimatePresence>
              {blobs.map((b) => {
                const isConnected = connectedIds.has(b.id);
                return (
                  <motion.circle
                    key={b.id}
                    initial={{ opacity: 0, r: 0 }}
                    animate={{
                      opacity: 1,
                      cx: b.x,
                      cy: b.y,
                      r: b.radius,
                      stroke: isConnected ? '#39ff6a' : '#00e5ff',
                    }}
                    exit={{ opacity: 0, r: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    fill="none"
                    strokeWidth={2}
                  />
                );
              })}
            </AnimatePresence>
            <AnimatePresence>
              {targets.flatMap((p, i) =>
                connectedBlobsPerPoint[i].map((b) => (
                  <motion.line
                    key={`connector-${p.id}-${b.id}`}
                    initial={{ opacity: 0 }}
                    animate={{
                      opacity: 1,
                      x1: p.x,
                      y1: p.y,
                      x2: b.x,
                      y2: b.y,
                    }}
                    exit={{ opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    stroke="#39ff6a"
                    strokeWidth={2}
                  />
                ))
              )}
            </AnimatePresence>
            {targets.map((p, i) => (
              <InterestPoint
                key={p.id}
                x={p.x}
                y={p.y}
                radius={scaledTriggerRadius}
                isTouching={connectedBlobsPerPoint[i].length > 0}
                count={connectedBlobsPerPoint[i].length}
                requiredConnections={requiredConnections}
                flipX={flipX}
                flipY={flipY}
                remainingMs={timerRemaining[i]}
                timerRate={timerRates[i]}
              />
            ))}
            </svg>
          </div>
          {isPickingColor && (
            <div className="camera-view__picker" onPointerDown={handlePickPointerDown}>
              <span className="camera-view__picker-hint">Click the target colour</span>
            </div>
          )}
          {error && <p className="camera-view__error">{error}</p>}
        </motion.div>
      </motion.div>
      <BlobScene
        blobs={blobs}
        connectedIds={connectedIds}
        interestPoints={targets.map((p, i) => ({
          id: p.id,
          x: p.x,
          y: p.y,
          connectedBlobIds: connectedBlobsPerPoint[i].map((b) => b.id),
          remainingMs: timerRemaining[i],
          timerRate: timerRates[i],
        }))}
        requiredConnections={requiredConnections}
        triggerRadius={scaledTriggerRadius}
        timerLengthMs={timerLengthMs}
        spotlightLight={spotlightLight}
        spotlightDensity={spotlightDensity}
        width={displaySize.width}
        height={displaySize.height}
        flipX={flipX}
        flipY={flipY}
        feedElement={feedElement}
      />
    </>
  );
}
