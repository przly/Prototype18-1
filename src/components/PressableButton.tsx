import { motion, useReducedMotion, type Variants } from 'motion/react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { PRESS_SPRING, RELEASE_SPRING } from '../lib/pressMotion';

const PRESS_VARIANTS: Variants = {
  rest: { scale: 1 },
  hover: { scale: 1.03 },
  press: { scale: 0.96, transition: PRESS_SPRING },
};
// Reduced motion: no scaling, just a gentle dim while pressed.
const PRESS_VARIANTS_REDUCED: Variants = {
  rest: { opacity: 1 },
  press: { opacity: 0.8, transition: { duration: 0.1 } },
};

interface Props extends Omit<ButtonProps, 'render'> {
  /** Its keyboard shortcut is held, so it shows the same press as a click. */
  isKeyDown?: boolean;
  /**
   * Other variants to play alongside the press, such as a panel's slide, with `state` the
   * one to show. Where both set the same value, these win.
   */
  variants?: Variants;
  state?: string;
}

/**
 * A button that grows a little on hover and sinks on press, by pointer or by its keyboard
 * shortcut (`isKeyDown`). Children can follow along through the `rest`, `hover` and `press`
 * variant labels.
 */
export function PressableButton({ isKeyDown = false, variants, state, disabled, ...props }: Props) {
  const reduceMotion = useReducedMotion();
  const press = isKeyDown ? 'press' : 'rest';
  return (
    <Button
      {...props}
      disabled={disabled}
      render={
        <motion.button
          type="button"
          variants={{ ...(reduceMotion ? PRESS_VARIANTS_REDUCED : PRESS_VARIANTS), ...variants }}
          initial={false}
          animate={state ? [press, state] : press}
          // Hover outranks `animate` in Motion, so drop it while the key holds the press.
          whileHover={isKeyDown || disabled ? undefined : 'hover'}
          whileTap={disabled ? undefined : 'press'}
          transition={RELEASE_SPRING}
        />
      }
    />
  );
}
