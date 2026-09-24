/** Starting countdown length for each target; adjustable with the Timer length slider. */
export const DEFAULT_TIMER_MS = 4 * 60 * 1000;
// How many times faster the countdown runs for every connection beyond the required amount.
export const TIMER_SPEEDUP_PER_CONNECTION = 2;

// How fast a countdown fills back up while it's below the requirement, as a multiple of normal.
export const TIMER_REGEN_RATE = 1;

/** Countdown speed multiplier: 0 below the requirement (it regenerates then, see TIMER_REGEN_RATE), 1× at it, doubling for each extra connection. */
export function timerRate(connections: number, requiredConnections: number): number {
  if (connections < requiredConnections) return 0;
  return TIMER_SPEEDUP_PER_CONNECTION ** (connections - requiredConnections);
}

/** Formats a speed multiplier like "×1.5". */
export function formatRate(rate: number): string {
  return `×${Number(rate.toFixed(2))}`;
}

/** Formats a countdown as m:ss, rounding up so it only shows 0:00 once time is really up. */
export function formatTimer(remainingMs: number): string {
  const totalSeconds = Math.ceil(Math.max(remainingMs, 0) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
