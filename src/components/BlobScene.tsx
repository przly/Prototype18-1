import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import {
  Edges,
  GizmoHelper,
  GizmoViewport,
  Line,
  OrbitControls,
  SpotLight,
  useAnimations,
  useDepthBuffer,
  useGLTF,
} from '@react-three/drei';
import * as THREE from 'three';
import type { TrackedBlob } from '../lib/blobTracker';

// Width of the tracking plane in world units; height follows the source aspect ratio.
const WORLD_WIDTH = 16;
const MODEL_URL = '/models/anime_boy_body_low_poly.glb';
// Targets 1 and 2 are shown as these animated models instead of cubes. Both share the
// same rig and dance.
const ROBOT_MODEL_URLS = ['/models/robot_playground.glb', '/models/robot_playground_v2.glb'];
// Height of every figure in world units, whatever the size of its blob; about what a
// typical blob gave before, when figures were sized by it.
const FIGURE_HEIGHT = 1.3;
// Figures are white until they connect to a target, then CONNECTED_COLOR.
const FIGURE_COLOR = '#ffffff';
const CONNECTED_COLOR = '#39ff6a';
// Grab area and its text once the robot starts fading.
const FADING_COLOR = '#ff8a1f';
// The robot starts fading when this fraction of its countdown is left.
const ROBOT_FADE_FRACTION = 0.5;
// Targets (the robot, and the cubes standing in for the others) are this much taller than a figure.
const TARGET_HEIGHT = FIGURE_HEIGHT * 1.5;
const CUBE_SIZE = TARGET_HEIGHT;
// Drawing order of the see-through layers lying on the floor, bottom first. They sit at
// almost the same height and the same spot (a spotlight's pool eases onto its target), so
// three.js's own back-to-front sort would swap them from frame to frame, which flickers.
const FLOOR_LAYER = { lightPool: 1, grabFill: 2, grabRing: 3 };
// Opacity of the grab area's fill and stroke on the floor, kept low so they don't compete
// with the figures (except the green stroke, see GrabRing's opacity).
const GRAB_AREA_OPACITY = 0.1;
// Opacity of the lines joining a target to the figures connected to it.
const CONNECTOR_OPACITY = 0.15;
const CUBE_COLOR = '#c8d0e0';
// Corner spotlights: how high above the floor they hang, and their beam.
const SPOTLIGHT_HEIGHT = 5;
const SPOTLIGHT_COLOR = '#fff1d6';
const SPOTLIGHT_ANGLE = 0.3;
// Light intensity and beam/pool opacity at normal brightness (level 1).
const SPOTLIGHT_INTENSITY = 40;
const SPOTLIGHT_OPACITY = 0.35;
// Range of a target's light level: how dim a target with no share of the connections gets,
// and how bright one with all of them gets.
const MIN_LIGHT_LEVEL = 0.15;
const MAX_LIGHT_LEVEL = 2;
// How quickly a spotlight eases to a new light level; lower is slower (about 1 / seconds).
const LIGHT_LEVEL_EASING = 1;

export interface SceneInterestPoint {
  id: number;
  x: number;
  y: number;
  connectedBlobIds: number[];
  remainingMs: number;
  timerRate: number;
}

interface Props {
  blobs: TrackedBlob[];
  connectedIds: Set<number>;
  interestPoints: SceneInterestPoint[];
  /** Every target's reach (the grab area), in display pixels, whatever its colour area's size. */
  triggerRadius: number;
  requiredConnections: number;
  /** Full length of each target's countdown, for fading the robot as it runs down. */
  timerLengthMs: number;
  /** Spotlight brightness (light and floor pool), as a multiple of normal. */
  spotlightLight: number;
  /** How visible the spotlight beams' haze is, as a multiple of normal. */
  spotlightDensity: number;
  width: number;
  height: number;
  /** How the camera feed is flipped on screen, so the scene matches what the user sees. */
  flipX: boolean;
  flipY: boolean;
  /** Video or canvas showing the camera view, projected onto the floor. */
  feedElement: HTMLVideoElement | HTMLCanvasElement | null;
}

export function BlobScene({
  blobs,
  connectedIds,
  interestPoints,
  triggerRadius,
  requiredConnections,
  timerLengthMs,
  spotlightLight,
  spotlightDensity,
  width,
  height,
  flipX,
  flipY,
  feedElement,
}: Props) {
  if (width === 0 || height === 0) return null;

  const worldHeight = WORLD_WIDTH * (height / width);
  const unitsPerPixel = WORLD_WIDTH / width;

  // Blob coordinates are in display pixels (origin top-left); the scene is centered, y-up.
  function toWorld(x: number, y: number): [number, number, number] {
    const wx = (x / width - 0.5) * WORLD_WIDTH;
    const wy = (0.5 - y / height) * worldHeight;
    return [flipX ? -wx : wx, flipY ? -wy : wy, 0];
  }

  const blobPositions = new Map(blobs.map((b) => [b.id, toWorld(b.x, b.y)]));
  const pointPositions = interestPoints.map((p) => toWorld(p.x, p.y));

  // Each target's light level follows its share of all connections: an even share is normal
  // brightness (1), taking more of them brightens it and leaves the others dimmer.
  // With nobody connected, every target is at normal brightness.
  const totalConnections = interestPoints.reduce((sum, p) => sum + p.connectedBlobIds.length, 0);
  const lightLevels = interestPoints.map((p) =>
    totalConnections === 0
      ? 1
      : THREE.MathUtils.clamp(
          (p.connectedBlobIds.length / totalConnections) * interestPoints.length,
          MIN_LIGHT_LEVEL,
          MAX_LIGHT_LEVEL,
        ),
  );

  function nearestPointTo(b: TrackedBlob): [number, number, number] | null {
    let nearest: [number, number, number] | null = null;
    let nearestDistance = Infinity;
    interestPoints.forEach((p, i) => {
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d < nearestDistance) {
        nearestDistance = d;
        nearest = pointPositions[i];
      }
    });
    return nearest;
  }

  return (
    <div className="blob-scene">
      <Canvas camera={{ position: [0, 11, 11], fov: 50 }} dpr={[1, 2]}>
        <color attach="background" args={['#0b0d12']} />
        {/* The scene is built with z as up; turn it -90° about x so it lies flat in
            three.js's y-up world and orbits like a floor. */}
        <group rotation={[-Math.PI / 2, 0, 0]}>
          <ambientLight intensity={0.2} />
          <pointLight position={[0, 0, 10]} intensity={40} />
          <directionalLight position={[5, 8, 6]} intensity={0.6} />

          <CornerSpotlights
            worldHeight={worldHeight}
            targets={pointPositions}
            levels={lightLevels}
            light={spotlightLight}
            density={spotlightDensity}
          />

          <PlaneFrame
            width={WORLD_WIDTH}
            height={worldHeight}
            feedElement={feedElement}
            flipX={flipX}
            flipY={flipY}
          />

          <Suspense fallback={null}>
            {blobs.map((b) => (
              <Figure
                key={b.id}
                position={blobPositions.get(b.id)!}
                lookAt={nearestPointTo(b)}
                height={FIGURE_HEIGHT}
                connected={connectedIds.has(b.id)}
              />
            ))}
          </Suspense>

          {interestPoints.map((p, i) => {
            const count = p.connectedBlobIds.length;
            // The robot fades out over the last part of the countdown.
            const fadeOpacity = Math.min(p.remainingMs / (timerLengthMs * ROBOT_FADE_FRACTION), 1);
            const fading = fadeOpacity < 1;
            // Orange while fading, whoever is connected; otherwise the connection state.
            const color = fading
              ? FADING_COLOR
              : count >= requiredConnections
                ? CONNECTED_COLOR
                : count > 0
                  ? '#ffe600'
                  : '#4fd1ff';
            const grabRadius = Math.max(triggerRadius * unitsPerPixel, 0.05);
            const [px, py] = pointPositions[i];
            const cube = (
              <mesh position={[px, py, CUBE_SIZE / 2]}>
                <boxGeometry args={[CUBE_SIZE, CUBE_SIZE, CUBE_SIZE]} />
                <meshStandardMaterial color={CUBE_COLOR} transparent opacity={0.6} />
                <Edges color={CUBE_COLOR} />
              </mesh>
            );
            return (
              <group key={p.id}>
                {/* Grab area on the floor; it carries the connection state colour. */}
                <mesh position={[px, py, 0.005]} renderOrder={FLOOR_LAYER.grabFill}>
                  <circleGeometry args={[grabRadius, 64]} />
                  <meshBasicMaterial
                    color={color}
                    transparent
                    opacity={GRAB_AREA_OPACITY}
                    depthWrite={false}
                  />
                </mesh>
                <GrabRing
                  position={[px, py, 0.006]}
                  radius={grabRadius}
                  color={color}
                  timeLeft={p.remainingMs / timerLengthMs}
                  // Stronger while the timer is running down (enough people connected) or filling
                  // back up (not enough, and not yet full), so its progress is easy to see.
                  opacity={
                    count >= requiredConnections || p.remainingMs < timerLengthMs
                      ? 0.5
                      : GRAB_AREA_OPACITY
                  }
                  dashed={count === 0}
                  text={
                    fading
                      ? ['OH NO', 'YOU SHOULD GIVE MORE ATTENTION TO OTHER HOLOGRAMS']
                      : count === 0
                        ? 'MOVE CLOSER'
                        : count < requiredConnections
                          ? ['WATCHING ALONE IS BORING, RIGHT?', 'FIND COMPANY']
                          : 'NICE, INVITE MORE PEOPLE'
                  }
                />
                {i < ROBOT_MODEL_URLS.length ? (
                  // The cube stands in while the model loads.
                  <Suspense fallback={cube}>
                    <RobotTarget
                      url={ROBOT_MODEL_URLS[i]}
                      position={[px, py, 0]}
                      height={TARGET_HEIGHT}
                      playing={p.remainingMs > 0 && p.timerRate > 0}
                      opacity={fadeOpacity}
                    />
                  </Suspense>
                ) : (
                  cube
                )}
                {p.connectedBlobIds.map((id) => {
                  const blobPos = blobPositions.get(id);
                  return (
                    blobPos && (
                      <Line
                        key={`connector-${id}`}
                        points={[pointPositions[i], blobPos]}
                        color={CONNECTED_COLOR}
                        lineWidth={2}
                        transparent
                        opacity={CONNECTOR_OPACITY}
                        depthWrite={false}
                      />
                    )
                  );
                })}
              </group>
            );
          })}
        </group>

        <OrbitControls enableDamping makeDefault />
        <GizmoHelper alignment="bottom-left" margin={[56, 56]}>
          {/* Rotated with the scene so it shows the scene's own axes. Clicking is disabled
              because the gizmo would tween the camera along the unrotated axis. */}
          <GizmoViewport
            rotation={[-Math.PI / 2, 0, 0]}
            disabled
            axisColors={[AXIS_COLORS.x, AXIS_COLORS.y, AXIS_COLORS.z]}
            labelColor="#0b0d12"
            scale={30}
          />
        </GizmoHelper>
      </Canvas>
    </div>
  );
}

interface PlaneFrameProps {
  width: number;
  height: number;
  feedElement: HTMLVideoElement | HTMLCanvasElement | null;
  flipX: boolean;
  flipY: boolean;
}

function PlaneFrame({ width, height, feedElement, flipX, flipY }: PlaneFrameProps) {
  const hw = width / 2;
  const hh = height / 2;
  return (
    <group>
      {feedElement ? (
        <FloorFeed
          width={width}
          height={height}
          element={feedElement}
          flipX={flipX}
          flipY={flipY}
        />
      ) : (
        <>
          <mesh position={[0, 0, -0.02]}>
            <planeGeometry args={[width, height]} />
            <meshStandardMaterial color="#141821" />
          </mesh>
          <gridHelper
            args={[Math.max(width, height), 16, '#2a3140', '#1c212c']}
            rotation={[Math.PI / 2, 0, 0]}
            position={[0, 0, -0.01]}
          />
        </>
      )}
      <Line
        points={[
          [-hw, -hh, 0],
          [hw, -hh, 0],
          [hw, hh, 0],
          [-hw, hh, 0],
          [-hw, -hh, 0],
        ]}
        color="#3a4458"
        lineWidth={1}
      />
    </group>
  );
}

const AXIS_COLORS = { x: '#ff5a5a', y: '#5aff7a', z: '#5a9aff' };

// Multiplies the feed's colours so the figures and targets stand out against it.
const FLOOR_FEED_TINT = '#5a5a5a';

/** The live camera view (or test canvas) as a texture on the floor plane. */
function FloorFeed({
  width,
  height,
  element,
  flipX,
  flipY,
}: {
  width: number;
  height: number;
  element: HTMLVideoElement | HTMLCanvasElement;
  flipX: boolean;
  flipY: boolean;
}) {
  const texture = useMemo(() => {
    const texture =
      element instanceof HTMLVideoElement
        ? new THREE.VideoTexture(element)
        : new THREE.CanvasTexture(element);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, [element]);

  useEffect(() => () => texture.dispose(), [texture]);

  // Match the flipped camera view, so the floor lines up with the figures' positions.
  useEffect(() => {
    texture.repeat.set(flipX ? -1 : 1, flipY ? -1 : 1);
    texture.offset.set(flipX ? 1 : 0, flipY ? 1 : 0);
  }, [texture, flipX, flipY]);

  // Video textures refresh on their own; the test canvas has to be re-uploaded each frame.
  useFrame(() => {
    if (texture instanceof THREE.CanvasTexture) texture.needsUpdate = true;
  });

  return (
    <mesh position={[0, 0, -0.02]}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} color={FLOOR_FEED_TINT} toneMapped={false} />
    </mesh>
  );
}

// Width of the grab area's stroke, and the length of a dash (and of the gap after it)
// when it's dashed, in world units.
const GRAB_RING_WIDTH = 0.04;
const GRAB_RING_DASH = 0.2;
// How fast the dashes travel around the ring, in world units per second along the stroke.
const GRAB_RING_DASH_SPEED = 0.3;

interface GrabRingProps {
  position: [number, number, number];
  radius: number;
  color: string;
  /** Fraction of the target's countdown left; the stroke runs this far round, clockwise from the top. */
  timeLeft: number;
  opacity: number;
  dashed: boolean;
  /** Written around the outside of the ring, if any; several parts are spread evenly around it. */
  text: string | string[] | null;
}

// Draws the part of a ring from 12 o'clock clockwise to `progress` of the way round, solid
// or dashed; `dashPhase` (radians) moves the dashes anticlockwise.
const GRAB_RING_VERTEX_SHADER = `
  varying vec2 vPosition;
  void main() {
    vPosition = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const GRAB_RING_FRAGMENT_SHADER = `
  #define TAU 6.283185307179586
  uniform vec3 color;
  uniform float opacity;
  uniform float progress;
  uniform float dashCount;
  uniform float dashPhase;
  varying vec2 vPosition;
  void main() {
    // Clockwise angle from the top, seen from above, in [0, TAU).
    float angle = mod(atan(vPosition.x, vPosition.y), TAU);
    if (angle >= progress * TAU) discard;
    if (dashCount > 0.0 && fract((angle + dashPhase) * dashCount / TAU) >= 0.5) discard;
    gl_FragColor = vec4(color, opacity);
    #include <colorspace_fragment>
  }
`;

/** The grab area's outline on the floor, showing the time left; dashed while it's waiting. */
function GrabRing({ position, radius, color, timeLeft, opacity, dashed, text }: GrabRingProps) {
  const inner = radius - GRAB_RING_WIDTH;
  // A whole number of dash + gap pairs, so the last gap meets the first dash evenly.
  const dashCount = Math.max(4, Math.round((2 * Math.PI * radius) / (GRAB_RING_DASH * 2)));
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: GRAB_RING_VERTEX_SHADER,
        fragmentShader: GRAB_RING_FRAGMENT_SHADER,
        uniforms: {
          color: { value: new THREE.Color() },
          opacity: { value: 1 },
          progress: { value: 1 },
          dashCount: { value: 0 },
          dashPhase: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const textRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    const { uniforms } = material;
    uniforms.color.value.set(color);
    uniforms.opacity.value = opacity;
    uniforms.progress.value = THREE.MathUtils.clamp(timeLeft, 0, 1);
    uniforms.dashCount.value = dashed ? dashCount : 0;
    // Turn the dashes and text at the same speed along the stroke whatever the radius; the
    // text goes clockwise, the opposite way to the dashes.
    const turn = (GRAB_RING_DASH_SPEED / radius) * delta;
    if (dashed) uniforms.dashPhase.value = (uniforms.dashPhase.value + turn) % (2 * Math.PI);
    if (textRef.current) textRef.current.rotation.z -= turn;
  });

  return (
    <group position={position}>
      <mesh renderOrder={FLOOR_LAYER.grabRing} material={material}>
        <ringGeometry args={[inner, radius, 128]} />
      </mesh>
      {/* Always fully visible, even when the ring itself is faded, so it can be read. */}
      {text && (
        <group ref={textRef}>
          {/* Joined into one string so a new array each render doesn't redraw the texture. */}
          <RingText
            text={typeof text === 'string' ? text : text.join('\n')}
            radius={radius}
            color={color}
          />
        </group>
      )}
    </group>
  );
}

// Height of the letters, and their distance outside the stroke, in world units.
const RING_TEXT_HEIGHT = 0.2;
const RING_TEXT_GAP = 0.08;
// Texture sharpness, in canvas pixels per world unit, and the largest canvas allowed.
const RING_TEXT_RESOLUTION = 160;
const RING_TEXT_MAX_CANVAS = 2048;
// Most of the ring's circumference one copy of the text may take up before it's shrunk.
const RING_TEXT_MAX_FILL = 0.85;
const RING_TEXT_FONT_FAMILY = "'Inter Variable', sans-serif";

/**
 * Text repeated evenly around the outside of a grab ring, lying flat on the floor. Lines of
 * the text are separate parts, spread evenly around the ring.
 */
function RingText({ text, radius, color }: { text: string; radius: number; color: string }) {
  const halfSize = radius + RING_TEXT_GAP + RING_TEXT_HEIGHT;
  const canvasSize = Math.min(RING_TEXT_MAX_CANVAS, Math.ceil(halfSize * 2 * RING_TEXT_RESOLUTION));

  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, [canvasSize]);

  useEffect(() => () => texture.dispose(), [texture]);

  useEffect(() => {
    const canvas = texture.image as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pxPerUnit = canvasSize / (halfSize * 2);
    const fontSize = Math.round(RING_TEXT_HEIGHT * pxPerUnit);
    const font = `600 ${fontSize}px ${RING_TEXT_FONT_FAMILY}`;
    let cancelled = false;
    const draw = () => {
      if (cancelled) return;
      const centre = canvasSize / 2;
      // Letters sit on a circle through their middles.
      const textRadius = (radius + RING_TEXT_GAP + RING_TEXT_HEIGHT / 2) * pxPerUnit;
      const circumference = 2 * Math.PI * textRadius;
      ctx.clearRect(0, 0, canvasSize, canvasSize);
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const parts = text.split('\n').map((part) => [...part]);
      const measure = () => {
        const tracking = ctx.measureText(' ').width * 0.3;
        return parts.map((chars) => chars.map((c) => ctx.measureText(c).width + tracking));
      };
      const totalWidth = (widths: number[][]) => widths.flat().reduce((a, b) => a + b, 0);
      ctx.font = font;
      let widths = measure();
      let textWidth = totalWidth(widths);
      // Shrink the letters if one copy wouldn't fit around the ring with a little space left.
      const maxWidth = circumference * RING_TEXT_MAX_FILL;
      if (textWidth > maxWidth) {
        ctx.font = `600 ${fontSize * (maxWidth / textWidth)}px ${RING_TEXT_FONT_FAMILY}`;
        widths = measure();
        textWidth = totalWidth(widths);
      }
      // As many copies as fit with at least the text's worth of space between, and each part
      // of each copy centred on its own evenly spaced spot around the ring.
      const repeats = Math.max(1, Math.floor(circumference / (textWidth * 2)));
      const slots = repeats * parts.length;
      for (let slot = 0; slot < slots; slot++) {
        const partWidths = widths[slot % parts.length];
        const partWidth = partWidths.reduce((a, b) => a + b, 0);
        // Angles run clockwise on the canvas, which is clockwise seen from above.
        let angle = (slot / slots) * 2 * Math.PI - partWidth / 2 / textRadius;
        parts[slot % parts.length].forEach((c, i) => {
          ctx.save();
          ctx.translate(
            centre + textRadius * Math.cos(angle),
            centre + textRadius * Math.sin(angle),
          );
          // Tops of the letters point outward, reading along the ring.
          ctx.rotate(angle + Math.PI / 2);
          ctx.fillText(c, 0, 0);
          ctx.restore();
          angle += partWidths[i] / textRadius;
        });
      }
      texture.needsUpdate = true;
    };
    // Draw now, then again once the app's font has loaded, in case it wasn't yet.
    draw();
    document.fonts.load(font).then(draw, () => {});
    return () => {
      cancelled = true;
    };
  }, [texture, canvasSize, halfSize, radius, color, text]);

  return (
    <mesh renderOrder={FLOOR_LAYER.grabRing}>
      <planeGeometry args={[halfSize * 2, halfSize * 2]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

// Soft white disc, bright in the middle and fading to nothing at the rim, for light pools.
function createPoolTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.5)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A spotlight over each corner of the floor. They share a depth buffer of the scene, so each
 * beam fades out softly where it passes into the floor instead of ending in a hard line.
 */
function CornerSpotlights({
  worldHeight,
  ...props
}: { worldHeight: number } & Omit<
  Parameters<typeof CornerSpotlight>[0],
  'position' | 'depthBuffer'
>) {
  const depthBuffer = useDepthBuffer({ size: 256 });
  return (
    <>
      {[
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([sx, sy]) => (
        <CornerSpotlight
          key={`${sx},${sy}`}
          position={[(sx * WORLD_WIDTH) / 2, (sy * worldHeight) / 2, SPOTLIGHT_HEIGHT]}
          depthBuffer={depthBuffer}
          {...props}
        />
      ))}
    </>
  );
}

/**
 * A spotlight hanging above one corner of the floor that follows the target nearest to it,
 * easing over when targets are dragged. The floor shows the unlit camera feed and can't
 * catch the light itself, so the beam is drawn volumetrically and the spot where it lands
 * gets an additive pool of light, stretched along the beam like a real oblique spot.
 * Its brightness eases toward the light level of the target it's aimed at.
 */
function CornerSpotlight({
  position,
  targets,
  levels,
  light: lightScale,
  density,
  depthBuffer,
}: {
  position: [number, number, number];
  /** The scene's depth, for softening where the beam meets the floor. */
  depthBuffer: THREE.DepthTexture;
  targets: [number, number, number][];
  /** Light level per target, in the same order as `targets`; 1 is normal brightness. */
  levels: number[];
  /** Scales the light and its floor pool; 1 is normal. */
  light: number;
  /** Scales how visible the beam's haze is; 1 is normal. */
  density: number;
}) {
  const aim = useMemo(() => new THREE.Object3D(), []);
  const light = useRef<THREE.SpotLight>(null);

  const poolMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const level = useRef(1);

  /** Index of the target nearest this corner, or -1 if there are none. */
  function nearestTargetIndex(): number {
    let nearest = -1;
    let nearestDistance = Infinity;
    targets.forEach((t, i) => {
      const d = Math.hypot(t[0] - position[0], t[1] - position[1]);
      if (d < nearestDistance) {
        nearestDistance = d;
        nearest = i;
      }
    });
    return nearest;
  }

  // The visible beam ends where it meets the floor, so it doesn't poke out underneath.
  // Rounded so dragging a target doesn't rebuild the beam's geometry on every frame.
  const nearestIndex = nearestTargetIndex();
  const target = nearestIndex === -1 ? [0, 0, 0] : targets[nearestIndex];
  const beamLength =
    Math.ceil(Math.hypot(target[0] - position[0], target[1] - position[1], position[2]) * 2) / 2;
  const housing = useRef<THREE.Group>(null);
  const [aimWorld] = useState(() => new THREE.Vector3());
  const pool = useRef<THREE.Mesh>(null);
  const poolTexture = useMemo(() => createPoolTexture(), []);
  useEffect(() => () => poolTexture.dispose(), [poolTexture]);

  useFrame((_, delta) => {
    // drei uses `distance` for both the beam length and the light's range; keep the light's
    // range unlimited so it still reaches whatever it's aimed at.
    if (light.current) light.current.distance = 0;

    const index = nearestTargetIndex();
    const nearest = index === -1 ? [0, 0, 0] : targets[index];
    aim.position.x = THREE.MathUtils.damp(aim.position.x, nearest[0], 6, delta);
    aim.position.y = THREE.MathUtils.damp(aim.position.y, nearest[1], 6, delta);
    aim.updateMatrixWorld();
    housing.current?.lookAt(aim.getWorldPosition(aimWorld));

    // The beam's footprint: its width across, lengthened along the beam by how shallow it hits.
    const dx = aim.position.x - position[0];
    const dy = aim.position.y - position[1];
    const ground = Math.hypot(dx, dy);
    const slant = Math.hypot(ground, position[2]);
    const across = slant * Math.tan(SPOTLIGHT_ANGLE);
    const along = across * (slant / position[2]);
    if (pool.current) {
      pool.current.position.set(aim.position.x, aim.position.y, 0.004);
      pool.current.rotation.z = Math.atan2(dy, dx);
      pool.current.scale.set(along, across, 1);
    }

    level.current = THREE.MathUtils.damp(
      level.current,
      levels[index] ?? 1,
      LIGHT_LEVEL_EASING,
      delta,
    );
    if (light.current) {
      light.current.intensity = SPOTLIGHT_INTENSITY * level.current * lightScale;
      // drei's volumetric beam is the light's child; its opacity is a shader uniform.
      const beam = light.current.children[0];
      if (beam instanceof THREE.Mesh && beam.material instanceof THREE.ShaderMaterial) {
        beam.material.uniforms.opacity.value = SPOTLIGHT_OPACITY * level.current * density;
      }
    }
    if (poolMaterial.current) {
      poolMaterial.current.opacity = SPOTLIGHT_OPACITY * level.current * lightScale;
    }
  });

  return (
    <>
      <primitive object={aim} />
      <SpotLight
        ref={light}
        position={position}
        target={aim}
        color={SPOTLIGHT_COLOR}
        decay={1}
        distance={beamLength}
        angle={SPOTLIGHT_ANGLE}
        penumbra={0.4}
        castShadow={false}
        // Fades the beam to nothing by its end, so the cone's cut-off rim doesn't show.
        attenuation={beamLength}
        depthBuffer={depthBuffer}
        anglePower={4}
        radiusTop={0.12}
        radiusBottom={Math.tan(SPOTLIGHT_ANGLE) * beamLength}
      />
      <mesh ref={pool} renderOrder={FLOOR_LAYER.lightPool}>
        <circleGeometry args={[1, 48]} />
        <meshBasicMaterial
          ref={poolMaterial}
          map={poolTexture}
          color={SPOTLIGHT_COLOR}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* The lamp itself: a short can whose open end faces the target. */}
      <group ref={housing} position={position}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.18, 0.26, 0.5, 24, 1, true]} />
          <meshStandardMaterial color="#2a3140" side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0, 0.2]}>
          <circleGeometry args={[0.24, 24]} />
          <meshBasicMaterial color={SPOTLIGHT_COLOR} />
        </mesh>
      </group>
    </>
  );
}

// How quickly the robot's animation speeds up or winds down when it starts or stops.
const ROBOT_SPEED_EASING = 4;
// The robot's hip bone, which carries the dance's movement across the floor.
const ROBOT_ROOT_BONE = 'Root_M_00';

/**
 * Pins the root bone's sideways movement to where it starts, so the robot dances on the
 * spot at the centre of its target instead of wandering off it; the up-and-down bounce is
 * kept. The bone's local y is up. Safe to run more than once on the same clip.
 */
function lockRootMotion(clip: THREE.AnimationClip) {
  const track = clip.tracks.find((t) => t.name === `${ROBOT_ROOT_BONE}.position`);
  if (!track) return;
  const v = track.values;
  for (let i = 3; i < v.length; i += 3) {
    v[i] = v[0];
    v[i + 2] = v[2];
  }
}

// Where the robot sits, measured once per loaded model (which is also when its dance
// gets pinned in place with lockRootMotion). The model is shared, so measuring
// again on a later mount would catch it mid-dance and shift it off centre.
const robotLayouts = new WeakMap<
  THREE.Object3D,
  { offset: [number, number, number]; size: THREE.Vector3 }
>();

/**
 * A target's robot model (from `url`) with its built-in animation. It's stood upright out of the floor and
 * scaled to `height`. The animation plays at normal speed while
 * `playing` (the target's countdown is running) and holds still otherwise. It fades out
 * with `opacity` (the fraction of the countdown left).
 */
function RobotTarget({
  url,
  position,
  height,
  playing,
  opacity,
}: {
  url: string;
  position: [number, number, number];
  height: number;
  playing: boolean;
  opacity: number;
}) {
  const { scene, animations } = useGLTF(url);
  const root = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(animations, root);

  // Measured once, at the model's own size: the offset that puts its hips over the origin
  // with its base on the floor, and its unscaled dimensions. The hips, not the bounding
  // box, are the middle, since the hologram parts around it aren't centred on it.
  const { offset, size } = useMemo(() => {
    const cached = robotLayouts.get(scene);
    if (cached) return cached;
    animations.forEach(lockRootMotion);
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const center =
      scene.getObjectByName(ROBOT_ROOT_BONE)?.getWorldPosition(new THREE.Vector3()) ??
      box.getCenter(new THREE.Vector3());
    const layout = {
      offset: [-center.x, -box.min.y, -center.z] as [number, number, number],
      size: box.getSize(new THREE.Vector3()),
    };
    robotLayouts.set(scene, layout);
    return layout;
  }, [scene, animations]);
  const scale = height / size.y;

  const action = actions[names[0]];

  // Every material in the model, with its own opacity and transparency, so fading scales
  // each one down from what it was (the hologram parts are already see-through).
  const materials = useMemo(() => {
    const found = new Map<THREE.Material, { opacity: number; transparent: boolean }>();
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const list: THREE.Material[] = Array.isArray(child.material)
        ? child.material
        : [child.material];
      for (const m of list) {
        if (!found.has(m)) found.set(m, { opacity: m.opacity, transparent: m.transparent });
      }
    });
    return found;
  }, [scene]);

  useEffect(() => {
    const fade = THREE.MathUtils.clamp(opacity, 0, 1);
    for (const [m, original] of materials) {
      const transparent = original.transparent || fade < 1;
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.needsUpdate = true;
      }
      m.opacity = original.opacity * fade;
    }
    // Fully faded: skip drawing it at all, so nothing lingers in the depth buffer.
    scene.visible = fade > 0;
  }, [opacity, materials, scene]);

  // The action always "plays"; its time scale is what starts and stops it.
  // It starts frozen on its first frame.
  useEffect(() => {
    if (!action) return;
    action.reset().setEffectiveTimeScale(0).play();
    return () => {
      action.stop();
    };
  }, [action]);

  useFrame((_, delta) => {
    if (!action) return;
    const speed = playing ? 1 : 0;
    const eased = THREE.MathUtils.damp(
      action.getEffectiveTimeScale(),
      speed,
      ROBOT_SPEED_EASING,
      delta,
    );
    action.setEffectiveTimeScale(Math.abs(eased - speed) < 0.001 ? speed : eased);
  });

  return (
    <group position={position}>
      <group ref={root} rotation={[Math.PI / 2, 0, 0]} scale={scale}>
        <group position={offset}>
          <primitive object={scene} />
        </group>
      </group>
    </group>
  );
}

interface FigureProps {
  position: [number, number, number];
  /** World position the figure turns to face, if any. */
  lookAt: [number, number, number] | null;
  height: number;
  /** Joined to a target: the figure turns from white to CONNECTED_COLOR, like the target's grab area. */
  connected: boolean;
}

const connectedColor = new THREE.Color(CONNECTED_COLOR);
const figureColor = new THREE.Color(FIGURE_COLOR);

function Figure({ position, lookAt, height, connected }: FigureProps) {
  const { scene } = useGLTF(MODEL_URL);
  const ref = useRef<THREE.Group>(null);

  // Each figure gets its own copy of the model and materials so it can be tinted independently.
  // The copy is normalized to unit height with its feet at the origin, then stood upright
  // along +z so it rises out of the tracking plane toward the camera.
  const { object, materials } = useMemo(() => {
    const model = scene.clone(true);
    const materials: THREE.MeshStandardMaterial[] = [];
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = (child.material as THREE.MeshStandardMaterial).clone();
        materials.push(child.material);
      }
    });

    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -box.min.y, -center.z);

    const object = new THREE.Group();
    object.add(model);
    object.scale.setScalar(1 / size.y);
    object.rotation.x = Math.PI / 2;
    return { object, materials };
  }, [scene]);

  // Ease toward the latest detection instead of snapping, so jittery tracking reads as motion.
  useFrame((_, delta) => {
    const group = ref.current;
    if (!group) return;
    group.position.x = THREE.MathUtils.damp(group.position.x, position[0], 12, delta);
    group.position.y = THREE.MathUtils.damp(group.position.y, position[1], 12, delta);
    group.position.z = position[2];
    group.scale.setScalar(THREE.MathUtils.damp(group.scale.x, height, 10, delta));

    if (lookAt) {
      // Standing the model up turns its forward (+z) into -y, so the yaw that points it
      // at (dx, dy) is that direction's angle plus a quarter turn.
      const dx = lookAt[0] - group.position.x;
      const dy = lookAt[1] - group.position.y;
      if (dx * dx + dy * dy > 1e-6) {
        const target = Math.atan2(dy, dx) + Math.PI / 2;
        // Turn the short way round rather than spinning through the long way.
        let diff = target - group.rotation.z;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        group.rotation.z += diff * (1 - Math.exp(-10 * delta));
      }
    }

    // The model's own colour is replaced, and a glow of the same colour lifts its shadows.
    const t = 1 - Math.exp(-10 * delta);
    const color = connected ? connectedColor : figureColor;
    for (const m of materials) {
      m.color.lerp(color, t);
      m.emissive.lerp(color, t);
      m.emissiveIntensity = 0.35;
    }
  });

  // Place the figure once on mount, starting tiny so it grows in. Position and scale are
  // animated in useFrame, so they must not be JSX props: react-three-fiber re-applies
  // props on re-render, which snapped the figure back to its starting size every few frames.
  useLayoutEffect(() => {
    ref.current?.position.set(...position);
    ref.current?.scale.setScalar(0.001);
    // Only on mount; later positions are eased toward in useFrame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <group ref={ref}>
      <primitive object={object} />
    </group>
  );
}

useGLTF.preload(MODEL_URL);
ROBOT_MODEL_URLS.forEach((url) => useGLTF.preload(url));
