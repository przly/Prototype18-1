"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { motion, useReducedMotion, type Variants } from "motion/react";
import * as React from "react";
import { PRESS_SPRING, RELEASE_SPRING } from "@/lib/pressMotion";
import { cn } from "@/lib/utils";

// Thumb hover/press, matching the reset button's feel but larger, since the thumb is tiny:
// it grows under the pointer and presses in while held or dragged.
const THUMB_VARIANTS: Variants = {
  rest: { scale: 1 },
  hover: { scale: 1.2 },
  press: { scale: 0.9, transition: PRESS_SPRING },
};
// Reduced motion: no scaling, just a gentle dim while held.
const THUMB_VARIANTS_REDUCED: Variants = {
  rest: { opacity: 1 },
  press: { opacity: 0.8, transition: { duration: 0.1 } },
};

export function Slider({
  className,
  children,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: SliderPrimitive.Root.Props): React.ReactElement {
  const reduceMotion = useReducedMotion();
  const _values = React.useMemo(() => {
    if (value !== undefined) {
      return Array.isArray(value) ? value : [value];
    }
    if (defaultValue !== undefined) {
      return Array.isArray(defaultValue) ? defaultValue : [defaultValue];
    }
    return [min];
  }, [value, defaultValue, min]);

  return (
    <SliderPrimitive.Root
      className={cn("data-[orientation=horizontal]:w-full", className)}
      defaultValue={defaultValue}
      max={max}
      min={min}
      thumbAlignment="edge"
      value={value}
      {...props}
    >
      {children}
      <SliderPrimitive.Control
        className="flex touch-none select-none data-disabled:pointer-events-none data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=horizontal]:w-full data-[orientation=horizontal]:min-w-44 data-[orientation=vertical]:flex-col data-disabled:opacity-64"
        data-slot="slider-control"
      >
        <SliderPrimitive.Track
          className="relative grow select-none before:absolute before:rounded-full before:bg-input data-[orientation=horizontal]:h-1 data-[orientation=vertical]:h-full data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-1 data-[orientation=horizontal]:before:inset-x-0.5 data-[orientation=vertical]:before:inset-x-0 data-[orientation=horizontal]:before:inset-y-0 data-[orientation=vertical]:before:inset-y-0.5"
          data-slot="slider-track"
        >
          <SliderPrimitive.Indicator
            className="select-none rounded-full bg-primary data-[orientation=horizontal]:ms-0.5 data-[orientation=vertical]:mb-0.5"
            data-slot="slider-indicator"
          />
          {Array.from({ length: _values.length }, (_, index) => (
            <SliderPrimitive.Thumb
              className="block size-5 shrink-0 select-none rounded-full border border-input bg-white not-dark:bg-clip-padding shadow-xs/5 outline-none transition-shadow before:absolute before:inset-0 before:rounded-full before:shadow-[0_1px_--theme(--color-black/4%)] has-focus-visible:ring-[3px] has-focus-visible:ring-ring/24 sm:size-4 dark:border-background dark:has-focus-visible:ring-ring/48 [:has(*:focus-visible),[data-dragging]]:shadow-none"
              data-slot="slider-thumb"
              index={index}
              key={String(index)}
              // Held for the whole drag, whether it began on the thumb or on the track.
              render={(props, state) => (
                <motion.div
                  {...(props as React.ComponentProps<typeof motion.div>)}
                  variants={reduceMotion ? THUMB_VARIANTS_REDUCED : THUMB_VARIANTS}
                  initial={false}
                  animate={state.dragging ? "press" : "rest"}
                  whileHover={state.dragging ? undefined : "hover"}
                  transition={RELEASE_SPRING}
                />
              )}
            />
          ))}
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export function SliderValue({
  className,
  ...props
}: SliderPrimitive.Value.Props): React.ReactElement {
  return (
    <SliderPrimitive.Value
      className={cn("flex justify-end text-sm", className)}
      data-slot="slider-value"
      {...props}
    />
  );
}

export { SliderPrimitive };
