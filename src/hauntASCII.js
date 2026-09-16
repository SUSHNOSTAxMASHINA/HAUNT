import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
// density-ordered glyphs turn the generated image into terminal art.
const GLYPHS = " .,:;irsXA253hMHGS#9B&@";
// sparse symbols make dissolving regions look like broken code.
const CODE_GLYPHS = "01{}[]<>/\\|=+*#@$%&";
const MACHINE_WIDTH = 140;
const SOURCE_WIDTH = 70;
const MACHINE_HEIGHT = 24;
// repeatable noise leaves no particles behind.
function noise(x, y, seed) {
    const value = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
    return value - Math.floor(value);
}
// turn density into a mark.
function glyphFor(density) {
    const index = Math.max(0, Math.min(GLYPHS.length - 1, Math.round(density * (GLYPHS.length - 1))));
    return GLYPHS[index];
}
// make the older field from geometry and noise.
function machineFrame(frame, interaction = "none", interactionStrength = 1) {
    const cx = 34;
    const cy = 10;
    return Array.from({ length: MACHINE_HEIGHT }, (_, y) => Array.from({ length: MACHINE_WIDTH }, (_, x) => {
        const sourceX = (x / Math.max(1, MACHINE_WIDTH - 1)) *
            (SOURCE_WIDTH - 1);
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
            const contour = Math.sin(y * 2.35 + dx * 0.2 + Math.sin(frame * 0.3) * 1.4);
            if (contour > 0.7)
                density += 0.14;
            if (dx > 7 && noise(x, y, frame + 9) < 0.08 + dissolve * 0.24) {
                density *= 0.16;
                codeSignal = true;
            }
        }
        if (hair < 1.2 && (dx < -1 || noise(x, y, frame + 13) < 0.45)) {
            density = Math.max(density, 0.1 + (noise(x + 4, y + 7, frame) * 0.34));
        }
        if (y > 18 && Math.abs(dx) < 12 + (y - 18) * 2.4) {
            density = Math.max(density, 0.12 + (noise(x, y, frame + 3) * 0.28));
        }
        // broken edges hold the shape in place.
        const slope = Math.max(0, (y - 1) / 22);
        const leftEdge = cx - 31 * slope;
        const rightEdge = cx + 31 * slope;
        if (Math.abs(sourceX - leftEdge) < 0.55 ||
            Math.abs(sourceX - rightEdge) < 0.55 ||
            (y >= 22 && sourceX >= 3 && sourceX <= 65 && (x + frame) % 5 < 3)) {
            density = Math.max(density, 0.58 + noise(x, y, frame + 2) * 0.2);
        }
        // traces suggest a face without keeping one.
        const leftEye = ((sourceX - 25) / 6.1) ** 2 + ((y - 8) / 1.55) ** 2;
        const rightEye = ((sourceX - 40) / 6.1) ** 2 + ((y - 8.2) / 1.6) ** 2;
        if (Math.abs(leftEye - 1) < 0.22 || Math.abs(rightEye - 1) < 0.22)
            density = Math.max(density, 0.96);
        if (leftEye < 1 || rightEye < 1)
            density = Math.max(density, 0.26);
        const leftPupil = ((sourceX - 26) / 1.45) ** 2 + ((y - 8) / 1.15) ** 2;
        const rightPupil = ((sourceX - 40) / 1.45) ** 2 +
            ((y - 8.2) / 1.15) ** 2;
        if (leftPupil < 0.65 || rightPupil < 0.65)
            return frame % 2 ? "X" : "+";
        const brow = Math.abs(y - (5.4 + ((sourceX - 32) / 15) ** 2 * 1.4)) < 0.6 &&
            sourceX > 18 && sourceX < 47;
        if (brow)
            density = Math.max(density, 0.74);
        const noseX = 33 + Math.max(0, y - 9) * 0.42;
        if (Math.abs(sourceX - noseX) < 0.65 && y >= 8 && y <= 14) {
            density = Math.max(density, 0.72);
        }
        const nostril = ((sourceX - 36) / 2.3) ** 2 + ((y - 14) / 1.15) ** 2;
        if (nostril < 1)
            density = Math.max(density, 0.84);
        const lip = Math.abs(y - (16 + Math.abs(sourceX - 35) * 0.08)) < 0.58 &&
            sourceX > 26 && sourceX < 45;
        if (lip)
            density = Math.max(density, 0.88);
        if (y === 17 && sourceX >= 31 && sourceX <= 40 && x % 2 === frame % 2)
            density = 0.4;
        if (interaction === "approach") {
            const strength = Math.max(0, Math.min(1, interactionStrength));
            const zoom = 1 + strength * (Math.sin(frame * 0.28) + 1) * 0.12;
            const nearX = 35 + (sourceX - 35) / zoom;
            const nearY = 11 + (y - 11) / zoom;
            const nearFace = ((nearX - 35) / 17) ** 2 + ((nearY - 11) / 9) ** 2;
            if (nearFace < 1.05 &&
                (Math.abs(nearY - 7.5) < 0.75 || Math.abs(nearY - 15.5) < 0.7 ||
                    Math.abs(nearX - 35) < 0.55))
                density = Math.max(density, 0.82 * strength);
        }
        if (interaction === "wave") {
            const strength = Math.max(0, Math.min(1, interactionStrength));
            const line = (x1, y1, x2, y2, thickness) => {
                const dx = x2 - x1;
                const dy = y2 - y1;
                const along = Math.max(0, Math.min(1, ((sourceX - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
                return Math.exp(-(((sourceX - x1 - along * dx) ** 2 +
                    (y - y1 - along * dy) ** 2) / thickness));
            };
            const sway = Math.sin(frame * 0.35) * 2.2;
            const palm = Math.exp(-(((sourceX - (53 + sway)) / 5) ** 2 + ((y - 12) / 5) ** 2));
            const fingers = [-3, -1.5, 0, 1.5, 3].reduce((sum, offset, index) => sum +
                line(53 + sway + offset, 10, 53 + sway + offset + sway * 0.25, [3, 2, 1.5, 2, 4][index], 0.8), 0);
            density = Math.max(density, (palm * 0.78 + fingers * 0.8 +
                line(51 + sway, 15, 48, 22, 2.5) * 0.5) * strength);
        }
        const cheekLine = Math.abs(Math.sin((sourceX - 22) * 0.45 + y * 0.9 + frame * 0.12)) <
            0.08 && skull < 0.9 && y > 9;
        if (cheekLine) {
            density = Math.max(density, 0.5);
        }
        if (density < 0.07 && y > 2 && y < 22 && sourceX > 43 &&
            noise(x, y, frame + 4) < 0.04 + dissolve * 0.18) {
            density = 0.12 + noise(x + 11, y + 3, frame) * 0.35;
            codeSignal = true;
        }
        if (density < 0.07 && y > 2 && y < 22 && noise(x, y, frame + 17) < 0.018) {
            density = 0.1 + noise(x + 23, y + 5, frame + 2) * 0.22;
            codeSignal = true;
        }
        if (density < 0.07) {
            return " ";
        }
        if (codeSignal && skull > 0.72) {
            return CODE_GLYPHS[Math.floor(noise(x + 19, y + 7, frame + 6) * CODE_GLYPHS.length)];
        }
        return glyphFor(Math.max(0, Math.min(1, density)));
    }).join(""));
}
// render the older field inside its bounds.
export function renderASCIIField(width, height, frame) {
    const imageWidth = Math.min(MACHINE_WIDTH, Math.max(1, Math.floor(width)));
    // hold the phase long enough for the shape to be seen.
    const phase = Math.floor(frame / 2) % 24;
    const frames = machineFrame(phase);
    return Array.from({ length: Math.max(1, Math.floor(height)) }, (_, rowIndex) => ditherRow(centerSlice(frames[rowIndex + 2] ?? "", imageWidth), imageWidth, rowIndex, frame));
}
const FRAMES = Array.from({ length: 8 }, (_, frame) => machineFrame(frame));
const EYES = [
    "          ",
    "    ·  ·  ",
    "    ▪  ▪  ",
    "    ●  ●  ",
    "    ·  ·  ",
];
const TRACE = [
    "·────·────┈┈·───·",
    "·──┈┈·────·─────·",
    "┈·────·──┈┈·────·",
    "·────┈┈·────·───·",
];
const BREATH = [
    "inhaling",
    "inhaling",
    "held",
    "exhaling",
    "exhaling",
    "empty",
    "held",
];
const ANSI_3BIT = [
    "\x1b[30m", // black
    "\x1b[31m", // red
    "\x1b[32m", // green
    "\x1b[33m", // yellow
    "\x1b[34m", // blue
    "\x1b[35m", // magenta
    "\x1b[36m", // cyan
    "\x1b[37m", // white
];
const DITHER_RESET = "\x1b[39m";
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const STATE_GLYPHS = ["◌", "◍", "◎", "◉", "◈"];
const ERROR_WEATHER = ["static", "fracture", "static", "clearing"];
const IDLE_THOUGHTS = [
    "the room moved",
    "nothing touched it",
    "still waiting",
    "a sound without a source",
];
const SESSION_WEATHER = ["re-entering", "branching", "old room", "new room"];
function clip(text, width) {
    return truncateToWidth(text, Math.max(0, width));
}
// keep the center of a wide frame.
function centerSlice(text, width) {
    const chars = Array.from(text);
    if (chars.length <= width)
        return text;
    const start = Math.floor((chars.length - width) / 2);
    return chars.slice(start, start + width).join("");
}
// center one clipped line.
function row(text, width) {
    if (width <= 0)
        return "";
    const clipped = clip(text, width);
    const left = Math.floor(Math.max(0, width - visibleWidth(clipped)) / 2);
    return clip(`${" ".repeat(left)}${clipped}${" ".repeat(Math.max(0, width - left - visibleWidth(clipped)))}`, width);
}
function centered(text, width) {
    return row(text, width);
}
// the small field keeps four marks, an afterimage, and a way to vanish.
const ASCII_ANIMATIONS = [
    () => [" . . .", "(   )", "  /|\\", "  / \\"],
    (frame) => frame % 2
        ? [" . . .", "(   )", "  /|\\", "  / \\"].map((line) => line.replace(".", " "))
        : [" . . .", "(   )", "  /|\\", "  / \\"],
    () => [" . . .", "( ● )", "  /|\\", "  / \\"],
    () => [" . . .", "(   )", "  /|\\", "  / \\", " . . .", "(   )"],
    (frame) => frame % 4 < 2
        ? [" . . .", "(   )", "  /|\\", "  / \\"].map((line) => line.replace(/[.|()]/g, " "))
        : [],
    (frame) => [" . . .", "(   )", "  /|\\", "  / \\"].map((line, index) => `${line}${index === frame % 4 ? "  " + (frame % 2 ? "o" : ".") : ""}`),
    () => [" . . .", "(   )", "  /|\\", "  / \\"].map((line, index) => index === 1 ? "  " + line : line),
];
let asciiCycle = true;
// render the small field without moving the viewport.
export function compactPanel(width, frame, state, count, interaction = "none") {
    const w = Math.max(1, Math.floor(width || 1));
    const center = (text) => {
        const clipped = truncateToWidth(text, w);
        return `${" ".repeat(Math.max(0, Math.floor((w - visibleWidth(clipped)) / 2)))}${clipped}`;
    };
    const animation = asciiCycle
        ? ASCII_ANIMATIONS[Math.floor(frame / 6) % ASCII_ANIMATIONS.length]
        : ASCII_ANIMATIONS[0];
    const figure = animation(frame);
    // keep the figure's rows fixed while it fades.
    const fixedFigure = Array.from({ length: 4 }, (_, index) => center(figure[index] ?? ""));
    return w < 30 ? fixedFigure : [
        center(` S P E C T R E // ${state.toUpperCase()} `),
        ...fixedFigure,
        center(`encounters: ${count}`),
    ];
}
// choose the mark for the current state.
function stateGlyph(attentionActive, thinking, transition) {
    if (thinking)
        return STATE_GLYPHS[Math.min(4, 2 + transition)];
    if (attentionActive)
        return STATE_GLYPHS[Math.min(3, 1 + transition)];
    return STATE_GLYPHS[Math.min(2, transition)];
}
function breathLabel(frame) {
    return BREATH[frame % BREATH.length];
}
function sessionWeatherLabel(frame, count) {
    return SESSION_WEATHER[(frame + count) % SESSION_WEATHER.length];
}
function errorWeatherLabel(frame) {
    return ERROR_WEATHER[frame % ERROR_WEATHER.length];
}
function sanitizeEcho(text) {
    return text.replace(/\s+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").trim()
        .slice(0, 42);
}
// let the field notice what kind of work is passing through.
function phaseForTool(toolName, args = {}) {
    const name = toolName.toLowerCase();
    if (["read", "grep", "find", "ls", "glob", "search"].includes(name)) {
        return "reading";
    }
    if (["write", "edit", "apply_patch"].includes(name))
        return "writing";
    if (name === "bash") {
        const command = typeof args === "object" && args !== null && "command" in args &&
            typeof args.command === "string"
            ? args.command
            : "";
        if (/\b(tee|touch|mkdir|rm|mv|cp|install|apply_patch|git\s+(add|commit|checkout|reset))\b|>>?/
            .test(command))
            return "writing";
        if (/\b(rg|grep|find|ls|pwd|head|tail|cat|sed|awk|git\s+(status|diff|log|show))\b/
            .test(command))
            return "reading";
    }
    return "thinking";
}
// turn a mark back into approximate density.
function glyphDensity(character) {
    const index = GLYPHS.indexOf(character);
    return index >= 0
        ? Math.min(15, index * 2)
        : 5 + (character.charCodeAt(0) % 9);
}
// let selected colours drift without losing the ramp.
function cycleColor(color, frame, rowIndex) {
    let next = color;
    for (const [low, high] of CYCLE_RANGES) {
        if (next < low || next > high)
            continue;
        const size = high - low + 1;
        const shift = Math.floor((frame + rowIndex * 0.35) / 3) % size;
        next = low + ((next - low + shift + size) % size);
    }
    return next;
}
// let density choose the terminal colour.
function ditherColor(text, rowIndex, frame) {
    let result = "";
    let activeColor = -1;
    for (const [index, character] of Array.from(text).entries()) {
        if (character === " ") {
            if (activeColor >= 0)
                result += DITHER_RESET;
            activeColor = -1;
            result += character;
            continue;
        }
        const density = glyphDensity(character);
        const level = Math.min(7, (density * 7) / 15);
        const base = Math.floor(level);
        const threshold = BAYER[((rowIndex + frame) % 4) * 4 + (index % 4)];
        const colorLevel = Math.min(EGA_RAMP.length - 1, base + (threshold < (level - base) * 16 ? 1 : 0));
        const color = cycleColor(EGA_RAMP[colorLevel], frame, rowIndex);
        if (color !== activeColor) {
            if (activeColor >= 0)
                result += DITHER_RESET;
            result += ANSI_3BIT[color];
            activeColor = color;
        }
        result += character;
    }
    return activeColor >= 0 ? result + DITHER_RESET : result;
}
// colour and trim one row.
function ditherRow(text, width, rowIndex, frame) {
    if (width <= 0)
        return "";
    const raw = Array.from(text).slice(0, width).join("");
    return clip(ditherColor(raw, rowIndex, frame), width);
}
