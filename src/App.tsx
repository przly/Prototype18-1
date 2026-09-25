import { useEffect, useState } from 'react';
import { CameraIcon, RotateCcwIcon, SlidersHorizontalIcon, VideoIcon, VideoOffIcon } from 'lucide-react';
import { motion, useReducedMotion, type Variants } from 'motion/react';
import { TextMorph } from 'torph/react';
import { useCameraDevices } from './hooks/useCameraDevices';
import { usePersistentState } from './hooks/usePersistentState';
import { CameraView, type PeakingSource } from './components/CameraView';
import { Controls, GRAB_AREA_MAX, GRAB_AREA_MIN } from './components/Controls';
import { DEFAULT_TIMER_MS } from './lib/timer';
import { PRESS_SPRING, RELEASE_SPRING } from './lib/pressMotion';
import { panelVariants } from './lib/panelMotion';
import { PressableButton } from './components/PressableButton';
import { Kbd } from '@/components/ui/kbd';
import type { DetectionMode } from './lib/blobDetection';
import './App.css';

export default function App() {
  const devices = useCameraDevices();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  // Every control panel setting is saved in the browser and restored on the next visit.
  const [detectionMode, setDetectionMode] = usePersistentState<DetectionMode>('detectionMode', 'red');
  // Each mode keeps its own threshold, since they measure different things.
  const [thresholds, setThresholds] = usePersistentState<Record<DetectionMode, number>>(
    'thresholds',
    { dark: 90, red: 80 }
  );
  const threshold = thresholds[detectionMode];
  const setThreshold = (v: number) => setThresholds((t) => ({ ...t, [detectionMode]: v }));
  const [minArea, setMinArea] = usePersistentState('minArea', 150);
  const [maxArea, setMaxArea] = usePersistentState('maxArea', 2000);
  // Targets are areas of this colour, matched by hue; it can be picked from the camera view.
  const [targetColor, setTargetColor] = usePersistentState('targetColor', '#2563eb');
  const [targetTolerance, setTargetTolerance] = usePersistentState('targetTolerance', 25);
  const [isPickingColor, setIsPickingColor] = useState(false);
  const [targetMinArea, setTargetMinArea] = usePersistentState('targetMinArea', 300);
  const [savedTriggerRadius, setTriggerRadius] = usePersistentState('triggerRadius', 80);
  // A value saved under an older slider range is brought inside the current one.
  const triggerRadius = Math.min(Math.max(savedTriggerRadius, GRAB_AREA_MIN), GRAB_AREA_MAX);
  const [requiredConnections, setRequiredConnections] = usePersistentState('requiredConnections', 2);
  // The threshold slider being dragged, whose mask is previewed on the feed meanwhile.
  const [adjustingThreshold, setAdjustingThreshold] = useState<PeakingSource | null>(null);
  const [testMode, setTestMode] = usePersistentState('testMode', false);
  const [flipX, setFlipX] = usePersistentState('flipX', true);
  const [flipY, setFlipY] = usePersistentState('flipY', false);
  // Bumped by the reset button; CameraView restarts every target's countdown when it changes.
  const [timerResetCount, setTimerResetCount] = useState(0);
  const [timerLengthMs, setTimerLengthMs] = usePersistentState('timerLengthMs', DEFAULT_TIMER_MS);
  // Spotlight brightness and beam haze, in percent of normal.
  const [spotlightLight, setSpotlightLight] = usePersistentState('spotlightLight', 100);
  const [spotlightDensity, setSpotlightDensity] = usePersistentState('spotlightDensity', 100);
  // The start/stop camera button (or S) turns the camera stream on and off. It starts off.
  const [cameraOn, setCameraOn] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(true);
  const [cameraViewOpen, setCameraViewOpen] = useState(true);
  // The Controls and Camera buttons slide the same way as their panels, in the opposite state.
  const reduceMotion = useReducedMotion();
  const showControlsVariants = panelVariants(reduceMotion);
  const showCameraViewVariants = panelVariants(reduceMotion, 'right');

  // The shortcut key being held, so its button shows the same pressed state as a click.
  const [heldKey, setHeldKey] = useState<string | null>(null);

  // Keyboard shortcuts, each acting like a press of its button: H shows or hides the control
  // panel, C the camera view, S starts or stops the camera (not in test mode, where its button
  // is disabled), R resets the hologram timers, and Esc cancels picking a colour (only while
  // picking, when the Pick button reads Cancel). They act on key-down, like a button's press.
  // Skipped while typing into a field, on key repeat and with modifier keys.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const key = e.key.toLowerCase();
      if (key === 'h') setControlsOpen((open) => !open);
      else if (key === 'c') setCameraViewOpen((open) => !open);
      else if (key === 's' && !testMode) setCameraOn((on) => !on);
      else if (key === 'escape' && isPickingColor) setIsPickingColor(false);
      else if (key === 'r') setTimerResetCount((n) => n + 1);
      else return;
      setHeldKey(key);
    }
    function onKeyUp(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      setHeldKey((held) => (held === key ? null : held));
    }
    // A key released while the window is in the background never sends keyup.
    const releaseAll = () => setHeldKey(null);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseAll);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseAll);
    };
  }, [testMode, isPickingColor]);

  useEffect(() => {
    if (!deviceId && devices.length > 0) {
      setDeviceId(devices[0].deviceId);
    }
  }, [devices, deviceId]);

  useEffect(() => {
    if (!adjustingThreshold) return;
    const stop = () => setAdjustingThreshold(null);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [adjustingThreshold]);

  return (
    <div className="h-dvh w-full overflow-hidden">
      {/* Floating control panels over the full-screen 3D scene. They stay mounted and slide
          in and out (Motion, see lib/panelMotion); H toggles them. The wrapper lets clicks
          through to the scene, and each surface takes them back only while it's shown. */}
      <div className="pointer-events-none fixed top-4 left-4 z-20 flex max-h-[calc(100dvh-2rem)] w-[min(340px,calc(100vw-2rem))] flex-col">
        <div
          className={`flex max-h-full min-h-0 flex-col ${controlsOpen ? 'pointer-events-auto' : ''}`}
          inert={!controlsOpen}
        >
          <Controls
            open={controlsOpen}
            detectionMode={detectionMode}
            onDetectionModeChange={setDetectionMode}
            threshold={threshold}
            onThresholdChange={setThreshold}
            onThresholdAdjustingChange={(on) => setAdjustingThreshold(on ? 'blobs' : null)}
            minArea={minArea}
            onMinAreaChange={setMinArea}
            maxArea={maxArea}
            onMaxAreaChange={setMaxArea}
            targetColor={targetColor}
            isPickingColor={isPickingColor}
            onPickingColorChange={setIsPickingColor}
            isCancelPickKeyDown={heldKey === 'escape'}
            targetTolerance={targetTolerance}
            onTargetToleranceChange={setTargetTolerance}
            onTargetToleranceAdjustingChange={(on) => setAdjustingThreshold(on ? 'targets' : null)}
            targetMinArea={targetMinArea}
            onTargetMinAreaChange={setTargetMinArea}
            triggerRadius={triggerRadius}
            onTriggerRadiusChange={setTriggerRadius}
            requiredConnections={requiredConnections}
            onRequiredConnectionsChange={setRequiredConnections}
            timerLengthMs={timerLengthMs}
            onTimerLengthChange={setTimerLengthMs}
            spotlightLight={spotlightLight}
            onSpotlightLightChange={setSpotlightLight}
            spotlightDensity={spotlightDensity}
            onSpotlightDensityChange={setSpotlightDensity}
            testMode={testMode}
            onTestModeChange={setTestMode}
            flipX={flipX}
            onFlipXChange={setFlipX}
            flipY={flipY}
            onFlipYChange={setFlipY}
          />
        </div>
        <PressableButton
          variant="outline"
          className={`absolute top-0 left-0 ${controlsOpen ? '' : 'pointer-events-auto'}`}
          inert={controlsOpen}
          onClick={() => setControlsOpen(true)}
          variants={showControlsVariants}
          state={controlsOpen ? 'closed' : 'open'}
          isKeyDown={heldKey === 'h'}
        >
          <SlidersHorizontalIcon />
          Controls
          <Kbd>H</Kbd>
        </PressableButton>
      </div>
      {/* Brings the camera view back; it sits where the view's corner does while it's hidden. */}
      <PressableButton
        variant="outline"
        className={`fixed right-4 bottom-4 z-20 ${cameraViewOpen ? 'pointer-events-none' : ''}`}
        inert={cameraViewOpen}
        onClick={() => setCameraViewOpen(true)}
        variants={showCameraViewVariants}
        state={cameraViewOpen ? 'closed' : 'open'}
        isKeyDown={heldKey === 'c'}
      >
        <CameraIcon />
        Camera
        <Kbd>C</Kbd>
      </PressableButton>
      <div className="fixed top-4 left-1/2 z-20 -translate-x-1/2">
        {/* The camera isn't used in test mode, so there's nothing to start or stop. */}
        <PressableButton
          variant="outline"
          // The right padding matches the reset button's, so the S key sits as evenly in it.
          // While stopped it's a faint wash of the scene's warning orange, so it's noticed
          // without drawing much attention.
          className={
            cameraOn
              ? 'pe-[7px] sm:pe-[5px]'
              : 'pe-[7px] sm:pe-[5px] border-[#ff8a1f]/40 bg-[#ff8a1f]/15 text-[#ff8a1f] backdrop-blur-sm hover:bg-[#ff8a1f]/25 data-pressed:bg-[#ff8a1f]/25 dark:bg-[#ff8a1f]/15 dark:hover:bg-[#ff8a1f]/25 dark:data-pressed:bg-[#ff8a1f]/25'
          }
          disabled={testMode}
          onClick={() => setCameraOn((on) => !on)}
          isKeyDown={heldKey === 's'}
        >
          {cameraOn ? <VideoOffIcon /> : <VideoIcon />}
          {/* Morphs between the two labels, keeping the shared "camera" in place. */}
          <TextMorph>{cameraOn ? 'Stop camera' : 'Start camera'}</TextMorph>
          <Kbd className={cameraOn ? undefined : 'bg-[#ff8a1f]/15 text-[#ff8a1f]'}>S</Kbd>
        </PressableButton>
      </div>
      <div className="fixed bottom-4 left-1/2 z-20 -translate-x-1/2">
        <ResetTimersButton
          onReset={() => setTimerResetCount((n) => n + 1)}
          isKeyDown={heldKey === 'r'}
        />
      </div>
      <CameraView
        open={cameraViewOpen}
        devices={devices}
        deviceId={deviceId}
        onDeviceChange={setDeviceId}
        detectionMode={detectionMode}
        threshold={threshold}
        minArea={minArea}
        maxArea={maxArea}
        targetColor={targetColor}
        targetTolerance={targetTolerance}
        isPickingColor={isPickingColor}
        onColorPick={(hex) => {
          setTargetColor(hex);
          setIsPickingColor(false);
        }}
        targetMinArea={targetMinArea}
        peaking={adjustingThreshold}
        triggerRadius={triggerRadius}
        requiredConnections={requiredConnections}
        testMode={testMode}
        cameraOn={cameraOn}
        flipX={!testMode && flipX}
        flipY={!testMode && flipY}
        timerResetCount={timerResetCount}
        timerLengthMs={timerLengthMs}
        spotlightLight={spotlightLight / 100}
        spotlightDensity={spotlightDensity / 100}
      />
    </div>
  );
}

// The icon turns the way a reset goes, hinting at the action before it's taken.
const RESET_ICON_VARIANTS: Variants = {
  rest: { rotate: 0 },
  hover: { rotate: -30 },
  press: { rotate: -60, transition: PRESS_SPRING },
};

/** `isKeyDown`: its keyboard shortcut is held, so it shows the same press as a click. */
function ResetTimersButton({ onReset, isKeyDown }: { onReset: () => void; isKeyDown: boolean }) {
  const reduceMotion = useReducedMotion();
  return (
    <PressableButton
      // The right padding matches the space above and below the R key: button height (36px,
      // 32px from sm) minus the key's 20px, halved, minus the 1px border.
      className="border-[#FFE000] bg-[#FFE000] pe-[7px] text-black shadow-[#FFE000]/24 hover:bg-[#FFE000]/90 data-pressed:bg-[#FFE000]/90 sm:pe-[5px]"
      onClick={onReset}
      isKeyDown={isKeyDown}
    >
      <motion.span
        className="inline-flex"
        variants={reduceMotion ? undefined : RESET_ICON_VARIANTS}
        transition={RELEASE_SPRING}
      >
        <RotateCcwIcon />
      </motion.span>
      Reset hologram timers
      <Kbd className="bg-black/10 text-black/60">R</Kbd>
    </PressableButton>
  );
}
