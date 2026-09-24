import type { Transition } from 'motion/react';

// Shared hover/press feel for pressable controls (the reset button, slider thumbs).
// Critically damped springs, no overshoot, since a press carries no momentum. The press lands
// fast so feedback is immediate on pointer-down; the release settles a little more gently.
export const PRESS_SPRING: Transition = { type: 'spring', bounce: 0, duration: 0.15 };
export const RELEASE_SPRING: Transition = { type: 'spring', bounce: 0, duration: 0.35 };
