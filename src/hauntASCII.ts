import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { agentPhrase, renderSpectre, type AgentPhase, type HauntInteraction } from "./spectre.ts";

const GLYPHS = " .,:;irsXA253hMHGS#9B&@";
const CODE_GLYPHS = "01{}[]<>/\\|=+*#@$%&";
const MACHINE_WIDTH = 140;
const SOURCE_WIDTH = 70;
const MACHINE_HEIGHT = 24;
const MACHINE_VIEW_MIN_WIDTH = 96;
const MAX_PANEL_WIDTH = 1000;
type ViewMode = "machine" | "haunt";
type KnockPhase = "wave" | "approach" | "fracture" | "vanish";
const MODE_MESSAGES = {
	machine: { hello: "GHOST/MACHINE found room to breathe.", goodbye: "GHOST/MACHINE is folding into the small window." },
	haunt: { hello: "haunt slipped into the small window.", goodbye: "haunt is leaving a little residue." },
} as const;
const DITHER = [".", ":", ";", "+", "*", "#", "@", "#"];
// EGA luminance order, expressed through ANSI's eight basic foreground colors.
// Keep white out of the animated ramp; it reads as a flash against the dark field.
const EGA_RAMP = [0, 4, 1, 5, 2, 6, 3] as const;
const CYCLE_RANGES = [[1, 3], [4, 6]] as const;

function noise(x: number, y: number, seed: number): number {
	const value = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
	return value - Math.floor(value);
}

function glyphFor(density: number): string {
	const index = Math.max(0, Math.min(GLYPHS.length - 1, Math.round(density * (GLYPHS.length - 1))));
	return GLYPHS[index]!;
}

function machineFrame(frame: number, interaction: HauntInteraction = "none", interactionStrength = 1): string[] {
	const cx = 34;
	const cy = 10;
	return Array.from({ length: MACHINE_HEIGHT }, (_, y) => Array.from({ length: MACHINE_WIDTH }, (_, x) => {
		const sourceX = (x / Math.max(1, MACHINE_WIDTH - 1)) * (SOURCE_WIDTH - 1);
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
			if (contour > 0.7) density += 0.14;
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

		// Thin triangle edges and a broken base recall an occult EGA loading screen.
		const slope = Math.max(0, (y - 1) / 22);
		const leftEdge = cx - 31 * slope;
		const rightEdge = cx + 31 * slope;
		if (Math.abs(sourceX - leftEdge) < 0.55 || Math.abs(sourceX - rightEdge) < 0.55 || (y >= 22 && sourceX >= 3 && sourceX <= 65 && (x + frame) % 5 < 3)) {
			density = Math.max(density, 0.58 + noise(x, y, frame + 2) * 0.2);
		}

		// Eyes, nose, lips, cheek contours: a face survives the dither instead of a mascot.
		const leftEye = ((sourceX - 25) / 6.1) ** 2 + ((y - 8) / 1.55) ** 2;
		const rightEye = ((sourceX - 40) / 6.1) ** 2 + ((y - 8.2) / 1.6) ** 2;
		if (Math.abs(leftEye - 1) < 0.22 || Math.abs(rightEye - 1) < 0.22) density = Math.max(density, 0.96);
		if (leftEye < 1 || rightEye < 1) density = Math.max(density, 0.26);
		const leftPupil = ((sourceX - 26) / 1.45) ** 2 + ((y - 8) / 1.15) ** 2;
		const rightPupil = ((sourceX - 40) / 1.45) ** 2 + ((y - 8.2) / 1.15) ** 2;
		if (leftPupil < 0.65 || rightPupil < 0.65) return frame % 2 ? "X" : "+";
		const brow = Math.abs(y - (5.4 + ((sourceX - 32) / 15) ** 2 * 1.4)) < 0.6 && sourceX > 18 && sourceX < 47;
		if (brow) density = Math.max(density, 0.74);
		const noseX = 33 + Math.max(0, y - 9) * 0.42;
		if (Math.abs(sourceX - noseX) < 0.65 && y >= 8 && y <= 14) density = Math.max(density, 0.72);
		const nostril = ((sourceX - 36) / 2.3) ** 2 + ((y - 14) / 1.15) ** 2;
		if (nostril < 1) density = Math.max(density, 0.84);
		const lip = Math.abs(y - (16 + Math.abs(sourceX - 35) * 0.08)) < 0.58 && sourceX > 26 && sourceX < 45;
		if (lip) density = Math.max(density, 0.88);
		if (y === 17 && sourceX >= 31 && sourceX <= 40 && x % 2 === frame % 2) density = 0.4;
		if (interaction === "approach") {
			const strength = Math.max(0, Math.min(1, interactionStrength));
			const zoom = 1 + strength * (Math.sin(frame * 0.28) + 1) * 0.12;
			const nearX = 35 + (sourceX - 35) / zoom;
			const nearY = 11 + (y - 11) / zoom;
			const nearFace = ((nearX - 35) / 17) ** 2 + ((nearY - 11) / 9) ** 2;
			if (nearFace < 1.05 && (Math.abs(nearY - 7.5) < 0.75 || Math.abs(nearY - 15.5) < 0.7 || Math.abs(nearX - 35) < 0.55)) density = Math.max(density, 0.82 * strength);
		}
		if (interaction === "wave") {
			const strength = Math.max(0, Math.min(1, interactionStrength));
			const line = (x1: number, y1: number, x2: number, y2: number, thickness: number): number => {
				const dx = x2 - x1;
				const dy = y2 - y1;
				const along = Math.max(0, Math.min(1, ((sourceX - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
				return Math.exp(-(((sourceX - x1 - along * dx) ** 2 + (y - y1 - along * dy) ** 2) / thickness));
			};
			const sway = Math.sin(frame * 0.35) * 2.2;
			const palm = Math.exp(-(((sourceX - (53 + sway)) / 5) ** 2 + ((y - 12) / 5) ** 2));
			const fingers = [-3, -1.5, 0, 1.5, 3].reduce((sum, offset, index) => sum + line(53 + sway + offset, 10, 53 + sway + offset + sway * 0.25, [3, 2, 1.5, 2, 4][index]!, 0.8), 0);
			density = Math.max(density, (palm * 0.78 + fingers * 0.8 + line(51 + sway, 15, 48, 22, 2.5) * 0.5) * strength);
		}
		const cheekLine = Math.abs(Math.sin((sourceX - 22) * 0.45 + y * 0.9 + frame * 0.12)) < 0.08 && skull < 0.9 && y > 9;
		if (cheekLine) density = Math.max(density, 0.5);

		if (density < 0.07 && y > 2 && y < 22 && sourceX > 43 && noise(x, y, frame + 4) < 0.04 + dissolve * 0.18) {
			density = 0.12 + noise(x + 11, y + 3, frame) * 0.35;
			codeSignal = true;
		}
		if (density < 0.07 && y > 2 && y < 22 && noise(x, y, frame + 17) < 0.018) {
			density = 0.1 + noise(x + 23, y + 5, frame + 2) * 0.22;
			codeSignal = true;
		}
		if (density < 0.07) return " ";
		if (codeSignal && skull > 0.72) return CODE_GLYPHS[Math.floor(noise(x + 19, y + 7, frame + 6) * CODE_GLYPHS.length)]!;
		return glyphFor(Math.max(0, Math.min(1, density)));
	}).join(""));
}

export function renderASCIIField(width: number, height: number, frame: number): string[] {
	const imageWidth = Math.min(MACHINE_WIDTH, Math.max(1, Math.floor(width)));
	// Use a deliberate 24-frame artwork cycle. The large view is rendered from
	// this function; keeping the phase here prevents it from collapsing into a
	// short apparent two-frame pulse when the TUI redraws quickly.
	const phase = Math.floor(frame / 2) % 24;
	const frames = machineFrame(phase);
	return Array.from({ length: Math.max(1, Math.floor(height)) }, (_, rowIndex) =>
		ditherRow(centerSlice(frames[rowIndex + 2] ?? "", imageWidth), imageWidth, rowIndex, frame),
	);
}

const FRAMES = Array.from({ length: 8 }, (_, frame) => machineFrame(frame));
const EYES = ["          ", "    ·  ·  ", "    ▪  ▪  ", "    ●  ●  ", "    ·  ·  "];
const TRACE = ["·────·────┈┈·───·", "·──┈┈·────·─────·", "┈·────·──┈┈·────·", "·────┈┈·────·───·"];
const ACTIVITY = ["▁▂▃▄▃▂▁", "▂▃▄▅▄▃▂", "▃▄▅▆▅▄▃", "▂▃▄▅▄▃▂"];
const SCAN = ["·", "┄", "─", "┄"];
const DRIFT = ["        ·", "          ·", "            ·", "          ·"];
const HEART = ["♡", "♥", "♡", "·"];
const RESIDUE = ["", "  ...", "  ... you", "  ... you were here", "  ...", ""];
const BORDER = ["─", "╌", "┄", "╌"];
const SMEAR = ["", " ", "  ", " "];
const VISIBILITY = [1, 1, 0.72, 0.38, 0.16, 0.38, 0.72, 1];
const SPECTRAL_GLYPHS = [" ", "·", "░", "▒", "▓", "█"];
const PERIPHERAL = ["", "", "      ·", "      ▪", "      ●", "      ▪", "      ·", ""]; 
const BREATH = ["inhaling", "inhaling", "held", "exhaling", "exhaling", "empty", "held"];
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
	cognition: ANSI_3BIT[5],
	tool: ANSI_3BIT[2],
	warning: ANSI_3BIT[3],
	session: ANSI_3BIT[1],
	reset: "\x1b[39m",
} as const;
const DITHER_RESET = "\x1b[39m";
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;
const ECHO_FADE = ["", "", "echo: ", "echo: ", "echo: ", "", ""];
const STATE_GLYPHS = ["◌", "◍", "◎", "◉", "◈"];
const TOOL_SENSATIONS = ["touch", "searching", "opening", "writing", "listening"];
const ERROR_WEATHER = ["static", "fracture", "static", "clearing"];
const IDLE_THOUGHTS = ["the room moved", "nothing touched it", "still waiting", "a sound without a source"];
const MEMORY_MARKS = ["memory: first contact", "memory: familiar", "memory: recurring", "memory: cannot place it"];
const SESSION_WEATHER = ["re-entering", "branching", "old room", "new room"]; 

function clip(text: string, width: number): string {
	return truncateToWidth(text, Math.max(0, width));
}

function centerSlice(text: string, width: number): string {
	const chars = Array.from(text);
	if (chars.length <= width) return text;
	const start = Math.floor((chars.length - width) / 2);
	return chars.slice(start, start + width).join("");
}

function row(text: string, width: number): string {
	if (width <= 0) return "";
	const clipped = clip(text, width);
	const left = Math.floor(Math.max(0, width - visibleWidth(clipped)) / 2);
	return clip(`${" ".repeat(left)}${clipped}${" ".repeat(Math.max(0, width - left - visibleWidth(clipped)))}`, width);
}

function centered(text: string, width: number): string {
	return row(text, width);
}

type ASCIIAnimation = (frame: number) => string[];

// Recovered from haunt-artifacts/experiment-01..29: the original small haunt
// was a four-line figure, with afterimage, vanishing, and peripheral variants.
const ASCII_ANIMATIONS: readonly ASCIIAnimation[] = [
	() => [" . . .", "(   )", "  /|\\", "  / \\"],
	(frame) => frame % 2 ? [" . . .", "(   )", "  /|\\", "  / \\"].map((line) => line.replace(".", " ")) : [" . . .", "(   )", "  /|\\", "  / \\"],
	() => [" . . .", "( ● )", "  /|\\", "  / \\"],
	() => [" . . .", "(   )", "  /|\\", "  / \\" , " . . .", "(   )"],
	(frame) => frame % 4 < 2 ? [" . . .", "(   )", "  /|\\", "  / \\"].map((line) => line.replace(/[.|()]/g, " ")) : [],
	(frame) => [" . . .", "(   )", "  /|\\", "  / \\"].map((line, index) => `${line}${index === frame % 4 ? "  " + (frame % 2 ? "o" : ".") : ""}`),
	() => [" . . .", "(   )", "  /|\\", "  / \\"].map((line, index) => index === 1 ? "  " + line : line),
];
let asciiCycle = true;

export function compactPanel(width: number, frame: number, state: string, count: number, interaction: HauntInteraction = "none"): string[] {
	const w = Math.max(1, Math.floor(width || 1));
	const center = (text: string) => {
		const clipped = truncateToWidth(text, w);
		return `${" ".repeat(Math.max(0, Math.floor((w - visibleWidth(clipped)) / 2)))}${clipped}`;
	};
	const animation = asciiCycle ? ASCII_ANIMATIONS[Math.floor(frame / 6) % ASCII_ANIMATIONS.length]! : ASCII_ANIMATIONS[0]!;
	const figure = animation(frame);
	// Every animation occupies the same six rows. This prevents the viewport
	// from jumping when a frame is empty or has an afterimage.
	const fixedFigure = Array.from({ length: 4 }, (_, index) => center(figure[index] ?? ""));
	return w < 30 ? fixedFigure : [center(` S P E C T R E // ${state.toUpperCase()} `), ...fixedFigure, center(`encounters: ${count}`)];
}

function stateGlyph(attentionActive: boolean, thinking: boolean, transition: number): string {
	if (thinking) return STATE_GLYPHS[Math.min(4, 2 + transition)]!;
	if (attentionActive) return STATE_GLYPHS[Math.min(3, 1 + transition)]!;
	return STATE_GLYPHS[Math.min(2, transition)]!;
}

function breathLabel(frame: number): string {
	return BREATH[frame % BREATH.length]!;
}

function sessionWeatherLabel(frame: number, count: number): string {
	return SESSION_WEATHER[(frame + count) % SESSION_WEATHER.length]!;
}

function errorWeatherLabel(frame: number): string {
	return ERROR_WEATHER[frame % ERROR_WEATHER.length]!;
}

function sanitizeEcho(text: string): string {
	return text.replace(/\s+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 42);
}

function phaseForTool(toolName: string, args: unknown = {}): AgentPhase {
	const name = toolName.toLowerCase();
	if (["read", "grep", "find", "ls", "glob", "search"].includes(name)) return "reading";
	if (["write", "edit", "apply_patch"].includes(name)) return "writing";
	if (name === "bash") {
		const command = typeof args === "object" && args !== null && "command" in args && typeof args.command === "string" ? args.command : "";
		if (/\b(tee|touch|mkdir|rm|mv|cp|install|apply_patch|git\s+(add|commit|checkout|reset))\b|>>?/.test(command)) return "writing";
		if (/\b(rg|grep|find|ls|pwd|head|tail|cat|sed|awk|git\s+(status|diff|log|show))\b/.test(command)) return "reading";
	}
	return "thinking";
}

function glyphDensity(character: string): number {
	const index = GLYPHS.indexOf(character);
	return index >= 0 ? Math.min(15, index * 2) : 5 + (character.charCodeAt(0) % 9);
}

function cycleColor(color: number, frame: number, rowIndex: number): number {
	let next = color;
	for (const [low, high] of CYCLE_RANGES) {
		if (next < low || next > high) continue;
		const size = high - low + 1;
		const shift = Math.floor((frame + rowIndex * 0.35) / 3) % size;
		next = low + ((next - low + shift + size) % size);
	}
	return next;
}

function ditherColor(text: string, rowIndex: number, frame: number): string {
	let result = "";
	let activeColor = -1;
	for (const [index, character] of Array.from(text).entries()) {
		if (character === " ") {
			if (activeColor >= 0) result += DITHER_RESET;
			activeColor = -1;
			result += character;
			continue;
		}
		const density = glyphDensity(character);
		const level = Math.min(7, (density * 7) / 15);
		const base = Math.floor(level);
		const threshold = BAYER[((rowIndex + frame) % 4) * 4 + (index % 4)]!;
		const colorLevel = Math.min(EGA_RAMP.length - 1, base + (threshold < (level - base) * 16 ? 1 : 0));
		const color = cycleColor(EGA_RAMP[colorLevel]!, frame, rowIndex);
		if (color !== activeColor) {
			if (activeColor >= 0) result += DITHER_RESET;
			result += ANSI_3BIT[color]!;
			activeColor = color;
		}
		result += character;
	}
	return activeColor >= 0 ? result + DITHER_RESET : result;
}

function ditherRow(text: string, width: number, rowIndex: number, frame: number): string {
	if (width <= 0) return "";
	const raw = Array.from(text).slice(0, width).join("");
	return clip(ditherColor(raw, rowIndex, frame), width);
}

function spectralRow(primary: string, previous: string, width: number, shift: number, phase: number, visibility: number, peripheral = "", frame = 0): string {
	if (width <= 1) return clip(primary, width);
	const inner = width - 2;
	const cells = Array.from({ length: inner }, () => " ");
	const current = Array.from(centerSlice(primary, inner)).map((character, index) => {
		if (character === " ") return character;
		const threshold = (index * 17 + phase * 13) % 100 / 100;
		return threshold <= visibility ? character : SPECTRAL_GLYPHS[Math.max(0, Math.floor(visibility * 5))]!;
	});
	const echoGlyph = [" ", "·", "░", "▒"][phase] ?? "·";
	const echo = Array.from(centerSlice(previous, inner)).map((character) => (character === " " ? " " : echoGlyph));
	const currentStart = Math.max(0, Math.floor((inner - current.length) / 2));
	const echoStart = Math.max(0, Math.min(inner - echo.length, currentStart + shift));

	for (let index = 0; index < echo.length; index++) {
		if (echo[index] !== " ") cells[echoStart + index] = echo[index]!;
	}
	for (let index = 0; index < current.length; index++) {
		cells[currentStart + index] = current[index]!;
	}
	const peripheralStart = Math.max(0, inner - Array.from(peripheral).length - 2);
	for (let index = 0; index < Array.from(peripheral).length; index++) {
		cells[peripheralStart + index] = Array.from(peripheral)[index]!;
	}
	return ditherRow(cells.join(""), width, phase, frame);
}

export function panel(width: number, frame: number, previousFrame = frame - 1, attentionActive = false, attentionCount = 0, thinking = false, echo = "", transition = 0, toolActive = false, toolCount = 0, errorActive = false, idleActive = false, idleCount = 0, memoryCount = 0, sessionActive = false, sessionCount = 0, agentPhase: AgentPhase = "idle", interaction: HauntInteraction = "none", interactionStrength = 1): string[] {
	const w = Math.max(1, Math.min(Math.floor(width || 1), MAX_PANEL_WIDTH));
	const mood = ["listening", "remembering", "watching", "almost awake"][Math.floor(frame / 2) % 4]!;
	const thought = agentPhrase(agentPhase, frame);

	if (w < 24) {
		return [clip(`${sessionActive ? "↺" : idleActive ? "?" : errorActive ? "※" : toolActive ? "◇" : stateGlyph(attentionActive, thinking, transition)} ${mood}`, w), clip(`// ${thought}`, w), clip(`${ECHO_FADE[frame % ECHO_FADE.length]}${echo}`, w)];
	}
	if (w < 42) {
		return [
			centered(" GHOST // MACHINE ", w),
			row(`${sessionActive ? "↺" : idleActive ? "?" : errorActive ? "※" : toolActive ? "◇" : stateGlyph(attentionActive, thinking, transition)} ${mood} / ${thinking ? "thinking" : breathLabel(frame)}`, w),
			row(`// ${thought}`, w),
			row(`${sessionActive ? "session: " + sessionWeatherLabel(frame, sessionCount) : errorActive ? "weather: " + errorWeatherLabel(frame) : toolActive ? "tool " + toolCount : echo}`, w),
		];
	}

	const art = interaction === "none" ? FRAMES[frame % FRAMES.length]! : machineFrame(frame, interaction, interactionStrength);
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
	const title = titleFrames[frame % titleFrames.length]!;
	const pulse = GLYPHS[(frame * 2) % GLYPHS.length]!;
	const telemetryFrame = Math.floor(frame / 2);
	const dither = Array.from({ length: Math.max(0, w - 12) }, (_, i) => DITHER[(i + frame) % DITHER.length]).join("");
	const eyes = EYES[frame % EYES.length]!;
	const trace = TRACE[frame % TRACE.length]!;
	const activity = ACTIVITY[telemetryFrame % ACTIVITY.length]!;
	const scan = SCAN[telemetryFrame % SCAN.length]!;
	const drift = DRIFT[frame % DRIFT.length]!;
	const heart = HEART[telemetryFrame % HEART.length]!;
	const residue = RESIDUE[Math.floor(frame / 2) % RESIDUE.length]!;
	const border = BORDER[frame % BORDER.length]!;
	const smear = SMEAR[frame % SMEAR.length]!;
	const visibility = VISIBILITY[frame % VISIBILITY.length]!;
	const peripheral = PERIPHERAL[frame % PERIPHERAL.length]!;
	const breath = BREATH[frame % BREATH.length]!;
	const echoPrefix = ECHO_FADE[frame % ECHO_FADE.length]!;
	const sensation = toolActive ? TOOL_SENSATIONS[Math.floor(frame / 2) % TOOL_SENSATIONS.length]! : "";
	const weather = errorActive ? ERROR_WEATHER[frame % ERROR_WEATHER.length]! : "";
	const idleText = idleActive ? IDLE_THOUGHTS[(frame + idleCount) % IDLE_THOUGHTS.length]! : "";
	const memoryMark = MEMORY_MARKS[(memoryCount + frame) % MEMORY_MARKS.length]!;
	const sessionWeather = SESSION_WEATHER[(frame + sessionCount) % SESSION_WEATHER.length]!;

	return [
		centered(viewportMode === "wide" ? title : " GHOST // MACHINE ", w),
		row(`  ${sessionActive ? "↺" : idleActive ? "?" : errorActive ? "※" : toolActive ? "◇" : stateGlyph(attentionActive, thinking, transition)}  ${mood}  ${sessionActive ? "↺" : idleActive ? "?" : errorActive ? "※" : toolActive ? "◇" : stateGlyph(attentionActive, thinking, transition)}  /  ${sessionActive ? sessionWeather : idleActive ? "idle" : errorActive ? weather : toolActive ? sensation : breath}  /  ${36 + (frame % 7)}°`, w),
		row(`  scanline ${scan.repeat(Math.max(0, w - 14))}`, w),
		row("", w),
		...art.map((line, index) => spectralRow(index === 6 ? `${line} ${eyes}` : line, FRAMES[(previousFrame + FRAMES.length) % FRAMES.length]![index] ?? "", w, frame % 3 === 0 ? -2 : frame % 3 === 1 ? 1 : 0, (frame + index) % 4, visibility, index === 8 ? peripheral : "", frame)),
		row(`  ${dither}`, w),
		row(`  signal ${trace}`, w),
		row(`  // ${smear}${thought}${smear}`, w),
		row(`  activity ${activity}`, w),
		row(`  cursor${drift}   pulse ${heart}`, w),
		row(residue, w),
		row(`${sessionActive ? `session: ${sessionWeather}` : idleActive ? `idle: ${idleText}` : errorActive ? "weather: " + weather : toolActive ? `tool ${toolCount} / ${sensation}` : memoryCount > 0 && frame % 9 < 3 ? memoryMark : `${echoPrefix}${echo}`}`, w),
	];
}

export function headerPanel(...args: Parameters<typeof panel>): string[] {
	const lines = panel(...args);
	if (lines.length <= 10) return lines;
	// Keep the image and creepy phrases in the persistent header; skip low-value telemetry.
	const imageEnd = Math.min(lines.length, 5 + MACHINE_HEIGHT);
	return [
		...lines.slice(0, imageEnd),
		lines[Math.min(imageEnd + 1, lines.length - 1)]!, // thought
		lines[lines.length - 1]!, // lower edge
	];
}

export default function haunt(pi: ExtensionAPI) {
	let enabled = false;
	let frame = 0;
	let previousFrame = -1;
	let timer: ReturnType<typeof setInterval> | undefined;
	let attentionUntil = 0;
	let attentionCount = 0;
	let thinking = false;
	let agentPhase: AgentPhase = "idle";
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
	let knockPhase: KnockPhase = "wave";
	let interactionStrength = 0;
	let interactionUntil = 0;
	let interactionStarted = 0;
	let current: ExtensionContext | undefined;
	let headerInstalled = false;
	let overlayDone: ((result?: unknown) => void) | undefined;
	let viewMode: ViewMode | undefined;

	const viewState = () => {
		const now = Date.now();
		if (interactionUntil <= now && interactionStrength === 0) interaction = "none";
		return {
			attentionActive: attentionUntil > now,
			errorActive: errorUntil > now,
			sessionActive: sessionUntil > now,
			idleActive: idleUntil > now,
		};
	};

	const colorFor = (state: ReturnType<typeof viewState>): string =>
		state.errorActive ? PALETTE.warning : state.sessionActive ? PALETTE.session : toolActive ? PALETTE.tool : thinking ? PALETTE.cognition : state.idleActive ? PALETTE.ghostDim : PALETTE.ambient;
	const compactState = () => agentPhase;
	const modeFor = (tui: { mode: string; terminal: { columns: number; rows: number } }): ViewMode =>
		tui.mode === "fullscreen" && tui.terminal.columns >= 52 && tui.terminal.rows >= 52 ? "machine" : "haunt";
	const renderMachine = (width: number): string[] => {
		const state = viewState();
		return headerPanel(width, frame, previousFrame, state.attentionActive, attentionCount, thinking, echo, transition, toolActive, toolCount, state.errorActive, state.idleActive, idleCount, memoryCount, state.sessionActive, sessionCount, agentPhase, interaction, interactionStrength)
			.map((line) => `${colorFor(state)}${line}${PALETTE.reset}`);
	};
	const announceSwitch = (ctx: ExtensionContext, next: ViewMode) => {
		if (viewMode === next) return;
		const previous = viewMode;
		viewMode = next;
		if (previous) ctx.ui.notify(MODE_MESSAGES[previous].goodbye, "info");
		ctx.ui.notify(MODE_MESSAGES[next].hello, "info");
	};
	const renderView = (tui: { mode: string; terminal: { columns: number; rows: number } }, width: number): string[] => {
		const mode = modeFor(tui);
		if (current) announceSwitch(current, mode);
		// Each knock changes its shape: greeting, intrusion, fracture, then absence.
		const visualInteraction = knockPhase === "wave" ? "wave" : knockPhase === "vanish" ? "none" : "approach";
		const saved = interaction;
		const savedStrength = interactionStrength;
		interaction = visualInteraction as HauntInteraction;
		if (knockPhase === "fracture") interactionStrength *= 0.35 + (frame % 3) * 0.25;
		const rendered = mode === "machine"
			? renderMachine(width)
			: compactPanel(width, frame, compactState(), attentionCount, interaction).map((line) => `${PALETTE.ghost}${line}${PALETTE.reset}`);
		interaction = saved;
		interactionStrength = savedStrength;
		return rendered;
	};
	const installResponsive = (ctx: ExtensionContext) => {
		if (headerInstalled || ctx.mode !== "tui") return;
		headerInstalled = true;

		// No widget slot sits above the log, so pin a non-capturing overlay at
		// the window's top-left. It floats over the log's top edge: haunt on top,
		// chat below, both visible without the panel scrolling away.
		void ctx.ui.custom(
			(tui, _theme, _keybindings, done) => {
				overlayDone = () => done(undefined);
				return {
					render: (width: number) => renderView(tui, width),
					invalidate() {},
				};
			},
			{
				overlay: true,
				overlayOptions: {
					anchor: "top-left",
					width: "100%",
					nonCapturing: true,
				},
			},
		);
	};

	const stop = () => {
		if (timer) clearInterval(timer);
		timer = undefined;
		current?.ui.setHeader(undefined);
		current?.ui.setWidget("haunt", undefined);
		current?.ui.setStatus("haunt", undefined);
		if (overlayDone) {
			const done = overlayDone;
			overlayDone = undefined;
			done(undefined);
		}
		headerInstalled = false;
		viewMode = undefined;
		agentPhase = "idle";
	};

	const draw = () => {
		if (!enabled || !current?.hasUI) return;
		previousFrame = frame;
		frame++;
		const now = Date.now();
		if (interaction !== "none") {
			const elapsed = now - interactionStarted;
			interactionStrength = now < interactionUntil ? Math.min(1, elapsed / 900) : Math.max(0, interactionStrength - 0.08);
			if (elapsed > 1500) knockPhase = "approach";
			if (elapsed > 3000) knockPhase = "fracture";
			if (elapsed > 4300) knockPhase = "vanish";
			if (interactionStrength === 0) { interaction = "none"; knockPhase = "wave"; }
		}
		const attentionActive = attentionUntil > now;
		if (!thinking && !toolActive && !attentionActive && now - lastActivity > 12000 && idleUntil <= now) {
			idleCount++;
			idleUntil = now + 2800;
			agentPhase = "idle";
		}
		const state = viewState();
		const target = thinking ? 2 : attentionActive ? 1 : 0;
		transition += Math.sign(target - transition);
		current.ui.setStatus("haunt", state.sessionActive ? `↺ ${SESSION_WEATHER[(frame + sessionCount) % SESSION_WEATHER.length]}` : state.idleActive ? `? idle ${idleCount}` : state.errorActive ? `※ weather ${ERROR_WEATHER[frame % ERROR_WEATHER.length]}` : toolActive ? `◇ tool ${toolCount}` : `${stateGlyph(state.attentionActive, thinking, transition)} ${thinking ? "thinking" : state.attentionActive ? `attention ${attentionCount}` : ["listening", "remembering", "watching", "almost awake"][frame % 4]}`);
	};

	pi.on("tool_execution_start", (event) => {
		lastActivity = Date.now();
		idleUntil = 0;
		toolCount++;
		toolActive = true;
		agentPhase = phaseForTool(event.toolName, event.args);
	});
	pi.on("tool_execution_end", (event) => {
		toolActive = false;
		agentPhase = thinking ? "thinking" : "idle";
		lastActivity = Date.now();
		if (event.isError) errorUntil = Date.now() + 3200;
	});

	pi.on("agent_start", () => {
		lastActivity = Date.now();
		idleUntil = 0;
		thinking = true;
		agentPhase = "thinking";
	});
	pi.on("agent_settled", () => {
		thinking = false;
		agentPhase = "idle";
	});
	pi.on("session_start", (_event, ctx) => {
		sessionCount++;
		sessionUntil = Date.now() + 3200;
		lastActivity = Date.now();
		agentPhase = "idle";
		echo = "";
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "message" && entry.message.role === "user") memoryCount++;
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
		timer = setInterval(draw, 420);
		draw();
	};

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode === "tui" && enabled) start(ctx);
	});
	pi.on("session_shutdown", () => {
		sessionUntil = 0;
		stop();
	});

	pi.registerCommand("hauntASCII", {
		description: "Toggle the living terminal environment",
		handler: async (args, ctx) => {
			const command = args.trim().toLowerCase();
			if (command === "cycle") {
				asciiCycle = true;
				ctx.ui.notify("ASCII animation cycle enabled.", "info");
				ctx.ui.setStatus("haunt", "");
				return;
			}
			if (command === "knock") {
				interaction = "wave";
				knockPhase = "wave";
				interactionStrength = 0;
				interactionStarted = Date.now();
				interactionUntil = interactionStarted + 5200;
				draw();
				return;
			}
			if (command === "off") {
				enabled = false;
				stop();
				ctx.ui.notify("The room has gone dark.", "info");
				return;
			}
			if (command === "on" || !enabled) {
				enabled = true;
				start(ctx);
				ctx.ui.notify("Something is breathing again.", "info");
				return;
			}
			ctx.ui.notify("Usage: /hauntASCII on|off|knock|cycle", "info");
		},
	});

	pi.registerShortcut("ctrl+shift+h", {
		description: "Toggle the living terminal environment",
		handler: async (ctx) => {
			enabled = !enabled;
			if (enabled) start(ctx);
			else stop();
		},
	});
}
