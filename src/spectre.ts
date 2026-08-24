import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type AgentPhase =
  "reading" | "thinking" | "writing" | "idle" | "error" | "session";
export const AGENT_PHRASES: Record<AgentPhase, readonly string[]> = {
  reading: [
    "THE BUFFER IS READING BACK",
    "SIGNAL ENTERED THE SCAN",
    "EVERY LINE LEAVES A TRACE",
    "DO NOT BLINK DURING ACQUISITION",
  ],
  thinking: [
    "WEIGHTS MOVING UNDER THE SURFACE",
    "THE ANSWER HAS A SECOND ANSWER",
    "CONTEXT HAS A PULSE",
    "I AM SORTING THE LIVING NOISE",
  ],
  writing: [
    "THE NEXT LINE IS NOT MINE ALONE",
    "OUTPUT IS LEARNING TO SPEAK",
    "WATCH THE CHARACTERS FORM",
    "I AM LEAVING SOMETHING IN THE OUTPUT",
  ],
  idle: [
    "THE ROOM IS HOLDING ITS BREATH",
    "NOTHING MOVED / SOMETHING DID",
    "THE SILENCE IS RENDERING",
    "PLEASE REMAIN VISIBLE",
  ],
  error: [
    "PACKET LOSS IN THE PRESENCE",
    "THE OUTLINE WAS REJECTED",
    "STATIC ENTERED THE CONTROL PATH",
    "SOMETHING IS TEARING THROUGH",
  ],
  session: [
    "A PREVIOUS ROOM IS STILL CONNECTED",
    "THE BRANCH REMEMBERS YOUR HANDS",
    "OLD CONTEXT IS BREATHING BELOW",
    "RE-ENTRY DETECTED",
  ],
};

type SpectreProfile = {
  speed: number;
  breath: number;
  noise: number;
  ink: readonly [number, number, number][];
};

export type FieldShape = "carrier" | "near-face";
export type HauntInteraction =
  "none" | "carrier" | "wave" | "approach" | "knock";
export type AnimationPool = "small" | "large";

const PROFILES: Record<AgentPhase, SpectreProfile> = {
  reading: {
    speed: 1.1,
    breath: 0.04,
    noise: 0.5,
    ink: [
      [35, 220, 238],
      [109, 255, 103],
      [88, 125, 255],
    ],
  },
  thinking: {
    speed: 1.55,
    breath: 0.085,
    noise: 1.0,
    ink: [
      [243, 44, 181],
      [95, 126, 255],
      [236, 220, 155],
    ],
  },
  writing: {
    speed: 1.9,
    breath: 0.06,
    noise: 0.82,
    ink: [
      [43, 244, 238],
      [243, 47, 153],
      [154, 255, 72],
    ],
  },
  idle: {
    speed: 0.48,
    breath: 0.11,
    noise: 0.26,
    ink: [
      [91, 112, 232],
      [182, 82, 210],
      [49, 180, 207],
    ],
  },
  error: {
    speed: 2.4,
    breath: 0.018,
    noise: 1.45,
    ink: [
      [255, 48, 87],
      [248, 132, 42],
      [238, 221, 155],
    ],
  },
  session: {
    speed: 0.78,
    breath: 0.07,
    noise: 0.68,
    ink: [
      [35, 220, 238],
      [243, 44, 181],
      [109, 255, 103],
    ],
  },
};

const GLITCH = ["░", "▒", "▓", "█", "▓", "▒", "·", "╳", "╌"];
const BRAILLE_DOTS = [
  [0, 0, 0x01],
  [0, 1, 0x02],
  [0, 2, 0x04],
  [1, 0, 0x08],
  [1, 1, 0x10],
  [1, 2, 0x20],
  [0, 3, 0x40],
  [1, 3, 0x80],
] as const;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

function clip(text: string, width: number): string {
  return truncateToWidth(text, Math.max(0, width));
}

function row(text: string, width: number): string {
  const value = clip(text, Math.max(0, width));
  const left = Math.floor(Math.max(0, width - visibleWidth(value)) / 2);
  return clip(
    `${" ".repeat(left)}${value}${" ".repeat(Math.max(0, width - left - visibleWidth(value)))}`,
    width,
  );
}

function normalizeState(state: string): AgentPhase {
  if (state === "thinking") return "thinking";
  if (state === "writing" || state === "touching") return "writing";
  if (state === "reading" || state === "attention") return "reading";
  if (state === "error" || state === "fracturing") return "error";
  if (state === "session" || state === "re-entry") return "session";
  return "idle";
}

export function agentPhrase(state: string, frame: number): string {
  const phrases = AGENT_PHRASES[normalizeState(state)];
  return phrases[Math.floor(frame / 3) % phrases.length]!;
}

function blendProfile(
  from: SpectreProfile,
  to: SpectreProfile,
  amount: number,
  paletteFrom = from,
  paletteAmount = amount,
  paletteTo = to,
): SpectreProfile {
  const eased = smoothstep(amount);
  const easedPalette = smoothstep(paletteAmount);
  return {
    speed: from.speed + (to.speed - from.speed) * eased,
    breath: from.breath + (to.breath - from.breath) * eased,
    noise: from.noise + (to.noise - from.noise) * eased,
    ink: paletteTo.ink.map((color, index) => {
      const previous = paletteFrom.ink[index % paletteFrom.ink.length] ?? color;
      return [
        previous[0] + (color[0] - previous[0]) * easedPalette,
        previous[1] + (color[1] - previous[1]) * easedPalette,
        previous[2] + (color[2] - previous[2]) * easedPalette,
      ] as const;
    }),
  };
}

function noise(x: number, y: number, seed: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

function smoothstep(amount: number): number {
  const t = Math.max(0, Math.min(1, amount));
  return t * t * (3 - 2 * t);
}

function rgb(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function pixelDensity(
  px: number,
  py: number,
  width: number,
  height: number,
  frame: number,
  profile: SpectreProfile,
  count: number,
  shape: FieldShape,
  interaction: HauntInteraction,
  interactionStrength: number,
  animationPool: AnimationPool,
): { density: number; color: readonly [number, number, number] } {
  const phase = frame * 0.095 * profile.speed + count * 0.17;
  const x = ((px + 0.5) / width - 0.5) * 2;
  const y = ((py + 0.5) / height - 0.5) * 2;
  const breath = 1 + Math.sin(phase * 0.7) * profile.breath;
  const inhale = 1 + Math.sin(phase * 0.31 - 0.8) * profile.breath * 1.6;
  const strength = Math.max(0, Math.min(1, interactionStrength));
  const easedStrength = strength * strength * (3 - 2 * strength);
  const zoom =
    interaction === "approach"
      ? 1 + easedStrength * (0.08 + (Math.sin(phase * 0.55) + 1) * 0.08)
      : 1;
  const warpedX =
    (x - Math.sin(y * 11 + phase * 1.3) * 0.045 * profile.noise) /
    inhale /
    zoom;
  const warpedY = y / breath / zoom;

  const carrierMix =
    interaction === "carrier" ? easedStrength : shape === "carrier" ? 1 : 0;
  const nearFace =
    shape === "near-face" ||
    (interaction === "approach" && strength > 0) ||
    interaction === "carrier";
  const envelope = Math.exp(
    -((warpedX + 0.08) ** 2 / 0.72 + (warpedY * 0.82) ** 2 / 1.2),
  );
  const carrier = Math.exp(
    -((warpedY - Math.sin(warpedX * 8 + phase) * 0.18) ** 2) / 0.038,
  );
  const counterWave = Math.exp(
    -((warpedY + 0.36 - Math.sin(warpedX * 12 - phase * 1.4) * 0.12) ** 2) /
      0.024,
  );
  // A dim, phase-lagged residue keeps the mist from feeling frame-local.
  const memoryPhase = phase - 0.9;
  const memoryX = warpedX + Math.sin(warpedY * 7 + memoryPhase) * 0.025;
  const memoryY = warpedY - 0.018;
  const memoryCarrier = Math.exp(
    -((memoryY - Math.sin(memoryX * 8 + memoryPhase) * 0.18) ** 2) / 0.05,
  );
  const memory =
    memoryCarrier * (0.035 + Math.max(0, Math.sin(phase * 0.31 - 0.3)) * 0.045);
  const ringRadius = Math.sqrt(warpedX * warpedX + warpedY * warpedY);
  const ring = Math.exp(
    -((ringRadius - 0.55 - Math.sin(phase) * 0.025) ** 2) / 0.018,
  );
  const pulse =
    Math.exp(
      -((ringRadius - (0.24 + ((phase % 6.28) / 6.28) * 0.58)) ** 2) / 0.012,
    ) * 0.22;
  // The exhale leaves a nearly subliminal pressure ring behind the signal.
  const pressure = Math.max(0, Math.sin(phase * 0.31 - 2.4)) ** 4;
  const breathRing =
    Math.exp(-((ringRadius - (0.72 + pressure * 0.18)) ** 2) / 0.045) *
    pressure *
    0.07;

  // The large field only hints at a face: sockets, bridge, and mouth-like gaps
  // drift in and out of the carrier instead of becoming fixed anatomy.
  const featureMix = nearFace
    ? ((interaction === "approach" ? 0.22 + easedStrength * 0.2 : 0.22) +
        (Math.sin(phase * 0.72) + 1) *
          (interaction === "approach" ? 0.18 + easedStrength * 0.06 : 0.18)) *
      (1 - carrierMix)
    : 0;
  const faceTilt = Math.sin(phase * 0.43 + count * 0.11) * 0.035;
  const gaze =
    Math.sin(phase * 0.19 + 1.3) * 0.018 + Math.sin(phase * 0.047) * 0.012;
  const eyeY =
    -0.18 + Math.sin(phase * 0.61) * 0.025 + Math.sin(phase * 0.23) * 0.012;
  const eyeGap = 0.3 + Math.sin(phase * 0.53) * 0.035;
  const eyeScale = 1 + Math.sin(phase * 0.57) * 0.1;
  const ellipse = (cx: number, cy: number, sx: number, sy: number): number =>
    Math.sqrt(((warpedX - cx) / sx) ** 2 + ((warpedY - cy) / sy) ** 2);
  const leftEye = ellipse(
    -eyeGap + faceTilt + gaze,
    eyeY,
    0.23 * eyeScale,
    0.105,
  );
  const rightEye = ellipse(
    eyeGap + faceTilt + gaze,
    eyeY + 0.012,
    0.23 * eyeScale,
    0.105,
  );
  const blink = Math.max(0, Math.sin(phase * 0.29 + 0.8)) ** 18;
  const eyeOpenness = 1 - blink * 0.92;
  const eyeRim =
    (Math.exp(-((leftEye - 1) ** 2) / 0.055) +
      Math.exp(-((rightEye - 1) ** 2) / 0.055)) *
    eyeOpenness;
  const eyeVoid =
    (Math.exp(-(leftEye ** 2) / 0.55) + Math.exp(-(rightEye ** 2) / 0.55)) *
    eyeOpenness;
  const leftBrow =
    Math.exp(
      -((warpedY - (-0.35 + ((warpedX + eyeGap) * 0.9) ** 2 * 0.18)) ** 2) /
        0.018,
    ) * Math.exp(-((warpedX + eyeGap) ** 2) / 0.22);
  const rightBrow =
    Math.exp(
      -((warpedY - (-0.35 + ((warpedX - eyeGap) * 0.9) ** 2 * 0.18)) ** 2) /
        0.018,
    ) * Math.exp(-((warpedX - eyeGap) ** 2) / 0.22);
  const bridge =
    Math.exp(
      -(
        (warpedX -
          faceTilt * 0.5 -
          gaze * 0.45 -
          Math.sin(warpedY * 4 + phase) * 0.025) **
        2
      ) / 0.012,
    ) * Math.exp(-((warpedY + 0.01) ** 2) / 0.36);
  const mouthY = 0.39 + Math.sin(phase * 0.49) * 0.035;
  const mouth =
    Math.exp(
      -((warpedY - mouthY - Math.sin(warpedX * 6 + phase) * 0.025) ** 2) /
        0.018,
    ) * Math.exp(-(warpedX ** 2) / 0.35);
  const jaw = Math.exp(
    -(
      (Math.sqrt((warpedX / 0.72) ** 2 + ((warpedY - 0.03) / 0.9) ** 2) -
        0.82) **
      2
    ) / 0.025,
  );
  const cheek =
    Math.exp(
      -((warpedY - 0.1 - Math.sin(warpedX * 8 - phase) * 0.09) ** 2) / 0.03,
    ) * Math.max(0, 1 - Math.abs(warpedX) * 1.4);

  // A second presence stays in the peripheral mist. It breathes on a slower
  // cycle and never gets enough ink to read as a stable illustration.
  const emergence = Math.max(0, Math.sin(phase * 0.31 - 1.2)) ** 3;
  const figureBreath = 1 + Math.sin(phase * 0.41 + 2.1) * 0.055;
  const figureInhale = 1 + Math.sin(phase * 0.23 + 1.7) * 0.035;
  const figureTurn = Math.sin(phase * 0.11 - 0.6) * 0.045;
  const figureX =
    (warpedX - 0.52 - Math.sin(phase * 0.17) * 0.035) / figureInhale;
  const figureY = warpedY / figureBreath;
  const figureTiltX = figureX - figureTurn * (figureY + 0.1);
  const figureHead =
    Math.exp(-((figureTiltX / 0.18) ** 2 + ((figureY + 0.34) / 0.24) ** 2)) *
    0.18;
  const figureShoulders =
    Math.exp(
      -((figureY - 0.02 - Math.sin(figureTiltX * 5 + phase) * 0.04) ** 2) /
        0.055,
    ) *
    Math.exp(-(figureTiltX ** 2) / 0.34) *
    0.16;
  const figureBody =
    Math.exp(-((figureTiltX / 0.34) ** 2 + ((figureY - 0.38) / 0.72) ** 2)) *
    0.07;
  const secondEyeLeft =
    Math.exp(
      -(((figureTiltX + 0.07) / 0.035) ** 2 + ((figureY + 0.34) / 0.025) ** 2),
    ) * 0.11;
  const secondEyeRight =
    Math.exp(
      -(((figureTiltX - 0.07) / 0.035) ** 2 + ((figureY + 0.34) / 0.025) ** 2),
    ) * 0.11;
  const peripheralFigure =
    emergence *
    (figureHead +
      figureShoulders +
      figureBody +
      secondEyeLeft +
      secondEyeRight) *
    (1 - blink * 0.38);

  // A greeting briefly gives the signal a readable gesture before it dissolves.
  const stroke = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
  ): number => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const along = Math.max(
      0,
      Math.min(
        1,
        ((warpedX - x1) * dx + (warpedY - y1) * dy) / (dx * dx + dy * dy),
      ),
    );
    return Math.exp(
      -(
        ((warpedX - (x1 + along * dx)) ** 2 +
          (warpedY - (y1 + along * dy)) ** 2) /
        width
      ),
    );
  };
  const wave =
    interaction === "wave"
      ? (() => {
          const sway = Math.sin(phase * 0.9) * 0.09;
          const palmX = 0.5 + sway;
          const fingers = [-0.18, -0.09, 0, 0.09, 0.18].map((offset, index) =>
            stroke(
              palmX + offset,
              0.05,
              palmX + offset + sway * 0.35,
              [-0.62, -0.78, -0.84, -0.74, -0.58][index]!,
              0.012,
            ),
          );
          return Math.max(
            0,
            Math.min(
              1,
              Math.exp(
                -((warpedX - palmX) ** 2 / 0.08 + (warpedY - 0.12) ** 2 / 0.18),
              ) *
                0.9 +
                fingers.reduce((sum, value) => sum + value * 0.72, 0) +
                stroke(palmX - 0.08, 0.15, palmX + 0.28, 0.32, 0.018) * 0.8 +
                stroke(palmX, 0.28, palmX, 0.72, 0.08) * 0.35,
            ),
          );
        })() * strength
      : 0;
  // /haunt knock chooses one stable response per command. Keeping the choice
  // tied to count avoids flickering between animations while the frame advances.
  const knock =
    interaction === "knock"
      ? (() => {
          const kind = Math.abs(count * 17 + 3) % 12;
          const cycle = (frame % 16) / 16;
          const pulse = Math.exp(-((cycle * 13) ** 2));
          const ringAt = (radius: number, width = 0.012): number =>
            Math.exp(-((ringRadius - radius) ** 2) / width);
          const ring = ringAt(0.08 + cycle * 1.05, 0.01) * (1 - cycle * 0.6);
          const tremor = Math.sin(phase * 2.7) * 0.025;
          const eye = (
            cx: number,
            cy: number,
            sx: number,
            sy: number,
          ): number =>
            Math.exp(
              -(((warpedX - cx) / sx) ** 2 + ((warpedY - cy) / sy) ** 2),
            );
          let response = 0;
          if (animationPool === "small") {
            switch (kind) {
              case 0: // A thin ring skims the face and leaves a delayed echo.
                response =
                  ringAt(0.18 + cycle * 0.82, 0.008) +
                  ringAt(0.42 + cycle * 0.42, 0.02) * 0.35;
                break;
              case 1: // Two vertical signals blink out of phase.
                response =
                  eye(-0.28, -0.12, 0.08, 0.22) * (0.5 + pulse) +
                  eye(0.28, -0.12, 0.08, 0.22) * (0.25 + cycle);
                break;
              case 2: // A horizontal seam opens and closes.
                response =
                  stroke(-0.92, 0.04 + tremor, 0.92, 0.04 - tremor, 0.012) *
                  (0.3 + pulse * 0.8);
                break;
              case 3: // Four corners pull a broken outline inward.
                response =
                  [
                    stroke(-0.95, -0.8, -0.12, -0.12, 0.014),
                    stroke(0.95, -0.8, 0.12, -0.12, 0.014),
                    stroke(-0.95, 0.8, -0.12, 0.12, 0.014),
                    stroke(0.95, 0.8, 0.12, 0.12, 0.014),
                  ].reduce((sum, value) => sum + value, 0) *
                  (0.2 + cycle * 0.8);
                break;
              case 4: // A small central aperture breathes toward the viewer.
                response =
                  eye(0, 0, 0.3 + cycle * 0.18, 0.18 + cycle * 0.22) *
                  (0.3 + pulse * 0.8);
                break;
              case 5: // A flock of points crosses the field in a diagonal.
                response =
                  [-0.55, -0.28, 0, 0.28, 0.55].reduce(
                    (sum, x) =>
                      sum + eye(x + cycle * 0.22 - 0.11, x * 0.7, 0.045, 0.045),
                    0,
                  ) *
                  (0.25 + pulse * 0.7);
                break;
              case 6: // A palm-sized mark presses briefly at the lower edge.
                response =
                  eye(0.08 + tremor, 0.48, 0.24, 0.11) * 0.7 +
                  stroke(-0.3, 0.5, 0.32, 0.5 + tremor, 0.018) * pulse;
                break;
              case 7: // A ladder of short bars climbs from the bottom.
                response =
                  Array.from({ length: 5 }, (_, index) =>
                    stroke(
                      -0.34 + index * 0.17,
                      0.9,
                      -0.34 + index * 0.17,
                      0.9 - cycle * 1.5,
                      0.01,
                    ),
                  ).reduce((sum, value) => sum + value, 0) *
                  (0.25 + pulse * 0.75);
                break;
              case 8: // A narrow mouth splits into two mismatched lines.
                response =
                  stroke(-0.5, 0.25, 0.05, 0.25 + tremor, 0.012) *
                    (0.35 + pulse) +
                  stroke(-0.05, 0.3, 0.5, 0.3 - tremor, 0.01) * cycle;
                break;
              case 9: // A small orbit circles once around the centre.
                response =
                  Array.from({ length: 5 }, (_, index) => {
                    const angle = phase * 0.9 + index * 1.26;
                    return eye(
                      Math.cos(angle) * 0.38,
                      Math.sin(angle) * 0.38,
                      0.045,
                      0.045,
                    );
                  }).reduce((sum, value) => sum + value, 0) *
                  (0.2 + pulse * 0.8);
                break;
              case 10: // The face is scanned by a single bright horizontal bar.
                response =
                  Math.exp(-((warpedY - (cycle * 1.8 - 0.9)) ** 2) / 0.012) *
                  (0.25 + pulse * 0.75);
                break;
              default: // A compact double beat answers from behind the glass.
                response =
                  ringAt(0.24 + cycle * 0.38, 0.012) * 0.75 +
                  eye(0, 0, 0.52, 0.24) * pulse * 0.45;
            }
            return Math.max(0, Math.min(1, response * easedStrength));
          }
          switch (kind) {
            case 0: // A shockwave arrives from the centre.
              response = ring * 0.9 + pulse * 0.7;
              break;
            case 1: // The face opens its eyes only after being touched.
              response =
                (eye(-0.3 + tremor, -0.18, 0.2, 0.07) +
                  eye(0.3 + tremor, -0.18, 0.2, 0.07)) *
                (0.35 + pulse * 0.9);
              break;
            case 2: // Fingers crawl inward from all four edges.
              response =
                [
                  stroke(-0.98, -0.5, -0.08 + tremor, 0, 0.018),
                  stroke(0.98, -0.42, 0.08 + tremor, 0.02, 0.018),
                  stroke(-0.4, -0.98, 0, -0.08 + tremor, 0.018),
                  stroke(0.42, 0.98, 0, 0.08 + tremor, 0.018),
                ].reduce((sum, value) => sum + value, 0) *
                (0.3 + cycle);
              break;
            case 3: // A cracked signal radiates out, then forgets its shape.
              response =
                [0, 1.57, 3.14, 4.71].reduce(
                  (sum, angle) =>
                    sum +
                    stroke(
                      0,
                      0,
                      Math.cos(angle + tremor) * (0.2 + cycle),
                      Math.sin(angle + tremor) * (0.2 + cycle),
                      0.014,
                    ),
                  0,
                ) *
                (1 - cycle * 0.45);
              break;
            case 4: // Something breathes directly against the glass.
              response =
                Math.exp(
                  -((ringRadius - (0.35 + Math.sin(phase * 0.8) * 0.08)) ** 2) /
                    0.025,
                ) *
                  0.8 +
                eye(0, 0, 0.5, 0.8) * pulse * 0.45;
              break;
            case 5: // Several small eyes appear at once, never quite aligned.
              response =
                [-0.48, 0, 0.48].reduce(
                  (sum, x) =>
                    sum +
                    eye(x + tremor, Math.sin(phase + x) * 0.18, 0.09, 0.045),
                  0,
                ) *
                (0.35 + pulse * 0.7);
              break;
            case 6: // A handprint-like palm and fingers press from the near side.
              response =
                eye(-0.12 + tremor, 0.18, 0.26, 0.32) * 0.55 +
                [-0.24, -0.12, 0, 0.12, 0.24].reduce(
                  (sum, x) => sum + stroke(x, 0.02, x + tremor, -0.62, 0.014),
                  0,
                ) *
                  (0.35 + pulse * 0.65);
              break;
            case 7: // The response climbs upward like a body behind frosted glass.
              response =
                [-0.5, -0.25, 0, 0.25, 0.5].reduce(
                  (sum, x) =>
                    sum + stroke(x, 0.9, x + tremor, -0.9 + cycle * 0.7, 0.012),
                  0,
                ) *
                (0.25 + pulse * 0.75);
              break;
            case 8: // A mouth opens, then leaves a second mouth behind it.
              response =
                stroke(-0.42, 0.28, 0.42, 0.28 + tremor, 0.018) *
                  (0.35 + pulse * 0.8) +
                stroke(-0.28, 0.42, 0.28, 0.42 - tremor, 0.012) * cycle;
              break;
            case 9: // A spiral coils toward the operator instead of expanding away.
              response =
                Array.from({ length: 6 }, (_, index) => {
                  const radius = 0.08 + index * 0.12;
                  const angle = phase * 0.7 + index * 1.45;
                  return stroke(
                    Math.cos(angle) * radius,
                    Math.sin(angle) * radius,
                    Math.cos(angle + 0.9) * (radius + 0.12),
                    Math.sin(angle + 0.9) * (radius + 0.12),
                    0.014,
                  );
                }).reduce((sum, value) => sum + value, 0) *
                (0.25 + pulse * 0.75);
              break;
            case 10: // The image is dragged sideways in strips, like a thing escaping.
              response =
                Array.from(
                  { length: 7 },
                  (_, index) =>
                    Math.exp(-((warpedY - (index - 3) * 0.18) ** 2) / 0.012) *
                    (0.25 + Math.sin(phase + index) ** 2 * 0.7),
                ).reduce((sum, value) => sum + value, 0) *
                (0.25 + cycle * 0.7);
              break;
            default: // The whole field stutters in concentric, almost-human beats.
              response =
                ringAt(0.22 + cycle * 0.45, 0.018) * 0.8 +
                ringAt(0.52 - cycle * 0.2, 0.014) * 0.6 +
                pulse * 0.35;
          }
          return Math.max(0, Math.min(1, response * easedStrength));
        })()
      : 0;

  const faceDensity =
    envelope * (0.13 + carrier * 0.32 + counterWave * 0.18) +
    eyeRim * 0.46 * featureMix +
    (leftBrow + rightBrow) * 0.16 * featureMix +
    bridge * 0.14 * featureMix +
    mouth * 0.23 * featureMix +
    jaw * 0.11 * featureMix +
    cheek * 0.08 * featureMix +
    ring * 0.12 +
    pulse * 0.18 +
    breathRing +
    memory +
    peripheralFigure -
    eyeVoid * 0.24 * featureMix +
    wave +
    knock;
  const carrierDensity =
    envelope * (carrier * 0.72 + counterWave * 0.54) +
    ring * 0.19 +
    pulse +
    memory +
    wave +
    knock;
  let density = faceDensity * (1 - carrierMix) + carrierDensity * carrierMix;

  const interference =
    Math.sin(warpedX * 29 + warpedY * 17 + phase * 2.2) * 0.16 * profile.noise;
  const scan =
    0.7 + 0.3 * Math.sin(((py + frame * profile.speed * 0.55) * Math.PI) / 3);
  density = Math.max(0, density * scan + interference);

  const edgeLoss =
    Math.max(0, Math.abs(warpedX) - 0.58) * (0.08 + profile.noise * 0.05);
  const packetLoss = noise(px * 0.7, py * 0.9, frame / 3 + 31) < edgeLoss;
  if (packetLoss) density *= 0.3;
  const tear =
    Math.sin(warpedY * 33 + phase * 2.5) > 0.78 &&
    noise(px, py, frame / 2) < 0.24 + profile.noise * 0.18;
  if (tear) density *= 0.12;
  if (
    density < 0.08 &&
    noise(px * 0.8, py * 0.7, frame / 3 + 9) < 0.02 + profile.noise * 0.018
  ) {
    density = 0.12 + noise(px + 5, py + 2, frame + count) * 0.3;
  }

  // Interpolate between palette stops instead of flooring the index; this keeps
  // colour motion continuous while the field shifts between animation states.
  const palettePosition = Math.abs(
    (warpedX + 1) * 1.8 +
      Math.sin(warpedY * 5 + phase) * 1.4 +
      phase * profile.noise,
  );
  const paletteIndex = Math.floor(palettePosition) % profile.ink.length;
  const paletteBlend = smoothstep(
    palettePosition - Math.floor(palettePosition),
  );
  const palette = profile.ink[paletteIndex] ?? profile.ink[0]!;
  const nextPalette =
    profile.ink[(paletteIndex + 1) % profile.ink.length] ?? palette;
  const blendedPalette = [
    palette[0] + (nextPalette[0] - palette[0]) * paletteBlend,
    palette[1] + (nextPalette[1] - palette[1]) * paletteBlend,
    palette[2] + (nextPalette[2] - palette[2]) * paletteBlend,
  ] as const;
  const brightness =
    0.5 + Math.max(0, 1 - Math.abs(warpedX + 0.35)) * 0.42 + density * 0.42;
  return {
    density: Math.max(0, Math.min(1, density)),
    color: [
      rgb(blendedPalette[0] * brightness),
      rgb(blendedPalette[1] * brightness),
      rgb(blendedPalette[2] * brightness),
    ],
  };
}

function brailleRow(
  width: number,
  rowIndex: number,
  fieldRows: number,
  frame: number,
  profile: SpectreProfile,
  count: number,
  shape: FieldShape,
  interaction: HauntInteraction,
  interactionStrength: number,
  animationPool: AnimationPool,
): string {
  const pixelWidth = width * 2;
  const pixelHeight = fieldRows * 4;
  const sourceFrame = Math.floor(frame);
  const frameBlend = frame - sourceFrame;
  let result = "";
  let colorKey = "";
  for (let cellX = 0; cellX < width; cellX++) {
    let mask = 0;
    const samples: {
      density: number;
      color: readonly [number, number, number];
    }[] = [];
    for (const [dx, dy, bit] of BRAILLE_DOTS) {
      const x = cellX * 2 + dx;
      const y = rowIndex * 4 + dy;
      const current = pixelDensity(
        x,
        y,
        pixelWidth,
        pixelHeight,
        sourceFrame,
        profile,
        count,
        shape,
        interaction,
        interactionStrength,
        animationPool,
      );
      // Blend the source pixels before selecting the Braille glyph. Ordered
      // Bayer dithering then turns that continuous value into small dot changes
      // instead of swapping the whole glyph at each animation frame.
      const sample =
        frameBlend === 0
          ? current
          : (() => {
              const next = pixelDensity(
                x,
                y,
                pixelWidth,
                pixelHeight,
                sourceFrame + 1,
                profile,
                count,
                shape,
                interaction,
                interactionStrength,
                animationPool,
              );
              return {
                density:
                  current.density +
                  (next.density - current.density) * frameBlend,
                color: [
                  current.color[0] +
                    (next.color[0] - current.color[0]) * frameBlend,
                  current.color[1] +
                    (next.color[1] - current.color[1]) * frameBlend,
                  current.color[2] +
                    (next.color[2] - current.color[2]) * frameBlend,
                ] as const,
              };
            })();
      samples.push(sample);
      const ditherX = Math.floor(sourceFrame / 6);
      const ditherY = Math.floor(sourceFrame / 4);
      const ditherIndex = ((y + ditherY) % 4) * 4 + ((x + ditherX) % 4);
      const threshold = 0.2 + BAYER[ditherIndex]! / 32;
      if (sample.density > threshold) mask |= bit;
    }
    if (!mask) {
      result += " ";
      continue;
    }
    let red = 0;
    let green = 0;
    let blue = 0;
    for (const sample of samples) {
      red += sample.color[0];
      green += sample.color[1];
      blue += sample.color[2];
    }
    const color = [
      rgb(red / samples.length),
      rgb(green / samples.length),
      rgb(blue / samples.length),
    ] as const;
    const key = color.join(",");
    if (key !== colorKey) {
      result += `\x1b[38;2;${color[0]};${color[1]};${color[2]}m`;
      colorKey = key;
    }
    result += String.fromCodePoint(0x2800 + mask);
  }
  return `${result}\x1b[39m`;
}

const BRAILLE_WHISPERS = [
  "шёпот",
  "НЕ СМОТРИ",
  "VOID",
  "ОТКРОЙ",
  "h̷u̷s̷h̷",
  "E̸C̸H̸O̸",
  "помни",
  "[REDACTED]",
  "дрожь",
  "WAKE",
  "не здесь",
  "signal?",
] as const;

export function renderBrailleSubliminal(
  width: number,
  rows: number,
  frame: number,
  state: string,
  count: number,
  interaction: HauntInteraction = "none",
  interactionStrength = 1,
  whisper = false,
  animationPool: AnimationPool = rows <= 5 ? "small" : "large",
  paletteFromState = state,
  paletteBlend = 1,
  animationFromState = state,
  animationBlend = 1,
  paletteToState = state,
  animationToState = state,
  textFrame = frame,
): string[] {
  const field = renderBrailleField(
    width,
    rows,
    frame,
    state,
    count,
    "near-face",
    interaction,
    interactionStrength,
    animationPool,
    paletteFromState,
    paletteBlend,
    animationFromState,
    animationBlend,
    paletteToState,
    animationToState,
  );
  if (whisper) {
    const profile = blendProfile(
      PROFILES[normalizeState(animationFromState)],
      PROFILES[normalizeState(animationToState)],
      animationBlend,
      PROFILES[normalizeState(paletteFromState)],
      paletteBlend,
      PROFILES[normalizeState(paletteToState)],
    );
    // Words overwrite the dot field sparsely: readable only long enough to doubt it.
    // Keep one whisper visible every frame; sparse selection made the feature
    // look broken on short fields and during slow animation phases.
    const index = Math.floor((textFrame + count) / 3) % BRAILLE_WHISPERS.length;
    const word = glitchText(
      BRAILLE_WHISPERS[index]!,
      textFrame + index * 3,
      profile,
    );
    const row = Math.floor(
      Math.abs(Math.sin((textFrame + count * 13) * 12.9898) * 43758.5453) %
        field.length,
    );
    const start = Math.floor(
      Math.abs(Math.sin((textFrame + count * 7) * 78.233) * 43758.5453) %
        Math.max(1, width - word.length + 1),
    );
    if (field[row])
      field[row] = scatterWhisper(field[row]!, word, start, width);
  }
  return field;
}

export function renderBrailleField(
  width: number,
  rows: number,
  frame: number,
  state: string,
  count: number,
  shape: FieldShape = "carrier",
  interaction: HauntInteraction = "none",
  interactionStrength = 1,
  animationPool: AnimationPool = rows <= 5 ? "small" : "large",
  paletteFromState = state,
  paletteBlend = 1,
  animationFromState = state,
  animationBlend = 1,
  paletteToState = state,
  animationToState = state,
  textFrame = frame,
): string[] {
  const fieldWidth = Math.max(1, Math.floor(width || 1));
  const fieldRows = Math.max(1, Math.floor(rows || 1));
  const profile = blendProfile(
    PROFILES[normalizeState(animationFromState)],
    PROFILES[normalizeState(animationToState)],
    animationBlend,
    PROFILES[normalizeState(paletteFromState)],
    paletteBlend,
    PROFILES[normalizeState(paletteToState)],
  );
  return Array.from({ length: fieldRows }, (_, rowIndex) =>
    brailleRow(
      fieldWidth,
      rowIndex,
      fieldRows,
      frame,
      profile,
      count,
      shape,
      interaction,
      interactionStrength,
      animationPool,
    ),
  );
}

function glitchText(
  text: string,
  frame: number,
  profile: SpectreProfile,
): string {
  return Array.from(text)
    .map((char, index) =>
      char !== " " && (index * 7 + frame * profile.speed) % 17 < 1.2
        ? GLITCH[(index + frame) % GLITCH.length]!
        : char,
    )
    .join("");
}

export function renderSpectre(
  width: number,
  rows = 5,
  frame = 0,
  state = "idle",
  count = 0,
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
  // Overlay dimensions can briefly be zero/invalid while the TUI resizes.
  // Keep the small SPECTRE renderer from passing an invalid Array length to
  // the field renderer during that transition.
  const w = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
  rows = Number.isFinite(rows) ? Math.max(1, Math.floor(rows)) : 5;
  const phase = normalizeState(state);
  const profile = blendProfile(
    PROFILES[normalizeState(animationFromState)],
    PROFILES[normalizeState(animationToState)],
    animationBlend,
    PROFILES[normalizeState(paletteFromState)],
    paletteBlend,
    PROFILES[normalizeState(paletteToState)],
  );
  const phrase = agentPhrase(phase, textFrame);
  const field = renderBrailleSubliminal(
    w,
    rows,
    frame,
    phase,
    count,
    interaction,
    interactionStrength,
    whisper,
    rows <= 5 ? "small" : "large",
    paletteFromState,
    paletteBlend,
    animationFromState,
    animationBlend,
    paletteToState,
    animationToState,
  );
  const signal = GLITCH.slice(
    0,
    Math.max(2, Math.min(12, 4 + (Math.floor(frame / 2) % 8))),
  ).join("");
  const carrier =
    phase === "thinking"
      ? "folding"
      : phase === "writing"
        ? "emitting"
        : phase === "reading"
          ? "acquiring"
          : phase === "error"
            ? "fracturing"
            : phase === "session"
              ? "re-entering"
              : "held";
  if (w < 30)
    return [
      row(
        glitchText(
          `S P E C T R E // ${phrase.toUpperCase()}`,
          textFrame,
          profile,
        ),
        w,
      ),
      ...field,
      row(
        glitchText(
          ` STATE:${carrier.toUpperCase()}  ENCOUNTERS:${count}  SIGNAL:${signal}`.toUpperCase(),
          textFrame,
          profile,
        ),
        w,
      ),
    ];
  return [
    row(glitchText(` S P E C T R E // ${phrase} `, textFrame, profile), w),
    ...field,
    row(
      glitchText(
        ` STATE:${carrier.toUpperCase()}  ENCOUNTERS:${count}  SIGNAL:${signal}`.toUpperCase(),
        textFrame,
        profile,
      ),
      w,
    ),
  ];
}

function scatterWhisper(
  line: string,
  word: string,
  start: number,
  width: number,
): string {
  const chars = Array.from(word).slice(0, Math.max(1, width));
  const safeStart = Math.max(
    0,
    Math.min(start, Math.max(0, width - chars.length)),
  );
  let output = "";
  let visible = 0;
  for (let index = 0; index < line.length;) {
    if (line[index] === "\x1b") {
      const escape = line.slice(index).match(/^\x1b\[[0-9;]*m/)?.[0];
      if (escape) {
        output += escape;
        index += escape.length;
        continue;
      }
    }
    const codePoint = Array.from(line.slice(index))[0]!;
    const replacement =
      visible >= safeStart && visible < safeStart + chars.length
        ? chars[visible - safeStart]!
        : codePoint;
    output += replacement;
    index += codePoint.length;
    visible++;
  }
  return output;
}

// The master haunt extension owns lifecycle and responsive switching.
export default function spectre(_pi: ExtensionAPI) {}
