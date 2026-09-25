import type { CSSProperties, ReactNode } from 'react';
import { PipetteIcon } from 'lucide-react';
import { motion, useReducedMotion, type Variants } from 'motion/react';
import { hasUsableHue, type DetectionMode } from '../lib/blobDetection';
import { hexToRgb } from '../lib/color';
import { formatTimer } from '../lib/timer';
import { PANEL_STACK_VARIANTS, panelVariants } from '../lib/panelMotion';
import { PressableButton } from './PressableButton';
import { Card, CardAction, CardHeader, CardPanel, CardTitle } from '@/components/ui/card';
import { Kbd } from '@/components/ui/kbd';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

interface Props {
  /** Whether the panels are shown; each slides in and out on its own, staggered (Motion). */
  open: boolean;
  detectionMode: DetectionMode;
  onDetectionModeChange: (mode: DetectionMode) => void;
  threshold: number;
  onThresholdChange: (v: number) => void;
  onThresholdAdjustingChange: (adjusting: boolean) => void;
  minArea: number;
  onMinAreaChange: (v: number) => void;
  maxArea: number;
  onMaxAreaChange: (v: number) => void;
  targetColor: string;
  isPickingColor: boolean;
  onPickingColorChange: (picking: boolean) => void;
  /** Esc is held; it cancels picking, so the Pick/Cancel button shows it as a press. */
  isCancelPickKeyDown: boolean;
  targetTolerance: number;
  onTargetToleranceChange: (v: number) => void;
  onTargetToleranceAdjustingChange: (adjusting: boolean) => void;
  targetMinArea: number;
  onTargetMinAreaChange: (v: number) => void;
  triggerRadius: number;
  onTriggerRadiusChange: (v: number) => void;
  requiredConnections: number;
  onRequiredConnectionsChange: (v: number) => void;
  timerLengthMs: number;
  onTimerLengthChange: (ms: number) => void;
  /** Spotlight brightness, in percent of normal. */
  spotlightLight: number;
  onSpotlightLightChange: (v: number) => void;
  /** How visible the spotlight beams' haze is, in percent of normal. */
  spotlightDensity: number;
  onSpotlightDensityChange: (v: number) => void;
  testMode: boolean;
  onTestModeChange: (v: boolean) => void;
  flipX: boolean;
  onFlipXChange: (v: boolean) => void;
  flipY: boolean;
  onFlipYChange: (v: boolean) => void;
}

// A tick at every whole minute of the Timer length slider (in seconds), labelled in minutes.
const TIMER_LENGTH_TICKS = Array.from({ length: 10 }, (_, i) => ({
  value: (i + 1) * 60,
  label: String(i + 1),
}));

// A tick at every allowed value of the Required connections slider (1 to 10).
const REQUIRED_CONNECTIONS_TICKS = Array.from({ length: 10 }, (_, i) => ({
  value: i + 1,
  label: String(i + 1),
}));

export const GRAB_AREA_MIN = 20;
export const GRAB_AREA_MAX = 500;

const DETECTION_MODES = [
  { value: 'dark', label: 'Dark areas' },
  { value: 'red', label: 'Red areas' },
];

export function Controls({
  detectionMode,
  onDetectionModeChange,
  threshold,
  onThresholdChange,
  onThresholdAdjustingChange,
  minArea,
  onMinAreaChange,
  maxArea,
  onMaxAreaChange,
  targetColor,
  isPickingColor,
  onPickingColorChange,
  isCancelPickKeyDown,
  targetTolerance,
  onTargetToleranceChange,
  onTargetToleranceAdjustingChange,
  targetMinArea,
  onTargetMinAreaChange,
  triggerRadius,
  onTriggerRadiusChange,
  requiredConnections,
  onRequiredConnectionsChange,
  timerLengthMs,
  onTimerLengthChange,
  spotlightLight,
  onSpotlightLightChange,
  spotlightDensity,
  onSpotlightDensityChange,
  testMode,
  onTestModeChange,
  flipX,
  onFlipXChange,
  flipY,
  onFlipYChange,
  open,
}: Props) {
  const panel = panelVariants(useReducedMotion());

  return (
    // A stack of separate panels: the title bar, then one panel per section, scrolling
    // together when they don't fit the window.
    <motion.div
      className="flex max-h-full min-h-0 flex-col gap-3"
      variants={PANEL_STACK_VARIANTS}
      initial={false}
      animate={open ? 'open' : 'closed'}
    >
      <Card render={<motion.div variants={panel} />}>
        <CardHeader className="p-4">
          <CardTitle>Blob Tracking</CardTitle>
          <CardAction>
            <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
              <Kbd>H</Kbd>
              to hide
            </span>
          </CardAction>
        </CardHeader>
      </Card>
      {/* The stack only has a max height, so the viewport's own h-full can't resolve and it
          would grow to fit everything (clipped, not scrolled); flex sizes it instead.
          No scrollbar: the edge fade already shows there's more.
          The viewport clips, so it reaches out over the 16px margin to the browser's edge (and
          pads its content back), letting the panels slide all the way out of view. */}
      <ScrollArea
        scrollFade
        className="-ms-4 flex min-h-0 w-[calc(100%+1rem)] flex-1 flex-col *:data-[slot=scroll-area-scrollbar]:hidden *:data-[slot=scroll-area-viewport]:min-h-0 *:data-[slot=scroll-area-viewport]:flex-1"
      >
        <div className="flex flex-col gap-3 ps-4">
          <Section title="Source" variants={panel}>
            <SwitchRow label="Test mode (no camera)" checked={testMode} onChange={onTestModeChange} />
            <SwitchRow
              label="Flip horizontally"
              checked={flipX}
              onChange={onFlipXChange}
              disabled={testMode}
            />
            <SwitchRow
              label="Flip vertically"
              checked={flipY}
              onChange={onFlipYChange}
              disabled={testMode}
            />
          </Section>

          <Section title="Detection" variants={panel}>
            <div className="flex flex-col gap-2">
              <Label>Track</Label>
              <Select
                items={DETECTION_MODES}
                value={detectionMode}
                onValueChange={(v) => v && onDetectionModeChange(v as DetectionMode)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {DETECTION_MODES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <SliderRow
              label={detectionMode === 'red' ? 'Redness' : 'Threshold'}
              value={threshold}
              min={0}
              max={255}
              onChange={onThresholdChange}
              // The track shows what the value means: a brightness or a redness scale.
              className={detectionMode === 'red' ? 'slider-gradient--redness' : 'slider-gradient--brightness'}
              onPointerDown={() => onThresholdAdjustingChange(true)}
            />
            <SliderRow
              label="Min area"
              unit="px"
              value={minArea}
              min={10}
              max={2000}
              onChange={onMinAreaChange}
            />
            <SliderRow
              label="Max area"
              unit="px"
              value={maxArea}
              min={100}
              max={2000}
              onChange={onMaxAreaChange}
            />
          </Section>

          <Section title="Targets" variants={panel}>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-4">
                <Label>Colour</Label>
                <div className="flex items-center gap-2">
                  <span
                    className="size-5 rounded-full border border-white/20"
                    style={{ background: targetColor }}
                  />
                  <span className="text-muted-foreground text-sm tabular-nums">{targetColor}</span>
                  <PressableButton
                    size="sm"
                    variant={isPickingColor ? 'default' : 'outline'}
                    onClick={() => onPickingColorChange(!isPickingColor)}
                    isKeyDown={isCancelPickKeyDown}
                  >
                    <PipetteIcon />
                    {isPickingColor ? 'Cancel' : 'Pick'}
                  </PressableButton>
                </div>
              </div>
              {isPickingColor ? (
                <p className="text-muted-foreground text-xs">
                  Click the target colour in the camera view. <Kbd>Esc</Kbd> cancels.
                </p>
              ) : (
                !hasUsableHue(...hexToRgb(targetColor)) && (
                  <p className="text-destructive-foreground text-xs">
                    This colour is too grey to track. Pick a more colourful spot.
                  </p>
                )
              )}
            </div>
            <SliderRow
              label="Tolerance"
              unit="°"
              value={targetTolerance}
              min={1}
              max={90}
              onChange={onTargetToleranceChange}
              className="slider-gradient--target-color"
              style={{ '--target-color': targetColor } as CSSProperties}
              onPointerDown={() => onTargetToleranceAdjustingChange(true)}
            />
            <SliderRow
              label="Min area"
              unit="px"
              value={targetMinArea}
              min={10}
              max={5000}
              onChange={onTargetMinAreaChange}
            />
            <SliderRow
              label="Grab area"
              unit="px"
              value={triggerRadius}
              min={GRAB_AREA_MIN}
              max={GRAB_AREA_MAX}
              onChange={onTriggerRadiusChange}
            />
            <SliderRow
              label="Required connections"
              value={requiredConnections}
              min={1}
              max={10}
              ticks={REQUIRED_CONNECTIONS_TICKS}
              onChange={onRequiredConnectionsChange}
            />
          </Section>

          <Section title="Hologram timer" variants={panel}>
            <SliderRow
              label="Timer length"
              value={timerLengthMs / 1000}
              min={30}
              max={600}
              step={15}
              format={(seconds) => formatTimer(seconds * 1000)}
              ticks={TIMER_LENGTH_TICKS}
              onChange={(seconds) => onTimerLengthChange(seconds * 1000)}
            />
          </Section>

          <Section title="Spotlights" variants={panel}>
            <SliderRow
              label="Light"
              unit="%"
              value={spotlightLight}
              min={0}
              max={200}
              step={5}
              onChange={onSpotlightLightChange}
            />
            <SliderRow
              label="Density"
              unit="%"
              value={spotlightDensity}
              min={0}
              max={200}
              step={5}
              onChange={onSpotlightDensityChange}
            />
          </Section>
        </div>
      </ScrollArea>
    </motion.div>
  );
}

function Section({
  title,
  variants,
  children,
}: {
  title: string;
  /** Its part in the panel reveal; the open/closed state comes from the stack above. */
  variants: Variants;
  children: ReactNode;
}) {
  return (
    <Card render={<motion.section variants={variants} />}>
      <CardHeader className="p-4">
        <CardTitle render={<h2 />} className="font-medium text-muted-foreground text-xs">
          {title}
        </CardTitle>
      </CardHeader>
      <CardPanel className="flex flex-col gap-4 p-4">{children}</CardPanel>
    </Card>
  );
}

function SwitchRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Label className="justify-between gap-4 has-data-disabled:opacity-64">
      {label}
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </Label>
  );
}

function SliderRow({
  label,
  unit = '',
  value,
  min,
  max,
  step,
  format,
  ticks,
  onChange,
  className,
  style,
  onPointerDown,
}: {
  label: string;
  unit?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Shows the value some other way than a plain number (with `unit`). */
  format?: (v: number) => string;
  /** Marks drawn under the track at these values, optionally labelled. */
  ticks?: { value: number; label?: string }[];
  onChange: (v: number) => void;
  className?: string;
  style?: CSSProperties;
  onPointerDown?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3" style={style}>
      <div className="flex items-center justify-between gap-4">
        <Label>{label}</Label>
        <span className="text-muted-foreground text-sm tabular-nums">
          {format ? format(value) : `${value}${unit}`}
        </span>
      </div>
      <Slider
        aria-label={label}
        className={className}
        value={value}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : (v as number))}
        onPointerDown={onPointerDown}
      />
      {ticks && (
        // The thumb stays inside the track (edge alignment), so a value's position runs
        // from half a thumb in from the left to half a thumb in from the right.
        <div className="relative -mt-1 h-5 [--thumb:--spacing(5)] sm:[--thumb:--spacing(4)]">
          {ticks.map((t) => (
            <div
              key={t.value}
              className="absolute top-0 flex -translate-x-1/2 flex-col items-center gap-0.5"
              style={{
                left: `calc(var(--thumb) / 2 + ${(t.value - min) / (max - min)} * (100% - var(--thumb)))`,
              }}
            >
              <span className="h-1.5 w-px bg-muted-foreground/12" />
              {t.label && (
                <span className="text-[10px] text-muted-foreground/32 leading-none tabular-nums">
                  {t.label}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
