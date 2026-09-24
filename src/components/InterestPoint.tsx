import { motion } from 'motion/react';
import { formatRate, formatTimer } from '../lib/timer';

interface Props {
  x: number;
  y: number;
  radius: number;
  isTouching: boolean;
  count: number;
  requiredConnections: number;
  /** Whether the overlay is flipped via CSS on each axis, so the labels must be flipped back. */
  flipX: boolean;
  flipY: boolean;
  /** Time left on this target's countdown, in milliseconds. */
  remainingMs: number;
  /** Current countdown speed multiplier (0 while paused). */
  timerRate: number;
}

export function InterestPoint({
  x,
  y,
  radius,
  isTouching,
  count,
  requiredConnections,
  flipX,
  flipY,
  remainingMs,
  timerRate,
}: Props) {
  const isFulfilled = count >= requiredConnections;
  const color = isFulfilled ? '#ffe600' : isTouching ? '#ff6b35' : '#4fd1ff';
  const crossHalf = Math.max(4, radius * 0.4);
  // Only call out the speed once it's above normal, to keep the label quiet otherwise.
  const timerLabel =
    timerRate > 1 ? `${formatTimer(remainingMs)} ${formatRate(timerRate)}` : formatTimer(remainingMs);
  const timerWidth = timerLabel.length * 9 + 14;

  return (
    <motion.g
      animate={{ x, y }}
      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
    >
      <motion.circle
        animate={{ r: radius }}
        fill={color}
        fillOpacity={0.25}
        stroke={color}
        strokeWidth={2}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      />
      <line x1={-crossHalf} y1={0} x2={crossHalf} y2={0} stroke={color} strokeWidth={2} />
      <line x1={0} y1={-crossHalf} x2={0} y2={crossHalf} stroke={color} strokeWidth={2} />
      {/* when the overlay is flipped via CSS, flip the labels back to be readable */}
      <g transform={flipX || flipY ? `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})` : undefined}>
        <rect
          x={radius + 10}
          y={-11}
          width={String(count).length * 9 + 14}
          height={22}
          rx={11}
          fill="rgba(0, 0, 0, 0.75)"
          stroke={color}
          strokeWidth={1.5}
        />
        <text
          x={radius + 10 + (String(count).length * 9 + 14) / 2}
          y={5}
          textAnchor="middle"
          fill="#fff"
          fontSize={14}
          fontFamily="monospace"
        >
          {count}
        </text>
        <rect
          x={-timerWidth / 2}
          y={radius + 8}
          width={timerWidth}
          height={22}
          rx={11}
          fill="rgba(0, 0, 0, 0.75)"
          stroke={color}
          strokeWidth={1.5}
        />
        <text
          x={0}
          y={radius + 24}
          textAnchor="middle"
          fill="#fff"
          fontSize={14}
          fontFamily="monospace"
        >
          {timerLabel}
        </text>
      </g>
    </motion.g>
  );
}
