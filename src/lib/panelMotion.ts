import type { Transition, Variants } from 'motion/react';

// Panel reveal for the floating panels: each slides in from the side edge it's docked to, fading and un-blurring as it arrives. Critically damped springs (no overshoot), a touch
// quicker on the way out; springs pick up from wherever a panel is, so toggling mid-way
// reverses smoothly instead of jumping.
const OPEN_SPRING: Transition = { type: 'spring', bounce: 0, duration: 0.4 };
const CLOSE_SPRING: Transition = { type: 'spring', bounce: 0, duration: 0.35 };

// Seconds between panels in the cascade.
const PANEL_STAGGER = 0.012;

/** One panel, docked to the `side` edge. With reduced motion it only fades: no sliding, no blur. */
export function panelVariants(
  reduceMotion: boolean | null,
  side: 'left' | 'right' = 'left',
): Variants {
  if (reduceMotion) {
    return {
      open: { opacity: 1, transition: { duration: 0.15 } },
      closed: { opacity: 0, transition: { duration: 0.15 } },
    };
  }
  return {
    // Its own width plus a little more, so it fully leaves the screen past the 16px margin.
    open: { x: '0%', opacity: 1, filter: 'blur(0px)', transition: OPEN_SPRING },
    closed: {
      x: side === 'left' ? '-106%' : '106%',
      opacity: 0,
      filter: 'blur(2px)',
      transition: CLOSE_SPRING,
    },
  };
}

/** The stack of panels: opens top to bottom, closes bottom to top. */
export const PANEL_STACK_VARIANTS: Variants = {
  open: { transition: { staggerChildren: PANEL_STAGGER } },
  closed: { transition: { staggerChildren: PANEL_STAGGER, staggerDirection: -1 } },
};
