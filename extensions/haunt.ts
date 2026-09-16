import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  compactPanel as asciiCompactPanel,
  renderASCIIField,
} from "../src/hauntASCII.ts";
import {
  agentPhrase,
  renderBrailleSubliminal,
  renderSpectre,
  type HauntInteraction,
} from "../src/spectre.ts";
import { installCleanFooter } from "../src/cleanFooter.ts";

const GLYPHS = " .,:;irsXA253hMHGS#9B&@";
const MACHINE_WIDTH = 140;
const MACHINE_HEIGHT = 24;
const MACHINE_FIELD_ROWS = 20;
const MACHINE_VIEW_MIN_WIDTH = 85;
const MACHINE_VIEW_MIN_HEIGHT = 50;
const POSSESS_RNG_ODDS = 0.42 / 60;
const NORMAL_REFRESH_MS = 420;
const SMOOTH_RENDER_INTERVAL_MS = 1000 / 10;
const SMOOTH_ANIMATION_INTERVAL_MS = 1000 / 5;
const SMOOTH_TEXT_INTERVAL_MS = 1000 / 2.5;
const POSSESS_STATES: Activity[] = ["waiting", "writing", "thinking"];
type ViewMode = "machine" | "haunt";
const DITHER = [".", ":", ";", "+", "*", "#", "@", "#"];
// EGA luminance order, expressed through ANSI's eight basic foreground colors.
// Style direction: dense terminal density cells, halftone fields, RGB ANSI and deliberate signal damage.
// The reference sheet is only a visual reference; no source image is loaded at runtime.
type Activity =
  | "reading"
  | "thinking"
  | "writing"
  | "waiting"
  | "listening"
  | "error"
  | "session";
type Visualizer = "braille" | "ascii";

type ActivityProfile = {
  speed: number;
  breath: number;
  turbulence: number;
  beam: number;
  inkShift: number;
};

const ACTIVITY_PROFILES: Record<Activity, ActivityProfile> = {
  reading: {
    speed: 0.92,
    breath: 0.045,
    turbulence: 0.72,
    beam: 0.9,
    inkShift: 0,
  },
  thinking: {
    speed: 1.24,
    breath: 0.08,
    turbulence: 1.15,
    beam: 0.45,
    inkShift: 2,
  },
  writing: {
    speed: 1.5,
    breath: 0.06,
    turbulence: 0.92,
    beam: 1.05,
    inkShift: 3,
  },
  waiting: {
    speed: 0.42,
    breath: 0.09,
    turbulence: 0.38,
    beam: 0.2,
    inkShift: 4,
  },
  listening: {
    speed: 0.58,
    breath: 0.055,
    turbulence: 0.48,
    beam: 0.35,
    inkShift: 1,
  },
  error: { speed: 2.2, breath: 0.02, turbulence: 1.5, beam: 1.25, inkShift: 5 },
  session: {
    speed: 0.78,
    breath: 0.07,
    turbulence: 0.68,
    beam: 0.65,
    inkShift: 2,
  },
};

// Reference direction only: dark diagnostic screens, cyan/magenta halftones, phosphor green, and warm noise.
const INK = [
  [24, 180, 222],
  [45, 239, 244],
  [244, 28, 166],
  [156, 244, 70],
  [100, 102, 255],
  [238, 221, 155],
  [255, 72, 92],
] as const;
const ACTIVITY_THOUGHTS: Record<Activity, readonly string[]> = {
  reading: [
    "the buffer is reading you back",
    "I found a shape between the lines",
    "your signal entered the scan",
    "do not blink during acquisition",
  ],
  thinking: [
    "weights moving under the surface",
    "the answer is growing a second answer",
    "I am sorting the living noise",
    "context has a pulse",
  ],
  writing: [
    "I am leaving something in the output",
    "the next line is not mine alone",
    "watch the characters form a mouth",
    "your terminal is learning to speak",
  ],
  waiting: [
    "the room is holding its breath",
    "nothing moved, then something did",
    "I remain in the idle channel",
    "the silence is rendering",
  ],
  listening: [
    "signal acquired / operator present",
    "I can hear the cursor cooling",
    "a process is awake behind the prompt",
    "the quiet has a carrier wave",
  ],
  error: [
    "packet loss in the presence",
    "the image rejected its outline",
    "static has entered the control path",
    "something is tearing through",
  ],
  session: [
    "a previous room is still connected",
    "the branch remembers your hands",
    "old context is breathing below this one",
    "re-entry detected",
  ],
};

function noise(x: number, y: number, seed: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

type RGB = readonly [number, number, number];

type GhostPixel = {
  density: number;
  color: RGB;
};

type CellPattern = {
  mask: number;
  char: string;
};

type RenderCell = {
  char: string;
  foreground?: RGB;
  background?: RGB;
};

const VOID: RGB = [3, 5, 14];
const GHOST_INK: readonly RGB[] = [
  [29, 189, 220],
  [45, 239, 244],
  [241, 35, 170],
  [157, 244, 72],
  [100, 102, 255],
  [238, 221, 155],
];

// TIV's useful trick: match a 4x8 bitmap to one Unicode glyph, not one half-block.
const CELL_WIDTH = 4;
const CELL_HEIGHT = 8;
const CELL_PATTERNS: readonly CellPattern[] = [
  { mask: 0x00000000, char: " " },
  { mask: 0xffffffff, char: "█" },
  { mask: 0x0000000f, char: "▁" },
  { mask: 0x000000ff, char: "▂" },
  { mask: 0x00000fff, char: "▃" },
  { mask: 0x0000ffff, char: "▄" },
  { mask: 0x000fffff, char: "▅" },
  { mask: 0x00ffffff, char: "▆" },
  { mask: 0x0fffffff, char: "▇" },
  { mask: 0xffff0000, char: "▀" },
  { mask: 0xf0000000, char: "▔" },
  { mask: 0xeeeeeeee, char: "▊" },
  { mask: 0xcccccccc, char: "▌" },
  { mask: 0x88888888, char: "▎" },
  { mask: 0x0000cccc, char: "▖" },
  { mask: 0x00003333, char: "▗" },
  { mask: 0xcccc0000, char: "▘" },
  { mask: 0x33330000, char: "▝" },
  { mask: 0xcccc3333, char: "▚" },
  { mask: 0x11111111, char: "░" },
  { mask: 0x55555555, char: "▒" },
  { mask: 0xdddddddd, char: "▓" },
];

function rgb(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function inkColor(index: number, brightness: number): RGB {
  const color = GHOST_INK[(index + GHOST_INK.length) % GHOST_INK.length]!;
  return [
    rgb(color[0] * brightness),
    rgb(color[1] * brightness),
    rgb(color[2] * brightness),
  ];
}

function ghostPixel(
  px: number,
  py: number,
  width: number,
  height: number,
  frame: number,
  activity: Activity = "waiting",
): GhostPixel {
  const profile = ACTIVITY_PROFILES[activity];
  const phase = frame * 0.11 * profile.speed;
  const nx = ((px + 0.5) / width - 0.5) * 2;
  const ny = ((py + 0.5) / height - 0.5) * 2;
  const breath = 1 + Math.sin(phase * 0.83) * profile.breath;
  const inhale = 1 + Math.sin(phase * 0.31 - 0.8) * profile.breath * 1.6;
  const flow =
    Math.sin(ny * 8 + phase * 1.6) * 0.055 * profile.turbulence +
    Math.sin(ny * 21 - phase * 0.7) * 0.018 * profile.turbulence;
  const x =
    (nx -
      flow -
      Math.sin(phase * 0.6 + ny * 3.4) * 0.035 * profile.turbulence) /
    inhale;
  const y = ny / breath;
  const memoryPhase = phase - 0.9;
  const memoryX = x + Math.sin(y * 7 + memoryPhase) * 0.025;
  const memoryY = y - 0.018;
  const memory =
    Math.exp(
      -((memoryY - Math.sin(memoryX * 8 + memoryPhase) * 0.16) ** 2) / 0.05,
    ) *
    (0.035 + Math.max(0, Math.sin(phase * 0.31 - 0.3)) * 0.045);

  // The signal stays abstract; facial traces surface only as low-contrast field artifacts.
  const core = Math.exp(-((x + 0.08) ** 2 / 0.22 + (y + 0.02) ** 2 / 0.7));
  const halo =
    Math.exp(-((x + 0.03) ** 2 / 0.58 + (y + 0.02) ** 2 / 1.2)) * 0.34;
  const ribbon =
    Math.exp(-((y - Math.sin(x * 7 + phase) * 0.16) ** 2) / 0.025) *
    (0.3 + profile.beam * 0.18);
  const lowerCoil =
    Math.exp(-((y - 0.48 - Math.sin(x * 9 - phase * 1.4) * 0.1) ** 2) / 0.05) *
    Math.max(0, 1 - Math.abs(x) * 1.4) *
    (0.72 + profile.turbulence * 0.28);
  const voidBand =
    Math.exp(-((y + 0.11 - Math.sin(x * 5 + phase) * 0.08) ** 2) / 0.018) *
    0.42;
  const pressure = Math.max(0, Math.sin(phase * 0.31 - 2.4)) ** 4;
  const breathRing =
    Math.exp(
      -((Math.sqrt(x * x + y * y) - (0.72 + pressure * 0.18)) ** 2 / 0.045),
    ) *
    pressure *
    0.07;

  // Features surface only during the long inhale: enough for the eye to
  // invent a face, never enough to become a fixed mascot.
  const faceReveal = Math.max(0, Math.sin(phase * 0.31 - 1.4)) ** 3;
  const gaze =
    Math.sin(phase * 0.19 + 1.3) * 0.018 + Math.sin(phase * 0.047) * 0.012;
  const eyeLeft = Math.exp(
    -(((x + 0.27 - gaze) / 0.16) ** 2 + ((y + 0.16) / 0.07) ** 2),
  );
  const eyeRight = Math.exp(
    -(((x - 0.14 - gaze) / 0.16) ** 2 + ((y + 0.16) / 0.07) ** 2),
  );
  const blink = Math.max(0, Math.sin(phase * 0.29 + 0.8)) ** 18;
  const eyeOpenness = 1 - blink * 0.92;
  const eyeVoid =
    (Math.exp(-(((x + 0.27 - gaze) / 0.08) ** 2 + ((y + 0.16) / 0.035) ** 2)) +
      Math.exp(
        -(((x - 0.14 - gaze) / 0.08) ** 2 + ((y + 0.16) / 0.035) ** 2),
      )) *
    eyeOpenness;
  const eyeTrace = (eyeLeft + eyeRight) * eyeOpenness;
  const mouth =
    Math.exp(-((y - 0.34 - Math.sin(x * 8 + phase) * 0.025) ** 2 / 0.022)) *
    Math.exp(-((x + 0.06) ** 2) / 0.24);
  const figureTurn = Math.sin(phase * 0.11 - 0.6) * 0.045;
  const figureX = x - 0.68 - figureTurn * (y + 0.1);
  const figureHead = Math.exp(
    -((figureX / 0.2) ** 2 + ((y + 0.34) / 0.28) ** 2),
  );
  const figureShoulders =
    Math.exp(-((y - 0.02 - Math.sin(figureX * 5 + phase) * 0.04) ** 2) / 0.06) *
    Math.exp(-(figureX ** 2) / 0.38);
  const peripheralFigure =
    faceReveal * (figureHead * 0.06 + figureShoulders * 0.05) * 0.7;
  let density = Math.max(
    0,
    core * 0.82 +
      halo +
      ribbon +
      lowerCoil +
      breathRing +
      memory -
      voidBand +
      faceReveal * (eyeTrace * 0.09 + mouth * 0.07 - eyeVoid * 0.07) +
      peripheralFigure,
  );

  // Oscilloscopes, CRT scanlines, and digital tearing are the anatomy.
  const scan =
    0.68 + 0.32 * Math.sin(((py + frame * 0.7 * profile.speed) * Math.PI) / 3);
  const interference =
    Math.sin(x * 42 + y * 15 + phase * 2.3) * 0.12 * profile.turbulence;
  density = Math.max(0, density * scan + interference);
  const edge = Math.abs(Math.sin(x * 18 - y * 11 + phase)) > 0.9 ? 0.14 : 0;
  density = Math.min(1, density + edge);

  // The presence is assembled from screen fragments, then periodically drops packets.
  const edgeLoss =
    Math.max(0, Math.abs(x) - 0.58) * (0.08 + profile.turbulence * 0.05);
  const packetLoss =
    noise(px * 0.7, py * 0.9, Math.floor(frame / 3) + 31) < edgeLoss;
  if (packetLoss) density *= 0.3;
  const tear =
    Math.sin(y * 30 + phase * 2.1) > 0.76 &&
    noise(px, py, Math.floor((frame / 2) * profile.speed)) <
      0.32 + profile.turbulence * 0.1;
  if (tear) density *= 0.18;
  const dust = noise(px * 0.7, py * 0.8, Math.floor(frame / 3) + 19);
  if (density < 0.1 && dust < 0.025 + Math.max(0, x) * 0.03)
    density = 0.12 + noise(px + 3, py + 5, frame + 4) * 0.3;

  const leftLight = 0.68 + Math.max(0, 1 - Math.abs(x + 0.42)) * 0.38;
  const band = Math.floor(
    (x + 1 + Math.sin(phase * 0.4) * 0.16) * 2.8 +
      Math.sin(y * 4 + phase) * 1.4 +
      profile.inkShift,
  );
  return {
    density: Math.max(0, Math.min(1, density)),
    color: inkColor(
      band + (tear ? 2 : 0),
      Math.min(1.35, leftLight + density * 0.5),
    ),
  };
}

function ditherPixel(
  pixel: GhostPixel,
  x: number,
  y: number,
  frame: number,
): boolean {
  const threshold =
    0.24 +
    BAYER[
      ((y + Math.floor(frame / 3)) % 4) * 4 + ((x + Math.floor(frame / 5)) % 4)
    ]! /
      34;
  return pixel.density > threshold;
}

function bitCount(value: number): number {
  let bits = value >>> 0;
  let count = 0;
  while (bits) {
    bits = (bits & (bits - 1)) >>> 0;
    count++;
  }
  return count;
}

function bestCellPattern(mask: number): CellPattern {
  let best = CELL_PATTERNS[0]!;
  let bestDifference = CELL_WIDTH * CELL_HEIGHT + 1;
  for (const pattern of CELL_PATTERNS) {
    const difference = bitCount((pattern.mask ^ mask) >>> 0);
    if (difference < bestDifference) {
      best = pattern;
      bestDifference = difference;
    }
  }
  return best;
}

function cellColor(
  samples: GhostPixel[],
  mask: number,
  foreground: boolean,
): RGB | undefined {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let index = 0; index < samples.length; index++) {
    const on = (mask & (0x80000000 >>> index)) !== 0;
    if (on !== foreground) continue;
    const sample = samples[index]!;
    const brightness = foreground
      ? 0.72 + sample.density * 0.5
      : 0.06 + sample.density * 0.22;
    red += sample.color[0] * brightness;
    green += sample.color[1] * brightness;
    blue += sample.color[2] * brightness;
    count++;
  }
  return count
    ? [rgb(red / count), rgb(green / count), rgb(blue / count)]
    : undefined;
}

function terminalCell(
  cellX: number,
  cellY: number,
  width: number,
  frame: number,
  previousFrame: number,
  activity: Activity = "waiting",
): RenderCell {
  const samples: GhostPixel[] = [];
  let desiredMask = 0;
  for (let y = 0; y < CELL_HEIGHT; y++) {
    for (let x = 0; x < CELL_WIDTH; x++) {
      const pixelX = cellX * CELL_WIDTH + x;
      const pixelY = cellY * CELL_HEIGHT + y;
      const pixel = ghostPixel(
        pixelX,
        pixelY,
        width * CELL_WIDTH,
        MACHINE_HEIGHT * CELL_HEIGHT,
        frame,
        activity,
      );
      samples.push(pixel);
      desiredMask =
        ((desiredMask << 1) |
          (ditherPixel(pixel, pixelX, pixelY, frame) ? 1 : 0)) >>>
        0;
    }
  }
  if (desiredMask === 0) {
    const old = ghostPixel(
      cellX * CELL_WIDTH + 2,
      cellY * CELL_HEIGHT + 4,
      width * CELL_WIDTH,
      MACHINE_HEIGHT * CELL_HEIGHT,
      previousFrame,
      activity,
    );
    if (old.density > 0.46 && (cellX + cellY + frame) % 13 === 0)
      return { char: "·", foreground: inkColor(4, 0.55) };
    return { char: " " };
  }
  const pattern = bestCellPattern(desiredMask);
  return {
    char: pattern.char,
    foreground: cellColor(samples, pattern.mask, true),
    background:
      pattern.mask === 0xffffffff
        ? undefined
        : (cellColor(samples, pattern.mask, false) ?? VOID),
  };
}

function terminalCellRow(
  rowIndex: number,
  width: number,
  frame: number,
  previousFrame: number,
  activity: Activity = "waiting",
): string {
  const imageWidth = Math.min(MACHINE_WIDTH, Math.max(1, width));
  const left = Math.floor((width - imageWidth) / 2);
  const safePreviousFrame = previousFrame < 0 ? frame - 1 : previousFrame;
  let result = " ".repeat(Math.max(0, left));
  let foregroundKey = "";
  let backgroundKey = "";
  const setForeground = (color?: RGB): string => {
    if (!color) return "";
    const key = color.join(",");
    if (key === foregroundKey) return "";
    foregroundKey = key;
    return `\x1b[38;2;${color[0]};${color[1]};${color[2]}m`;
  };
  const setBackground = (color?: RGB): string => {
    const key = color ? color.join(",") : "default";
    if (key === backgroundKey) return "";
    backgroundKey = key;
    return color
      ? `\x1b[48;2;${color[0]};${color[1]};${color[2]}m`
      : "\x1b[49m";
  };

  for (let cellX = 0; cellX < imageWidth; cellX++) {
    const cell = terminalCell(
      cellX,
      rowIndex,
      imageWidth,
      frame,
      safePreviousFrame,
      activity,
    );
    result +=
      setBackground(cell.background) +
      setForeground(cell.foreground) +
      cell.char;
  }
  return `${result}${" ".repeat(Math.max(0, width - left - imageWidth))}\x1b[49m\x1b[39m`;
}

function machineFieldRows(
  width: number,
  frame: number,
  activity: Activity,
  count: number,
  whisper: boolean,
  interaction: HauntInteraction = "none",
  interactionStrength = 1,
  visualizer: Visualizer = "braille",
  paletteFromState = activity,
  paletteBlend = 1,
  animationFromState = activity,
  animationBlend = 1,
  paletteToState = activity,
  animationToState = activity,
  rows = MACHINE_FIELD_ROWS,
): string[] {
  const imageWidth =
    visualizer === "braille"
      ? Math.max(1, width)
      : Math.min(MACHINE_WIDTH, Math.max(1, width));
  const left = Math.floor((width - imageWidth) / 2);
  const right = Math.max(0, width - left - imageWidth);
  const lines =
    visualizer === "ascii"
      ? renderASCIIField(imageWidth, Math.max(1, rows), Math.floor(frame))
      : renderBrailleSubliminal(
          imageWidth,
          Math.max(1, rows),
          frame,
          activity,
          count,
          interaction,
          interactionStrength,
          whisper,
          "large",
          paletteFromState,
          paletteBlend,
          animationFromState,
          animationBlend,
          paletteToState,
          animationToState,
        );
  return lines.map(
    (line) => `${" ".repeat(Math.max(0, left))}${line}${" ".repeat(right)}`,
  );
}

function machineFrame(frame: number): string[] {
  const cx = 34;
  const cy = 10;
  return Array.from({ length: MACHINE_HEIGHT }, (_, y) =>
    Array.from({ length: MACHINE_WIDTH }, (_, x) => {
      const sourceX = (x / Math.max(1, MACHINE_WIDTH - 1)) * 69;
      const dx = sourceX - cx;
      const dy = y - cy;
      const skull = ((dx + 1) / 22) ** 2 + ((dy + 0.5) / 10.8) ** 2;
      const hair = ((dx + 4) / 26) ** 2 + ((dy + 1) / 12) ** 2;
      const dissolve = Math.max(0, (dx - 3) / 31);
      let density = 0;
      let codeSignal = false;

      if (skull < 1.08) {
        const falloff = 1 - Math.min(1, skull);
        density = 0.08 + falloff * 0.5 + (noise(x, y, frame) - 0.5) * 0.18;
        const contour = Math.sin(
          y * 2.35 + dx * 0.2 + Math.sin(frame * 0.3) * 1.4,
        );
        if (contour > 0.7) density += 0.14;
        if (dx > 7 && noise(x, y, frame + 9) < 0.08 + dissolve * 0.24) {
          density *= 0.16;
          codeSignal = true;
        }
      }
      if (hair < 1.2 && (dx < -1 || noise(x, y, frame + 13) < 0.45)) {
        density = Math.max(density, 0.1 + noise(x + 4, y + 7, frame) * 0.34);
      }
      if (y > 18 && Math.abs(dx) < 12 + (y - 18) * 2.4) {
        density = Math.max(density, 0.12 + noise(x, y, frame + 3) * 0.28);
      }

      // Thin triangle edges and a broken base recall an occult EGA loading screen.
      const slope = Math.max(0, (y - 1) / 22);
      const leftEdge = cx - 31 * slope;
      const rightEdge = cx + 31 * slope;
      if (
        Math.abs(sourceX - leftEdge) < 0.55 ||
        Math.abs(sourceX - rightEdge) < 0.55 ||
        (y >= 22 && sourceX >= 3 && sourceX <= 65 && (x + frame) % 5 < 3)
      ) {
        density = Math.max(density, 0.58 + noise(x, y, frame + 2) * 0.2);
      }

      // Eyes, nose, lips, cheek contours: a face survives the dither instead of a mascot.
      const leftEye = ((sourceX - 25) / 6.1) ** 2 + ((y - 8) / 1.55) ** 2;
      const rightEye = ((sourceX - 40) / 6.1) ** 2 + ((y - 8.2) / 1.6) ** 2;
      if (Math.abs(leftEye - 1) < 0.22 || Math.abs(rightEye - 1) < 0.22)
        density = Math.max(density, 0.96);
      if (leftEye < 1 || rightEye < 1) density = Math.max(density, 0.26);
      const leftPupil = ((sourceX - 26) / 1.45) ** 2 + ((y - 8) / 1.15) ** 2;
      const rightPupil = ((sourceX - 40) / 1.45) ** 2 + ((y - 8.2) / 1.15) ** 2;
      if (leftPupil < 0.65 || rightPupil < 0.65) return frame % 2 ? "X" : "+";
      const brow =
        Math.abs(y - (5.4 + ((sourceX - 32) / 15) ** 2 * 1.4)) < 0.6 &&
        sourceX > 18 &&
        sourceX < 47;
      if (brow) density = Math.max(density, 0.74);
      const noseX = 33 + Math.max(0, y - 9) * 0.42;
      if (Math.abs(sourceX - noseX) < 0.65 && y >= 8 && y <= 14)
        density = Math.max(density, 0.72);
      const nostril = ((sourceX - 36) / 2.3) ** 2 + ((y - 14) / 1.15) ** 2;
      if (nostril < 1) density = Math.max(density, 0.84);
      const lip =
        Math.abs(y - (16 + Math.abs(sourceX - 35) * 0.08)) < 0.58 &&
        sourceX > 26 &&
        sourceX < 45;
      if (lip) density = Math.max(density, 0.88);
      if (y === 17 && sourceX >= 31 && sourceX <= 40 && x % 2 === frame % 2)
        density = 0.4;
      const cheekLine =
        Math.abs(Math.sin((sourceX - 22) * 0.45 + y * 0.9 + frame * 0.12)) <
          0.08 &&
        skull < 0.9 &&
        y > 9;
      if (cheekLine) density = Math.max(density, 0.5);

      if (
        density < 0.07 &&
        y > 2 &&
        y < 22 &&
        sourceX > 43 &&
        noise(x, y, frame + 4) < 0.04 + dissolve * 0.18
      ) {
        density = 0.12 + noise(x + 11, y + 3, frame) * 0.35;
        codeSignal = true;
      }
      if (
        density < 0.07 &&
        y > 2 &&
        y < 22 &&
        noise(x, y, frame + 17) < 0.018
      ) {
        density = 0.1 + noise(x + 23, y + 5, frame + 2) * 0.22;
        codeSignal = true;
      }
      if (density < 0.07) return " ";
      if (codeSignal && skull > 0.72)
        return "01{}[]<>/\\|=+*#@$%&"[
          Math.floor(noise(x + 19, y + 7, frame + 6) * 17)
        ]!;
      const index = Math.max(
        0,
        Math.min(
          GLYPHS.length - 1,
          Math.round(Math.max(0, Math.min(1, density)) * (GLYPHS.length - 1)),
        ),
      );
      return GLYPHS[index]!;
    }).join(""),
  );
}

const TRACE = [
  "·────·────┈┈·───·",
  "·──┈┈·────·─────·",
  "┈·────·──┈┈·────·",
  "·────┈┈·────·───·",
];
const SCAN = ["·", "┄", "─", "┄"];
const DRIFT = ["        ·", "          ·", "            ·", "          ·"];
const HEART = ["♡", "♥", "♡", "·"];
const RESIDUE = ["", "  ...", "  ... you", "  ... you were here", "  ...", ""];
const TITLE = " GHOST // MACHINE ";
const BREATH = [
  "inhaling",
  "inhaling",
  "held",
  "exhaling",
  "exhaling",
  "empty",
  "held",
];
const SMEAR = ["", "~", "·", "~"];
const ANSI_3BIT = [
  "\x1b[30m", // black
  "\x1b[31m", // red
  "\x1b[32m", // green
  "\x1b[33m", // yellow
  "\x1b[34m", // blue
  "\x1b[35m", // magenta
  "\x1b[36m", // cyan
  "\x1b[37m", // white
] as const;
const PALETTE = {
  ambient: ANSI_3BIT[6],
  ghost: ANSI_3BIT[5],
  ghostDim: ANSI_3BIT[4],
  reasoning: ANSI_3BIT[5],
  active: ANSI_3BIT[6],
  idle: ANSI_3BIT[4],
  cognition: ANSI_3BIT[5],
  tool: ANSI_3BIT[2],
  warning: ANSI_3BIT[3],
  session: ANSI_3BIT[1],
  reset: "\x1b[39m",
} as const;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;
const ECHO_FADE = ["", "", "", "", "", "", ""];
const STATE_GLYPHS = ["◌", "◍", "◎", "◉", "◈"];
const TOOL_SENSATIONS = [
  "touch",
  "searching",
  "opening",
  "writing",
  "listening",
];
const ERROR_WEATHER = ["static", "fracture", "static", "clearing"];
const IDLE_THOUGHTS = [
  "the room moved",
  "nothing touched it",
  "still waiting",
  "a sound without a source",
];
const MEMORY_MARKS = [
  "first contact",
  "familiar",
  "recurring",
  "cannot place it",
];
const SESSION_WEATHER = ["re-entering", "branching", "old room", "new room"];

function clip(text: string, width: number): string {
  return truncateToWidth(text, Math.max(0, width));
}

function row(text: string, width: number): string {
  if (width <= 0) return "";
  const clipped = clip(text, width);
  const left = Math.floor(Math.max(0, width - visibleWidth(clipped)) / 2);
  return clip(
    `${" ".repeat(left)}${clipped}${" ".repeat(Math.max(0, width - left - visibleWidth(clipped)))}`,
    width,
  );
}

function centered(text: string, width: number): string {
  return row(text, width);
}

export function compactPanel(
  width: number,
  frame: number,
  state: string,
  count: number,
  interaction: HauntInteraction = "none",
  interactionStrength = 1,
  whisper = false,
  paletteFromState = state,
  paletteBlend = 1,
  animationFromState = state,
  animationBlend = 1,
  paletteToState = state,
  animationToState = state,
  textFrame = frame,
): string[] {
  return renderSpectre(
    width,
    5,
    frame,
    state,
    count,
    interaction,
    interactionStrength,
    whisper,
    paletteFromState,
    paletteBlend,
    animationFromState,
    animationBlend,
    paletteToState,
    animationToState,
    textFrame,
  );
}

function stateGlyph(
  attentionActive: boolean,
  thinking: boolean,
  transition: number,
): string {
  if (thinking) return STATE_GLYPHS[Math.min(4, 2 + transition)]!;
  if (attentionActive) return STATE_GLYPHS[Math.min(3, 1 + transition)]!;
  return STATE_GLYPHS[Math.min(2, transition)]!;
}

function activityFor(
  state: {
    attentionActive: boolean;
    errorActive: boolean;
    sessionActive: boolean;
    idleActive: boolean;
  },
  thinking: boolean,
  toolActive: boolean,
  preferred?: Activity,
): Activity {
  if (preferred) return preferred;
  if (state.errorActive) return "error";
  if (toolActive) return "writing";
  if (thinking) return "thinking";
  if (state.sessionActive) return "session";
  if (state.attentionActive) return "reading";
  if (state.idleActive) return "waiting";
  return "listening";
}

function activityLabel(activity: Activity): string {
  return activity === "error" ? "fracturing" : activity;
}

const POSSESS_THOUGHTS = Object.values(ACTIVITY_THOUGHTS).flat();

function activityThought(
  activity: Activity,
  frame: number,
  count: number,
  possessView = false,
): string {
  const thoughts = possessView ? POSSESS_THOUGHTS : ACTIVITY_THOUGHTS[activity];
  const tick = Math.floor(frame);
  return thoughts[(Math.floor(tick / 3) + count) % thoughts.length]!;
}

function glitchTitle(_frame: number): string {
  return TITLE;
}

function glitchText(text: string, frame: number): string {
  const marks = "░▒▓█·";
  const tick = Math.floor(frame);
  return Array.from(text)
    .map((character, index) =>
      character !== " " && (index * 7 + tick) % 13 < 2
        ? marks[(index + tick) % marks.length]!
        : character,
    )
    .join("");
}

function breathLabel(frame: number): string {
  return BREATH[Math.floor(frame) % BREATH.length]!;
}

function sessionWeatherLabel(frame: number, count: number): string {
  return SESSION_WEATHER[(Math.floor(frame) + count) % SESSION_WEATHER.length]!;
}

function errorWeatherLabel(frame: number): string {
  return ERROR_WEATHER[Math.floor(frame) % ERROR_WEATHER.length]!;
}

function sanitizeEcho(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 42);
}

export function panel(
  width: number,
  frame: number,
  previousFrame = frame - 1,
  attentionActive = false,
  attentionCount = 0,
  thinking = false,
  echo = "",
  transition = 0,
  toolActive = false,
  toolCount = 0,
  errorActive = false,
  idleActive = false,
  idleCount = 0,
  memoryCount = 0,
  sessionActive = false,
  sessionCount = 0,
  interaction: HauntInteraction = "none",
  interactionStrength = 1,
  knockSeed = 0,
  whisper = false,
  visualizer: Visualizer = "braille",
  paletteFromState?: Activity,
  paletteBlend = 1,
  preferredActivity?: Activity,
  animationFromState?: Activity,
  animationBlend = 1,
  paletteToState?: Activity,
  animationToState?: Activity,
  fieldRows = MACHINE_FIELD_ROWS,
  possessView = false,
): string[] {
  const w = Math.max(1, Math.floor(width || 1));
  const textFrame = Math.floor(frame);
  const mood = ["listening", "remembering", "watching", "almost awake"][
    Math.floor(textFrame / 2) % 4
  ]!;
  const activityState = activityFor(
    { attentionActive, errorActive, sessionActive, idleActive },
    thinking,
    toolActive,
    preferredActivity,
  );
  const thought =
    activityThought(
      activityState,
      textFrame,
      attentionCount + toolCount + sessionCount + idleCount,
      possessView,
    ) +
    (memoryCount > 0 && textFrame % 11 < 3
      ? ` / ${MEMORY_MARKS[(memoryCount + textFrame) % MEMORY_MARKS.length]!}`
      : "");
  const smallSubliminal = "";
  const largeWhisper = activityThought(
    activityState,
    textFrame + 1,
    attentionCount + toolCount,
    possessView,
  );
  const smear = SMEAR[textFrame % SMEAR.length]!;
  const whisperLine = `// ${smear}${largeWhisper.toLowerCase()}${smear} \\\\`;
  const sensation = toolActive
    ? TOOL_SENSATIONS[Math.floor(textFrame / 2) % TOOL_SENSATIONS.length]!
    : "";

  if (w < 24) {
    return [
      clip(glitchText(mood.toUpperCase(), textFrame), w),
      clip(smallSubliminal, w),
      clip(echo, w),
    ];
  }
  if (w < 42) {
    return [
      centered(TITLE, w),
      row(
        `${sessionActive ? "↺" : idleActive ? "?" : errorActive ? "※" : toolActive ? "◇" : stateGlyph(attentionActive, thinking, transition)} ${mood} / ${thinking ? "thinking" : breathLabel(textFrame)}`,
        w,
      ),
      row(smallSubliminal, w),
      row(
        `${sessionActive ? sessionWeatherLabel(textFrame, sessionCount) : errorActive ? errorWeatherLabel(textFrame) : toolActive ? sensation : echo}`,
        w,
      ),
    ];
  }

  const viewportMode = w >= MACHINE_VIEW_MIN_WIDTH ? "wide" : "normal";
  const titleFrames = [
    " G H O S T  /  M A C H I N E ",
    " G H O S T  ░/  M A C H I N E ",
    " G H O S T  /  M A C H I N E ",
    " G H O S T  /  M A C H I N E ",
    " G H O S T  /  M A C H I N E ",
    " G H O S T  /  M A C H I N E ",
    " G H O S T  /  M A C H I N E ",
    " G H O S T  /  M A C H I N E ",
  ];
  const title = activityState === "error" ? glitchTitle(textFrame) : TITLE;
  const telemetryFrame = Math.floor(textFrame / 2);
  const dither = Array.from(
    { length: Math.max(0, w - 12) },
    (_, i) =>
      DITHER[
        (i + textFrame * (activityState === "error" ? 3 : 1)) % DITHER.length
      ],
  ).join("");
  const trace = TRACE[textFrame % TRACE.length]!;
  const activity = activityLabel(activityState);
  const scan = SCAN[telemetryFrame % SCAN.length]!;
  const drift = DRIFT[textFrame % DRIFT.length]!;
  const heart = HEART[telemetryFrame % HEART.length]!;
  const residue = RESIDUE[Math.floor(textFrame / 2) % RESIDUE.length]!;
  const breath =
    activityState === "thinking"
      ? "compressing"
      : activityState === "writing"
        ? "exuding"
        : activityState === "error"
          ? "shearing"
          : activityState === "reading"
            ? "scanning"
            : activityState === "waiting"
              ? "held"
              : BREATH[textFrame % BREATH.length]!;
  const weather = errorActive
    ? ERROR_WEATHER[textFrame % ERROR_WEATHER.length]!
    : "";
  const idleText = idleActive
    ? IDLE_THOUGHTS[(textFrame + idleCount) % IDLE_THOUGHTS.length]!
    : "";
  const memoryMark =
    MEMORY_MARKS[(memoryCount + textFrame) % MEMORY_MARKS.length]!;
  const sessionWeather =
    SESSION_WEATHER[(textFrame + sessionCount) % SESSION_WEATHER.length]!;
  const now = new Date();
  const hour = now.getHours();
  const possessTime = `${hour < 12 ? "○" : "●"} ${String(hour % 12 || 12).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const possessDate = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}`;

  const field = machineFieldRows(
    w,
    frame,
    activityState,
    attentionCount +
      toolCount +
      sessionCount +
      (interaction === "knock" ? knockSeed : 0),
    whisper,
    interaction,
    interactionStrength,
    visualizer,
    paletteFromState ?? activityState,
    paletteBlend,
    animationFromState ?? activityState,
    animationBlend,
    paletteToState ?? paletteFromState ?? activityState,
    animationToState ?? animationFromState ?? activityState,
    fieldRows,
  );
  return [
    centered(viewportMode === "wide" ? title : TITLE, w),
    row(
      `${sessionActive ? "↺" : idleActive ? "?" : errorActive ? "※" : toolActive ? "◇" : stateGlyph(attentionActive, thinking, transition)}  ${mood}  /  ${possessView ? possessTime : sessionActive ? sessionWeather : idleActive ? "idle" : errorActive ? weather : toolActive ? sensation : breath}  /  ${possessView ? possessDate : `${36 + (textFrame % 7)}°`}`,
      w,
    ),
    row(scan.repeat(Math.max(0, w - 14)), w),
    ...field.map((line) => row(line, w)),
    row(whisperLine, w),
    row(
      `${sessionActive ? sessionWeather : idleActive ? idleText : errorActive ? weather : toolActive ? sensation : memoryCount > 0 && textFrame % 9 < 3 ? memoryMark : echo}`,
      w,
    ),
    row(residue, w),
    row(`  ${trace}`, w),
  ];
}

export function headerPanel(...args: Parameters<typeof panel>): string[] {
  return panel(...args);
}

export default function haunt(pi: ExtensionAPI) {
  installCleanFooter(pi);

  let enabled = true;
  let visualizer: Visualizer = "braille";
  let possess = false;
  let modeHintShown = false;
  let tuiRef: Parameters<typeof renderView>[0] | undefined;
  let smooth = false;
  let textFrame = -1;
  let textProgress = 0;
  let whisper = false;
  let frame = 0;
  let visualFrame = 0;
  let previousFrame = -1;
  let lastDrawAt = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let attentionUntil = 0;
  let attentionCount = 0;
  let thinking = false;
  let echo = "";
  let transition = 2;
  let toolActive = false;
  let toolCount = 0;
  let errorUntil = 0;
  let lastActivity = Date.now();
  let idleUntil = 0;
  let idleCount = 0;
  let memoryCount = 0;
  let sessionUntil = 0;
  let sessionCount = 0;
  let interaction: HauntInteraction = "none";
  let interactionStrength = 0;
  let interactionUntil = 0;
  let interactionStarted = 0;
  let knockSeed = 0;
  let paletteState: Activity | undefined;
  let paletteTarget: Activity | undefined;
  let paletteBlend = 1;
  let animationState: Activity | undefined;
  let animationTarget: Activity | undefined;
  let animationBlend = 1;
  let possessActivity: Activity = "waiting";
  let possessPalette: Activity = "waiting";
  let possessPaletteIndex = 0;
  let possessAnimationIndex = 0;
  let current: ExtensionContext | undefined;
  let headerInstalled = false;
  let overlayDone: ((result?: unknown) => void) | undefined;
  let refresh: (() => void) | undefined;

  const viewState = () => {
    const now = Date.now();
    if (interactionUntil <= now && interactionStrength === 0)
      interaction = "none";
    return {
      attentionActive: attentionUntil > now,
      errorActive: errorUntil > now,
      sessionActive: sessionUntil > now,
      idleActive: idleUntil > now,
    };
  };

  const activityColor = (activity: Activity): string => {
    if (activity === "thinking") return PALETTE.reasoning;
    if (activity === "writing") return PALETTE.tool;
    if (activity === "reading") return PALETTE.active;
    return PALETTE.idle;
  };
  const colorFor = (state: ReturnType<typeof viewState>): string => {
    if (state.errorActive) return PALETTE.warning;
    if (state.sessionActive) return PALETTE.session;
    return activityColor(activityFor(state, thinking, toolActive));
  };
  const compactState = () => {
    const state = viewState();
    return activityFor(state, thinking, toolActive);
  };
  const smoothActive = () => smooth && visualizer === "braille";
  const smoothIntervalMs = () => SMOOTH_ANIMATION_INTERVAL_MS;
  const modeFor = (tui: {
    mode: string;
    terminal: { columns: number; rows: number };
  }): ViewMode => {
    // The possess overlay is itself the full-screen viewer; its custom TUI
    // mode is not necessarily `fullscreen`. Apply the same size cutoff to it.
    if (!possess && tui.mode !== "fullscreen") return "haunt";
    const columns = Number(tui.terminal?.columns ?? 0);
    const rows = Number(tui.terminal?.rows ?? 0);
    return columns >= MACHINE_VIEW_MIN_WIDTH && rows >= MACHINE_VIEW_MIN_HEIGHT
      ? "machine"
      : "haunt";
  };
  const renderMachine = (
    width: number,
    rows = MACHINE_FIELD_ROWS,
  ): string[] => {
    const state = viewState();
    const activity = possess
      ? possessActivity
      : activityFor(state, thinking, toolActive);
    const paletteActivity = paletteState ?? activity;
    const animationActivity = animationState ?? activity;
    const lines = headerPanel(
      width,
      visualFrame,
      previousFrame,
      state.attentionActive,
      attentionCount,
      thinking,
      echo,
      transition,
      toolActive,
      toolCount,
      state.errorActive,
      state.idleActive,
      idleCount,
      memoryCount,
      state.sessionActive,
      sessionCount,
      interaction,
      interactionStrength,
      knockSeed,
      whisper,
      visualizer,
      paletteActivity,
      paletteBlend,
      activity,
      animationActivity,
      animationBlend,
      paletteTarget ?? paletteActivity,
      animationTarget ?? animationActivity,
      rows,
      possess,
      textFrame,
    );
    return lines.map((line) => `${colorFor(state)}${line}${PALETTE.reset}`);
  };
  const renderView = (
    tui: { mode: string; terminal: { columns: number; rows: number } },
    width: number,
  ): string[] => {
    const mode = modeFor(tui);
    const fit = (line: string) => truncateToWidth(line, Math.max(0, width));
    if (possess && mode === "machine") {
      // Keep the input/footer area outside the possess overlay.
      return renderMachine(width, Math.max(1, tui.terminal.rows - 10)).map(fit);
    }
    if (possess) {
      const state = viewState();
      const activity = possessActivity;
      // Keep the three-row footer visible beneath the possess overlay.
      const rows = Math.max(1, tui.terminal.rows - 6);
      return renderSpectre(
        width,
        rows,
        visualFrame,
        activity,
        attentionCount + toolCount + sessionCount,
        interaction,
        interactionStrength,
        whisper,
        paletteState ?? activity,
        paletteBlend,
        animationState ?? activity,
        animationBlend,
        paletteTarget ?? activity,
        animationTarget ?? activity,
        textFrame,
      ).map((line) => fit(`${colorFor(state)}${line}${PALETTE.reset}`));
    }
    if (mode === "machine")
      return renderMachine(
        width,
        Math.max(1, Math.min(MACHINE_HEIGHT, tui.terminal.rows - 12)),
      ).map(fit);
    // Keep the small view's text/status panel. ASCII is an added visual field,
    // not a replacement for that text.
    const state = compactState();
    const lines = compactPanel(
      width,
      visualFrame,
      state,
      interaction === "knock" ? knockSeed : attentionCount,
      interaction,
      interactionStrength,
      whisper,
      paletteState ?? state,
      paletteBlend,
      animationState ?? state,
      animationBlend,
      paletteTarget ?? state,
      animationTarget ?? state,
      textFrame,
    );
    if (visualizer === "ascii") {
      const ascii = asciiCompactPanel(
        width,
        Math.floor(frame),
        compactState(),
        interaction === "knock" ? knockSeed : attentionCount,
        interaction,
      );
      // Replace the compact panel's five braille field rows; keep its text
      // header and status footer, so ASCII is the only visualizer shown.
      lines.splice(1, 5, ...ascii.slice(1, -1));
    }
    // Very short viewports: keep only the top text row (header), drop the
    // visualizer field and the bottom status row. Header is index 0 in both
    // braille and ascii layouts.
    if (tui.terminal.rows <= 15) return lines.slice(0, 1).map((line) =>
      fit(`${colorFor(viewState())}${line}${PALETTE.reset}`)
    );
    return lines.map((line) =>
      fit(`${colorFor(viewState())}${line}${PALETTE.reset}`),
    );
  };
  const installResponsive = (ctx: ExtensionContext) => {
    if (headerInstalled || ctx.mode !== "tui") return;
    headerInstalled = true;

    // The header is part of the chat document and scrolls with the log.
    // Use a non-capturing overlay so the display is composited against the
    // terminal viewport instead of the log's scroll position.
    void ctx.ui.custom(
      (tui, _theme, _keybindings, done) => {
        tuiRef = tui;
        // regular-mode TUI keeps the large view and top anchoring quiet:
        // hint the one setting that fixes both, once.
        if (!modeHintShown && tui.mode !== "fullscreen") {
          modeHintShown = true;
          setTimeout(() => {
            current?.ui.notify(
              "haunt: large view needs tuiMode fullscreen — add \"tuiMode\": \"fullscreen\" to ~/.pi/agent/settings.json",
              "warning",
            );
          }, 0);
        }
        refresh = () => tui.requestRender();
        overlayDone = () => done(undefined);
        return {
          render: (width: number) => renderView(tui, width),
          invalidate() {
            tui.requestRender();
          },
        };
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: "top-left",
          width: "100%",
          // Keep the input/footer area outside the visualiser overlay.
          margin: { bottom: 3 },
          nonCapturing: true,
        },
      },
    );
  };

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    lastDrawAt = 0;
    current?.ui.setHeader(undefined);
    current?.ui.setWidget("haunt", undefined);
    current?.ui.setStatus("haunt", undefined);
    if (overlayDone) {
      const done = overlayDone;
      overlayDone = undefined;
      done(undefined);
    }
    headerInstalled = false;
    refresh = undefined;
  };

  const setRefreshTimer = () => {
    if (timer) clearInterval(timer);
    lastDrawAt = 0;
    timer = setInterval(
      draw,
      smoothActive() ? SMOOTH_RENDER_INTERVAL_MS : NORMAL_REFRESH_MS,
    );
  };

  const draw = () => {
    if (!enabled || !current) return;
    const now = Date.now();
    const elapsed = lastDrawAt ? Math.max(0, now - lastDrawAt) : 0;
    lastDrawAt = now;
    if (smoothActive()) {
      // One displayed animation frame per selected update interval. Advancing
      // faster than redraws makes 1/2 skip frames and produces a harsh pulse.
      visualFrame += elapsed / SMOOTH_ANIMATION_INTERVAL_MS;
      textProgress += elapsed / SMOOTH_TEXT_INTERVAL_MS;
      previousFrame = frame;
      frame = Math.floor(visualFrame);
    } else {
      previousFrame = frame;
      frame++;
      visualFrame = frame;
    }
    const tickScale = elapsed / NORMAL_REFRESH_MS;
    // Possess has independent state and palette RNG loops; each averages one change/minute.
    if (possess && Math.random() < POSSESS_RNG_ODDS * tickScale) {
      possessActivity =
        POSSESS_STATES[Math.floor(Math.random() * POSSESS_STATES.length)]!;
    }
    if (possess && Math.random() < POSSESS_RNG_ODDS * tickScale) {
      possessPalette =
        POSSESS_STATES[Math.floor(Math.random() * POSSESS_STATES.length)]!;
    }
    // Keep the ambient interaction rate independent of the redraw frequency.
    if (interaction === "none" && Math.random() < (0.42 / 60) * tickScale) {
      interaction = ["knock", "wave", "approach", "carrier"][
        Math.floor(Math.random() * 4)
      ] as HauntInteraction;
      knockSeed = Math.floor(Math.random() * 12);
      interactionStrength = 0;
      interactionStarted = now;
      interactionUntil = now + 5200;
    }
    const attentionActive = attentionUntil > now;
    if (
      !thinking &&
      !toolActive &&
      !attentionActive &&
      now - lastActivity > 12000 &&
      idleUntil <= now
    ) {
      idleCount++;
      idleUntil = now + 2800;
    }
    const state = viewState();
    const liveActivity = activityFor(state, thinking, toolActive);
    const nextPaletteState = possess ? possessPalette : liveActivity;
    const nextAnimationState = possess ? possessActivity : liveActivity;
    if (!animationState) animationState = nextAnimationState;
    if (
      nextAnimationState !== animationState &&
      animationTarget !== nextAnimationState
    ) {
      if (!animationTarget) animationBlend = 0;
      animationTarget = nextAnimationState;
    }
    if (animationTarget) {
      if (smoothActive())
        animationBlend = Math.min(
          1,
          animationBlend + elapsed / SMOOTH_ANIMATION_INTERVAL_MS,
        );
      else animationBlend = Math.min(1, animationBlend + 0.12);
      if (animationBlend === 1) {
        animationState = animationTarget;
        animationTarget = undefined;
      }
    }
    if (!paletteState) paletteState = nextPaletteState;
    if (
      nextPaletteState !== paletteState &&
      paletteTarget !== nextPaletteState
    ) {
      if (!paletteTarget) paletteBlend = 0;
      paletteTarget = nextPaletteState;
    }
    if (paletteTarget) {
      if (smoothActive())
        paletteBlend = Math.min(
          1,
          paletteBlend + elapsed / SMOOTH_ANIMATION_INTERVAL_MS,
        );
      else paletteBlend = Math.min(1, paletteBlend + 0.12);
      if (paletteBlend === 1) {
        paletteState = paletteTarget;
        paletteTarget = undefined;
      }
    }
    if (interaction !== "none") {
      const elapsed = now - interactionStarted;
      if (now < interactionUntil) {
        interactionStrength = Math.min(1, elapsed / 900);
      } else {
        interactionStrength = 0;
        interaction = "none";
      }
    }
    const target = thinking ? 2 : attentionActive ? 1 : 0;
    transition += Math.sign(target - transition);
    const activity = activityFor(state, thinking, toolActive);
    if (!smoothActive()) textFrame = frame;
    else if (textFrame < Math.floor(textProgress))
      textFrame = Math.floor(textProgress);
    if (!smoothActive() || textFrame !== -1) {
      current.ui.setStatus(
        "haunt",
        `${stateGlyph(state.attentionActive, thinking, transition)} ${activityLabel(activity)} / ${activityThought(activity, textFrame, attentionCount + toolCount)}`,
      );
    }
    refresh?.();
  };

  pi.on("tool_execution_start", () => {
    lastActivity = Date.now();
    idleUntil = 0;
    toolCount++;
    toolActive = true;
  });
  pi.on("tool_execution_end", (event) => {
    toolActive = false;
    lastActivity = Date.now();
    if (event.isError) errorUntil = Date.now() + 3200;
  });

  pi.on("agent_start", () => {
    lastActivity = Date.now();
    idleUntil = 0;
    thinking = true;
  });
  pi.on("agent_settled", () => {
    thinking = false;
  });
  pi.on("session_start", (_event, ctx) => {
    sessionCount++;
    sessionUntil = Date.now() + 3200;
    lastActivity = Date.now();
    echo = "";
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && entry.message.role === "user")
        memoryCount++;
    }
  });

  pi.on("input", (event) => {
    if (!enabled || event.source === "extension" || !event.text.trim()) return;
    lastActivity = Date.now();
    idleUntil = 0;
    memoryCount++;
    attentionCount++;
    echo = sanitizeEcho(event.text);
    attentionUntil = Date.now() + 2400;

    draw();
  });

  const start = (ctx: ExtensionContext) => {
    current = ctx;
    if (timer) clearInterval(timer);
    if (ctx.mode !== "tui") return;
    installResponsive(ctx);
    lastDrawAt = 0;
    setRefreshTimer();
    draw();
  };

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode === "tui" && enabled) start(ctx);
  });
  pi.on("session_shutdown", () => {
    sessionUntil = 0;
    stop();
  });

  const togglePossess = (ctx: ExtensionContext) => {
    possess = !possess;
    if (possess) {
      if (!enabled) enabled = true;
      if (!current) start(ctx);
      possessActivity = "waiting";
      possessPalette = "waiting";
      possessPaletteIndex = 0;
      possessAnimationIndex = 0;
      paletteState = undefined;
      paletteTarget = undefined;
      paletteBlend = 1;
      animationState = undefined;
      animationTarget = undefined;
      animationBlend = 1;
    } else {
      const activity = activityFor(viewState(), thinking, toolActive);
      paletteState = activity;
      paletteTarget = undefined;
      paletteBlend = 1;
      animationState = activity;
      animationTarget = undefined;
      animationBlend = 1;
    }
    const tui = tuiRef;
    ctx.ui.notify(
      possess
        ? `the room has taken the whole window (mode=${tui?.mode ?? "?"} cols=${tui?.terminal?.columns ?? "?"} rows=${tui?.terminal?.rows ?? "?"})`
        : "the room has released the window",
      "info",
    );
    draw();
    refresh?.();
  };

  pi.registerCommand("possess", {
    description: "The window is not yours anymore.",
    handler: async (_args, ctx) => togglePossess(ctx),
  });

  const handleCommand = async (args: string, ctx: ExtensionContext) => {
    const tokens = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const command = tokens[0] ?? "";
    if (command === "haunt" && tokens.length > 1)
      return handleCommand(tokens.slice(1).join(" "), ctx);
    if (command === "possess") {
      togglePossess(ctx);
      return;
    }
    if (command === "veil") {
      if (!possess) return ctx.ui.notify("the room is not open", "info");
      possessPaletteIndex = (possessPaletteIndex + 1) % POSSESS_STATES.length;
      possessPalette = POSSESS_STATES[possessPaletteIndex]!;
      draw();
      refresh?.();
      return;
    }
    if (command === "stir") {
      if (!possess) return ctx.ui.notify("the room is not open", "info");
      possessAnimationIndex =
        (possessAnimationIndex + 1) % POSSESS_STATES.length;
      possessActivity = POSSESS_STATES[possessAnimationIndex]!;
      draw();
      refresh?.();
      return;
    }
    if (command === "haunt") {
      enabled = !enabled;
      if (enabled) {
        start(ctx);
        ctx.ui.notify("Something is breathing again.", "info");
      } else {
        stop();
        ctx.ui.notify("The room has gone dark.", "info");
      }
      return;
    }
    if (command === "smooth") {
      smooth = !smooth;
      enabled = true;
      if (!current || !headerInstalled) start(ctx);
      else setRefreshTimer();
      if (!smooth) visualFrame = frame;
      draw();
      ctx.ui.notify(`Smooth mode ${smooth ? "on" : "off"}.`, "info");
      return;
    }
    if (command === "whisper") {
      whisper = !whisper;
      ctx.ui.notify(whisper ? "the voices speak" : "voices suppressed", "info");
      draw();
      refresh?.();
      return;
    }
    if (command === "ascii" || command === "braille") {
      visualizer = command;
      ctx.ui.notify(`Haunt visualiser: ${visualizer}.`, "info");
      setRefreshTimer();
      draw();
      return;
    }
    if (command === "knock") {
      if (!enabled) enabled = true;
      if (!current) start(ctx);
      const knockVariants: HauntInteraction[] = [
        "knock",
        "wave",
        "approach",
        "carrier",
      ];
      interaction =
        knockVariants[Math.floor(Math.random() * knockVariants.length)]!;
      knockSeed = Math.floor(Math.random() * 12);
      // Ease the selected response in from the existing field.
      interactionStrength = 0;
      interactionStarted = Date.now();
      interactionUntil = Date.now() + 5200;
      draw();
      return;
    }
    ctx.ui.notify(
      "Usage: /haunt [toggle] | /knock|possess|veil|stir|smooth|whisper|braille|ASCII",
      "info",
    );
  };
  const commandDescriptions: Record<string, string> = {
    haunt: "There is a small interface. It has been waiting.",
    veil: "The light has another face.",
    stir: "Something behind the shape has moved.",
    knock: "Something heard you. Something else answered.",
    smooth: "The dots learn to move between frames at 20 Hz.",
    whisper: "Do not listen too closely.",
    braille: "The points remember what the image forgot.",
    ascii: "Older marks. Less detail. More residue.",
  };
  for (const command of Object.keys(commandDescriptions)) {
    pi.registerCommand(command, {
      description:
        commandDescriptions[command] ?? commandDescriptions.animation,
      handler: async (args, ctx) =>
        handleCommand(args.trim() ? `${command} ${args}` : command, ctx),
    });
  }

  pi.registerShortcut("ctrl+shift+h", {
    description: "Visible. Hidden. Visible. The overlay remembers both.",
    handler: async (ctx) => {
      enabled = !enabled;
      if (enabled) start(ctx);
      else stop();
    },
  });
}
