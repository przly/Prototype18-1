export const TEST_CANVAS_WIDTH = 960;
export const TEST_CANVAS_HEIGHT = 540;
export const TEST_CIRCLE_RADIUS = 40;
export const TEST_TARGET_RADIUS = 50;

import type { DetectionMode } from './blobDetection';

// Circle colours that each detection mode picks up at its default threshold.
const TEST_CIRCLE_COLORS: Record<DetectionMode, string> = {
  dark: '#4a4a4a',
  red: '#d62828',
};
// Close in hue to the default target colour, but too bright to also pass as a dark blob.
const TEST_TARGET_COLOR = '#3b82f6';

export interface TestCircle {
  x: number;
  y: number;
}

export function createInitialTestCircles(): TestCircle[] {
  const y = TEST_CANVAS_HEIGHT / 2;
  return [0.15, 0.3, 0.5, 0.7, 0.85].map((fx) => ({ x: TEST_CANVAS_WIDTH * fx, y }));
}

export function createInitialTestTargets(): TestCircle[] {
  const y = TEST_CANVAS_HEIGHT * 0.2;
  return [1 / 3, 2 / 3].map((fx) => ({ x: TEST_CANVAS_WIDTH * fx, y }));
}

export function paintTestScene(
  canvas: HTMLCanvasElement,
  circles: TestCircle[],
  targets: TestCircle[],
  mode: DetectionMode
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = TEST_TARGET_COLOR;
  for (const target of targets) {
    ctx.beginPath();
    ctx.arc(target.x, target.y, TEST_TARGET_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = TEST_CIRCLE_COLORS[mode];
  for (const circle of circles) {
    ctx.beginPath();
    ctx.arc(circle.x, circle.y, TEST_CIRCLE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}
