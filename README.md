# Blob Tracking Prototype

A camera looks down at a floor. People (or objects standing in for them) show up as **blobs**,
and coloured patches on the floor are **targets**, the holograms. The app finds both in the
live image, works out who is standing close to which target, and turns it all into a 3D scene:
each person becomes a figure, each target a hologram (a dancing robot for the first two) with a
countdown that only runs while enough people gather around it.

This document explains how it works in plain language. The technical names are in brackets
for anyone who wants to look them up.

## Running it

```bash
npm install
npm run dev
```

Open the link it prints, allow camera access, and pick a camera in the camera view. With no
camera around, switch on **Test mode** in the control panel: you get a drawn scene of circles
you can drag around with the mouse, and everything else works the same.

---

## How the blob tracking works

A video is just a quick series of still pictures (frames). For every frame, around 60 times a
second, the app does the same six steps.

### 1. Make the picture smaller

The frame is shrunk to 320 pixels wide before anything else. Looking at every pixel of a full HD
image 60 times a second would be too slow, and at this size a person is still dozens of pixels
across, which is plenty to find them.

### 2. Decide, pixel by pixel, "is this part of a blob?"

Every pixel gets a yes or no. There are two ways to decide, chosen in the control panel:

- **Dark mode**: a pixel counts if it is darker than the threshold, like a dark coat on a light floor.
  Brightness is worked out the way our eyes weigh colours: green counts most, blue least.
- **Red mode**: a pixel counts if its red is stronger than both its green and its blue by more
  than the threshold. That skips white, grey, black and most skin tones, so only properly red
  things (a red hat, a red sheet of paper) are picked up.

Before deciding, the picture is **slightly blurred** (a box blur). Camera images are full of
tiny random speckles (noise). Without the blur, those speckles punch little holes in a blob,
and the next steps would see one person as several different pieces each frame.

The result is a black-and-white stencil of the image (a mask). While you drag a threshold
slider, this stencil is shown in green on top of the camera view, so you can see exactly what
the setting picks up. Camera makers call this focus peaking.

### 3. Group touching pixels into shapes

Pixels that said "yes" and touch each other belong to the same shape. The app starts at one
"yes" pixel and spreads out to every neighbour that is also "yes", like the paint-bucket tool in
Photoshop filling an area. Everything it reaches is one shape. Then it moves on to the next
unvisited "yes" pixel (flood fill, also called connected-component labelling).

### 4. Pull apart people who touch

Two people standing shoulder to shoulder would fill in as one big shape. To split them, the app
measures for every pixel of the shape **how far it is from the edge** (a distance transform; we
use a fast approximation called a chamfer distance). The middle of each round body is the point
furthest from any edge, so a shape made of two touching bodies has two "hills" in that
measurement, one per person.

Each clear hill becomes one blob. Small bumps along the edge are ignored: a hill has to be at
least half as high as the biggest one, and two hills that are too close together are treated
as the same person. Each pixel then goes to the hill whose circle it sits deepest inside.

### 5. Throw out things that are too small or too big

Each blob's size is its number of pixels. Anything under **Min area** (dust, a shoe) or over
**Max area** (a shadow, a rug) is dropped. The position of a blob is the average position of
all its pixels, its centre of mass.

### 6. Recognise the same person from one frame to the next

Steps 1–5 only find blobs in *this* frame. To know that the blob here is the same person as
the blob a little to the left a moment ago, each new blob is matched to the **closest blob from
the previous frame** (greedy nearest-neighbour matching). Closest pairs are matched first, and
nobody is matched to something too far away to have walked there in one frame. A matched
blob keeps its ID number, and that is what lets a figure in the 3D scene follow a person.

Two small rules keep this steady:

- **A new blob must be seen 3 frames in a row** before it counts, so a one-frame flicker
  never appears as a person.
- **A blob that disappears is kept for 10 frames** at its last spot, so if someone is missed for
  a moment they come back as the same person instead of a new one.

---

## How the targets are found

Targets are patches of one colour on the floor, blue by default. They go through the same steps,
with a few differences:

- **Matched by hue, not brightness.** Hue is the "which colour" part of a colour, the angle on
  the colour wheel. A pixel matches when its hue is within the **Tolerance** of the target
  colour. Because only hue counts, a blue patch still matches when it is in shadow or in bright
  light. Greys and very washed-out pixels have no real hue, so they never match.
- **Pick the colour from the image.** Instead of typing a colour, you click the target in the
  camera view. The app averages a small 5×5 pixel patch under the click, so one noisy
  pixel can't decide it.
- **No splitting.** A target is one patch, even if it's big or irregular.
- **Steadier tracking**, because targets don't move. A new target must be seen for about a
  quarter of a second, it survives being unseen for about 1.5 seconds (someone standing on it),
  and its position is heavily smoothed so it doesn't shake.

## Connections and the countdown

- **Grab area.** Every target has a circle around it. A person is **connected** when the edge of
  their blob reaches into that circle. The circle's size is set in the control panel and scaled
  to the camera view's size, so it covers the same part of the floor whatever the window size.
- **Required connections.** Each target needs a number of people (2 by default) before its
  countdown runs.
- **Countdown speed.** At exactly the required number it runs at normal speed. Every extra
  person **doubles** the speed: ×2, ×4, ×8…
- **Refilling.** When fewer people than required are connected, the countdown stops and slowly
  **fills back up** to full.
- **Reset.** The yellow button (or the R key) restarts every countdown.

---

## The 3D scene

The 3D view is built with three.js (through React Three Fiber). It uses the tracking results
and the camera image; it doesn't do any detection itself.

### Floor

- The **live camera image is laid on the floor**, darkened so the figures stand out. Camera
  pixels are converted to floor positions, so every figure stands exactly where its person is
  in the image. The floor follows the camera view's horizontal and vertical flips.
- You can orbit, pan and zoom the camera with the mouse.

### Figures (the people)

- Each person is a **low-poly character model**. Every figure gets its own copy, so each one can
  have its own colour.
- The model is measured once and **scaled to a fixed height**, feet on the floor.
- Figures **glide** to their new position instead of jumping, which hides the small jitter
  in the tracking (exponential easing). They **grow in** from nothing when they appear.
- Each figure **turns to face the nearest target**, taking the short way round.
- Figures are **white**, and turn **green** when connected. A faint green line joins every
  connected figure to its target.

### Holograms (the targets)

- The first two targets are **animated robots**, each with its own model (the second is a
  variant of the first, on the same rig). Their dance moves across the floor in the original
  files, so the app **pins their hips in place** (it keeps the up-and-down bounce), so it dances on
  the spot in the middle of its target.
- Each robot dances while its countdown runs and stands still otherwise, easing its dance speed
  up and down instead of snapping. It stays fully visible for the first half of the
  countdown, then **fades out** over the second half.
- Other targets are shown as simple see-through cubes. The cube also stands in while a robot's
  model is loading.

### Grab area on the floor

The circle around each target shows its state at a glance:

| State | Colour | Stroke | Text around the circle |
|---|---|---|---|
| Nobody connected | Blue | Dashed, dashes moving | MOVE CLOSER |
| Some, but not enough | Yellow | Solid | WATCHING ALONE IS BORING, RIGHT? · FIND COMPANY |
| Enough connected | Green | Solid, stronger | NICE, INVITE MORE PEOPLE |
| Countdown past halfway | Orange | as above | OH NO · YOU SHOULD GIVE MORE ATTENTION TO OTHER HOLOGRAMS |

- **The stroke is the timer.** It's a circle that empties clockwise from 12 o'clock as time runs
  out, and grows back as it refills. It gets stronger while the timer is moving, so the
  change is easy to see. This is drawn by a small custom shader: a program on the graphics card
  that decides, for every point of the ring, whether that point is still "in the time left" and
  whether it falls on a dash or a gap.
- **The text** is typeset letter by letter along the circle onto an image, which is then laid on
  the floor and slowly rotated. Split messages sit on opposite sides of the circle. If a message
  is too long for a small circle, the letters shrink to fit.

### Spotlights

- A spotlight hangs over each corner of the floor and **follows the target nearest to it**.
- The beams are drawn as **visible light in haze** (volumetric light). Where a beam meets the
  floor it fades out softly instead of ending in a hard line, and a pool of light is painted on
  the floor, stretched like a real spotlight hitting the ground at an angle.
- **Brightness follows attention.** A target with more than its share of all connected people
  gets brighter, and the others dim. Lights ease between levels rather than jumping.
- The **Light** and **Density** sliders set the overall brightness and how visible the haze is.

---

## Interface

- **Control panel** (left, **H** to hide or show): detection mode and threshold, blob size limits,
  target colour, tolerance and size, grab area size, required connections, timer length,
  spotlights, test mode, and camera flips.
- **Camera view** (bottom right, **C** to hide or show): the camera image with the detected
  blobs, targets, grab areas, connection lines and timers drawn over it. Tracking keeps running
  while it's hidden.
- Both panels **slide out to their edge**, fading and blurring as they go, and a small button
  appears to bring them back. With the system's reduced-motion setting on, they only fade.
- **Start/stop camera** (top centre, **S**): turns the camera on and off. It's off when the app opens. While it's off
  nothing is tracked, so the figures and holograms disappear. It's disabled in test mode.
- **R** resets the timers, **Esc** cancels picking a colour.
- **Every setting is saved** in the browser and restored the next time the app opens.
- **Test mode** replaces the camera with a drawn scene of draggable circles and targets, for
  trying things out without a camera or people.

## Performance tricks

- **Detection runs on a small image** (320 px wide), and the blur is done in two quick passes,
  one across and one down, instead of one slow one (a separable blur).
- **The distance measurement takes two sweeps over the image**, one forwards and one backwards,
  instead of measuring every pixel against every edge pixel (a two-pass chamfer transform).
- **The flood fill uses its own list of pixels to visit** instead of a function calling itself
  over and over, so large blobs can't crash it (an iterative flood fill with a preallocated stack).
- **Pixel data lives in compact number arrays** (typed arrays) created once per frame, which is much
  faster in the browser than ordinary lists.
- **Settings reach the detection loop without restarting it**, so moving a slider takes effect on
  the next frame without interrupting the camera.
- **The 3D scene only redraws what changes.** The ring text image is only redrawn when its
  message, colour or size changes, a spotlight beam's length is rounded to half a unit so
  its shape only rebuilds when a target has moved a noticeable distance, not every frame of a drag, and the timer stroke is a single shape the graphics card redraws
  itself.
- **See-through layers on the floor are drawn in a fixed order** (light pool, then grab-area fill,
  then stroke). They lie almost on top of each other, and without a fixed order they would
  flicker as the 3D engine keeps changing its mind about which is in front.

## Built with

React and TypeScript, Vite, three.js with React Three Fiber and drei (3D), Motion (panel
animations), Tailwind CSS and coss ui/Base UI (interface components).

## Where things are

| File | What it does |
|---|---|
| `src/lib/blobDetection.ts` | Steps 2–5: the pixel test, blur, flood fill, splitting touching blobs |
| `src/lib/blobTracker.ts` | Step 6: keeping the same ID for the same person across frames |
| `src/components/CameraView.tsx` | Camera, the per-frame loop, connections and countdowns |
| `src/lib/timer.ts` | Countdown speed, refilling and formatting |
| `src/components/BlobScene.tsx` | The 3D scene: floor, figures, holograms, grab areas, spotlights |
| `src/components/Controls.tsx` | The control panel |
| `src/lib/testScene.ts` | The drawn scene used in test mode |
