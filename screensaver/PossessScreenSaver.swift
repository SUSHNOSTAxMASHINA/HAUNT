import ScreenSaver
import AppKit
import CoreText

// one colour sample for the field.
private struct RGB {
    var r: Double
    var g: Double
    var b: Double
}

// one glyph, waiting in colour.
private struct Cell {
    var glyph: String
    var ansi: Int
    var bright: Bool = false
    var foreground: NSColor?
}

// motion and ink for one state.
private struct Profile {
    var speed: Double
    var breath: Double
    var noise: Double
    var ink: [RGB]
}

// the glass where the field remains.
final class PossessView: ScreenSaverView {
    private let ansi: [NSColor] = [
        .black, .red, .green, .brown, .blue, .magenta, .cyan, .lightGray,
        .darkGray, .systemRed, .systemGreen, .yellow, .systemBlue, .systemPink, .systemTeal, .white
    ]
    private let glyphs = Array(" .·:;+=xX#%@0123456789abcdef")
    private let brailleDots: [(Int, Int, UInt8)] = [
        (0, 0, 0x01), (0, 1, 0x02), (0, 2, 0x04), (1, 0, 0x08),
        (1, 1, 0x10), (1, 2, 0x20), (0, 3, 0x40), (1, 3, 0x80)
    ]
    private let bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
    private let states = ["waiting", "writing", "thinking"]
    private let whispers = ["шёпот", "НЕ СМОТРИ", "VOID", "h̷u̷s̷h̷", "помни", "[REDACTED]", "не здесь", "E̸C̸H̸O̸"]
    private let thoughts = [
        "the room is holding its breath", "nothing moved, then something did",
        "I remain in the idle channel", "the silence is rendering",
        "I am leaving something in the output", "the next line is not mine alone",
        "watch the characters form a mouth", "your terminal is learning to speak",
        "weights moving under the surface", "the answer is growing a second answer",
        "I am sorting the living noise", "context has a pulse"
    ]
    // the three states beneath the full window.
    private let profiles: [Profile] = [
        Profile(speed: 0.48, breath: 0.11, noise: 0.26, ink: [RGB(r: 91, g: 112, b: 232), RGB(r: 182, g: 82, b: 210), RGB(r: 49, g: 180, b: 207)]),
        Profile(speed: 1.90, breath: 0.06, noise: 0.82, ink: [RGB(r: 43, g: 244, b: 238), RGB(r: 243, g: 47, b: 153), RGB(r: 154, g: 255, b: 72)]),
        Profile(speed: 1.55, breath: 0.085, noise: 1.0, ink: [RGB(r: 243, g: 44, b: 181), RGB(r: 95, g: 126, b: 255), RGB(r: 236, g: 220, b: 155)])
    ]
    private var font = NSFont.monospacedSystemFont(ofSize: 10, weight: .regular)
    private var tick = 0
    private var animationState = 0       // the motion beneath the image
    private var paletteState = 0         // the ink beneath the image
    private var textPaletteState = 0     // the words at the edge
    private var knockKind: Int?          // one answer to one knock
    private var knockAge = 0

    override init?(frame: NSRect, isPreview: Bool) {
        super.init(frame: frame, isPreview: isPreview)
        animationTimeInterval = 0.42
        loadHack()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        animationTimeInterval = 0.42
        loadHack()
    }

    // keep the cells in the same shape.
    private func loadHack() {
        guard let url = Bundle(for: type(of: self)).url(forResource: "Hack-Regular", withExtension: "ttf") else { return }
        CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        font = NSFont(name: "Hack Regular", size: 10) ?? font
    }

    override var hasConfigureSheet: Bool { false }
    override func startAnimation() { super.startAnimation(); needsDisplay = true }

    // let motion, ink, words, and knocks drift apart.
    override func animateOneFrame() {
        tick &+= 1
        // each channel may change once in a while.
        let odds = 0.42 / 60.0
        if Double.random(in: 0..<1) < odds { animationState = Int.random(in: 0..<states.count) }
        if Double.random(in: 0..<1) < odds { paletteState = Int.random(in: 0..<states.count) }
        if Double.random(in: 0..<1) < odds { textPaletteState = Int.random(in: 0..<states.count) }
        if knockKind == nil && Double.random(in: 0..<1) < odds {
            knockKind = Int.random(in: 0..<12)
            knockAge = 0
        }
        if knockKind != nil {
            knockAge += 1
            if knockAge > 12 { knockKind = nil; knockAge = 0 }
        }
        needsDisplay = true
    }

    // paint the field, its whispers, and what remains.
    override func draw(_ rect: NSRect) {
        NSColor.black.setFill()
        rect.fill()

        let attributes: [NSAttributedString.Key: Any] = [.font: font]
        let cellWidth = max(1, font.maximumAdvancement.width)
        let cellHeight = max(12, font.boundingRectForFont.height + 2)
        let columns = max(1, Int(bounds.width / cellWidth))
        // leave room where the glass is cut away.
        let hasNotch = (window?.screen?.safeAreaInsets.top ?? 0) > 0
        let notchClearance: CGFloat = hasNotch ? 46 : 0
        let safeTop = max(notchClearance, safeAreaInsets.top)
        let safeBottom = max(0, safeAreaInsets.bottom)
        let usableHeight = max(cellHeight, bounds.height - safeTop - safeBottom)
        let rows = max(1, Int(usableHeight / cellHeight))
        let fieldRows = max(1, rows - 8)
        let animationProfile = profiles[animationState]
        let paletteProfile = profiles[paletteState]
        let title = " GHOST // MACHINE "
        let mood = ["listening", "remembering", "watching", "almost awake"][(tick / 2) % 4]
        let thought = thoughts[(tick / 3 + animationState) % thoughts.count]
        let textColor = textAnsi(for: textPaletteState)
        let textNSColor = self.textColor(for: textPaletteState)
        activeTextColor = textNSColor
        let time = DateFormatter.possessTime()
        let date = DateFormatter.possessDate()
        let scan = ["·", "┄", "─", "┄"][((tick / 2) % 4)]
        let trace = ["·────·────┈┈·───·", "·──┈┈·────·─────·", "┈·────·──┈┈·────·", "·────┈┈·────·───·"][(tick % 4)]
        var output: [[Cell]] = []
        output.append(centered(title, width: columns, ansi: textColor, bright: true))
        output.append(centered("◌  \(mood)  /  \(time)  /  \(date)", width: columns, ansi: textColor))
        output.append(centered(String(repeating: scan, count: max(0, columns - 14)), width: columns, ansi: textColor))
        for row in 0..<fieldRows {
            var cells = fieldRow(width: columns, height: fieldRows, row: row, animation: animationProfile, palette: paletteProfile)
            // no commands reach this room. one broken word still surfaces.
            let whisper = whispers[(tick / 3) % whispers.count]
            let whisperRow = (tick / 5) % fieldRows
            if row == whisperRow {
                let word = Array(glitched(whisper))
                let start = max(0, min(columns - word.count, (tick * 7) % max(1, columns - word.count + 1)))
                for (index, character) in word.enumerated() where start + index < cells.count {
                    cells[start + index] = Cell(glyph: String(character), ansi: textColor, bright: true, foreground: textNSColor)
                }
            }
            output.append(centered(cells, width: columns, ansi: textColor))
        }
        output.append(centered("// \(thought) \\\\", width: columns, ansi: textColor))
        output.append(centered(states[textPaletteState], width: columns, ansi: textColor))
        // leave the residue between the word and the trace.
        let residue = ["", "  ...", "  ... you", "  ... you were here", "  ...", ""][((tick / 2) % 6)]
        output.append(centered(residue, width: columns, ansi: textColor))
        output.append(centered("  \(trace)", width: columns, ansi: textColor))

        for (row, cells) in output.enumerated() {
            draw(cells, row: row, topInset: safeTop, cellWidth: cellWidth, cellHeight: cellHeight, attributes: attributes)
        }
    }

    private var activeTextColor: NSColor = .blue

    // give each word-state its colour.
    private func textColor(for state: Int) -> NSColor {
        switch state {
        case 1: return NSColor(calibratedRed: 0.0, green: 0.8, blue: 0.8, alpha: 1)
        case 2: return NSColor(calibratedRed: 0.8, green: 0.0, blue: 0.8, alpha: 1)
        default: return NSColor(calibratedRed: 0.25, green: 0.25, blue: 0.85, alpha: 1)
        }
    }

    // keep a dim fallback for the old signal.
    private func textAnsi(for state: Int) -> Int {
        switch state {
        case 1: return 6 // writing: cyan
        case 2: return 5 // thinking: magenta
        default: return 4 // waiting: blue
        }
    }

    // let a few letters forget themselves.
    private func glitched(_ text: String) -> String {
        let marks = Array("░▒▓█·╳")
        return String(Array(text).enumerated().map { index, character in
            guard character != " ", (tick + index * 7) % 13 < 2 else { return character }
            return marks[(tick + index) % marks.count]
        })
    }

    // pack the field into braille cells.
    private func fieldRow(width: Int, height: Int, row: Int, animation: Profile, palette: Profile) -> [Cell] {
        var result: [Cell] = []
        for column in 0..<width {
            var mask: UInt8 = 0
            var samples: [RGB] = []
            for (dx, dy, bit) in brailleDots {
                let px = column * 2 + dx
                let py = row * 4 + dy
                let sample = pixel(px: px, py: py, width: width * 2, height: height * 4, animation: animation, palette: palette)
                let ditherPhase = Double(tick)
                let ditherX = Int(floor(ditherPhase / 6))
                let ditherY = Int(floor(ditherPhase / 4))
                let ditherIndex = ((py + ditherY) & 3) * 4 + ((px + ditherX) & 3)
                let ditherNext = ((py + ditherY) & 3) * 4 + ((px + ditherX + 1) & 3)
                let amount = ditherPhase - floor(ditherPhase)
                let dither = Double(bayer[ditherIndex]) + Double(bayer[ditherNext] - bayer[ditherIndex]) * amount
                let threshold = 0.20 + dither / 32
                if sample.density > threshold { mask |= bit; samples.append(sample.color) }
            }
            if mask == 0 {
                result.append(Cell(glyph: " ", ansi: 7))
            } else {
                let count = Double(max(1, samples.count))
                let red = samples.reduce(0) { $0 + $1.r } / count
                let green = samples.reduce(0) { $0 + $1.g } / count
                let blue = samples.reduce(0) { $0 + $1.b } / count
                result.append(Cell(glyph: String(UnicodeScalar(0x2800 + Int(mask))!), ansi: 7, foreground: NSColor(calibratedRed: CGFloat(red / 255), green: CGFloat(green / 255), blue: CGFloat(blue / 255), alpha: 1)))
            }
        }
        return result
    }

    // shape one pixel from waves, traces, and noise.
    private func pixel(px: Int, py: Int, width: Int, height: Int, animation: Profile, palette: Profile) -> (density: Double, color: RGB) {
        let profile = animation
        let phase = Double(tick) * 0.095 * profile.speed
        let x = (Double(px) + 0.5) / Double(width) * 2 - 1
        let y = (Double(py) + 0.5) / Double(height) * 2 - 1
        let breath = 1 + sin(phase * 0.7) * profile.breath
        let inhale = 1 + sin(phase * 0.31 - 0.8) * profile.breath * 1.6
        let wx = (x - sin(y * 11 + phase * 1.3) * 0.045 * profile.noise) / inhale
        let wy = y / breath
        let envelope = exp(-((wx + 0.08) * (wx + 0.08) / 0.72 + (wy * 0.82) * (wy * 0.82) / 1.2))
        let carrier = exp(-pow(wy - sin(wx * 8 + phase) * 0.18, 2) / 0.038)
        let counter = exp(-pow(wy + 0.36 - sin(wx * 12 - phase * 1.4) * 0.12, 2) / 0.024)
        let memoryPhase = phase - 0.9
        let memoryX = wx + sin(wy * 7 + memoryPhase) * 0.025
        let memoryY = wy - 0.018
        let memoryCarrier = exp(-pow(memoryY - sin(memoryX * 8 + memoryPhase) * 0.18, 2) / 0.05)
        let memory = memoryCarrier * (0.035 + max(0, sin(phase * 0.31 - 0.3)) * 0.045)
        let radius = sqrt(wx * wx + wy * wy)
        let ring = exp(-pow(radius - 0.55 - sin(phase) * 0.025, 2) / 0.018)
        let pulse = exp(-pow(radius - (0.24 + (phase.truncatingRemainder(dividingBy: 6.28)) / 6.28 * 0.58), 2) / 0.012) * 0.22
        let pressure = pow(max(0, sin(phase * 0.31 - 2.4)), 4)
        let breathRing = exp(-pow(radius - (0.72 + pressure * 0.18), 2) / 0.045) * pressure * 0.07
        let eyeGap = 0.3 + sin(phase * 0.53) * 0.035
        let eyeY = -0.18 + sin(phase * 0.61) * 0.025 + sin(phase * 0.23) * 0.012
        let eyeScale = 1 + sin(phase * 0.57) * 0.1
        let leftEye = sqrt(pow((wx + eyeGap) / (0.23 * eyeScale), 2) + pow((wy - eyeY) / 0.105, 2))
        let rightEye = sqrt(pow((wx - eyeGap) / (0.23 * eyeScale), 2) + pow((wy - eyeY - 0.012) / 0.105, 2))
        let blink = pow(max(0, sin(phase * 0.29 + 0.8)), 18)
        let openness = 1 - blink * 0.92
        let eyeRim = (exp(-pow(leftEye - 1, 2) / 0.055) + exp(-pow(rightEye - 1, 2) / 0.055)) * openness
        let eyeVoid = (exp(-leftEye * leftEye / 0.55) + exp(-rightEye * rightEye / 0.55)) * openness
        let mouthY = 0.39 + sin(phase * 0.49) * 0.035
        let mouth = exp(-pow(wy - mouthY - sin(wx * 6 + phase) * 0.025, 2) / 0.018) * exp(-wx * wx / 0.35)
        let jaw = exp(-pow(sqrt(pow(wx / 0.72, 2) + pow((wy - 0.03) / 0.9, 2)) - 0.82, 2) / 0.025)
        let featureMix = 0.22 + (sin(phase * 0.72) + 1) * 0.18
        var density = envelope * (0.13 + carrier * 0.32 + counter * 0.18) + eyeRim * 0.46 * featureMix + mouth * 0.23 * featureMix + jaw * 0.11 * featureMix + ring * 0.12 + pulse * 0.18 + breathRing + memory - eyeVoid * 0.24 * featureMix
        density = max(0, density * (0.7 + 0.3 * sin((Double(py) + Double(tick) * profile.speed * 0.55) * .pi / 3) + sin(wx * 29 + wy * 17 + phase * 2.2) * 0.16 * profile.noise))
        if noise(x: Double(px) * 0.7, y: Double(py) * 0.9, seed: Double(tick) / 3 + 31) < max(0, abs(wx) - 0.58) * (0.08 + profile.noise * 0.05) { density *= 0.3 }
        if sin(wy * 33 + phase * 2.5) > 0.78 && noise(x: Double(px), y: Double(py), seed: Double(tick) / 2) < 0.24 + profile.noise * 0.18 { density *= 0.12 }
        // leave a little dust at the edge.
        if density < 0.08 && noise(x: Double(px) * 0.8, y: Double(py) * 0.7, seed: Double(tick) / 3 + 9) < 0.02 + profile.noise * 0.018 {
            density = 0.12 + noise(x: Double(px + 5), y: Double(py + 2), seed: Double(tick)) * 0.3
        }
        let palettePosition = abs((wx + 1) * 1.8 + sin(wy * 5 + phase) * 1.4 + phase * palette.noise)
        let index = Int(palettePosition) % palette.ink.count
        let blend = palettePosition - floor(palettePosition)
        let a = palette.ink[index]
        let b = palette.ink[(index + 1) % palette.ink.count]
        let brightness = 0.5 + max(0, 1 - abs(wx + 0.35)) * 0.42 + density * 0.42
        let knock = knockDensity(wx: wx, wy: wy, phase: phase)
        return (max(0, min(1, density + knock)), RGB(r: (a.r + (b.r - a.r) * blend) * brightness, g: (a.g + (b.g - a.g) * blend) * brightness, b: (a.b + (b.b - a.b) * blend) * brightness))
    }

    // add the answer to the current knock.
    private func knockDensity(wx: Double, wy: Double, phase: Double) -> Double {
        guard let kind = knockKind else { return 0 }
        let cycle = min(1, Double(knockAge) / 12)
        let strength = min(1, Double(knockAge) / 3) * (1 - max(0, cycle - 0.72) / 0.28)
        let radius = sqrt(wx * wx + wy * wy)
        func ring(_ r: Double, _ width: Double = 0.012) -> Double { exp(-pow(radius - r, 2) / width) }
        func eye(_ x: Double, _ y: Double, _ sx: Double, _ sy: Double) -> Double { exp(-(pow((wx - x) / sx, 2) + pow((wy - y) / sy, 2))) }
        let pulse = exp(-pow(cycle * 13, 2))
        let tremor = sin(phase * 2.7) * 0.025
        var response = 0.0
        switch kind {
        case 0: response = ring(0.08 + cycle * 1.05, 0.01) * (1 - cycle * 0.6) + pulse * 0.5
        case 1: response = (eye(-0.3 + tremor, -0.18, 0.2, 0.07) + eye(0.3 + tremor, -0.18, 0.2, 0.07)) * (0.35 + pulse)
        case 2: response = exp(-pow(wy - tremor, 2) / 0.012) * (0.3 + pulse)
        case 3: response = (ring(0.2 + cycle * 0.8, 0.012) + ring(0.45 + cycle * 0.3, 0.02) * 0.4) * (1 - cycle * 0.45)
        case 4: response = ring(0.35 + sin(phase * 0.8) * 0.08, 0.025) * 0.8 + eye(0, 0, 0.5, 0.8) * pulse * 0.45
        case 5: response = [-0.48, 0, 0.48].reduce(0) { $0 + eye($1 + tremor, sin(phase + $1) * 0.18, 0.09, 0.045) } * (0.35 + pulse * 0.7)
        case 6: response = eye(-0.12 + tremor, 0.18, 0.26, 0.32) * 0.55 + ring(0.4 + cycle * 0.3, 0.018) * pulse
        case 7: response = [-0.5, -0.25, 0, 0.25, 0.5].reduce(0) { $0 + exp(-pow(wx - $1 - tremor, 2) / 0.012) * (0.25 + pulse) }
        case 8: response = exp(-pow(wy - 0.28 - tremor, 2) / 0.018) * exp(-wx * wx / 0.35) * (0.35 + pulse)
        case 9: response = ring(0.22 + cycle * 0.45, 0.018) * 0.8 + pulse * 0.35
        case 10: response = exp(-pow(wy - (cycle * 1.8 - 0.9), 2) / 0.012) * (0.25 + pulse * 0.75)
        default: response = ring(0.24 + cycle * 0.38, 0.012) * 0.75 + eye(0, 0, 0.52, 0.24) * pulse * 0.45
        }
        return max(0, min(1, response * strength))
    }

    // place one row against the glass.
    private func draw(_ cells: [Cell], row: Int, topInset: CGFloat, cellWidth: CGFloat, cellHeight: CGFloat, attributes: [NSAttributedString.Key: Any]) {
        var x: CGFloat = 0
        for cell in cells {
            var attrs = attributes
            attrs[.foregroundColor] = cell.foreground ?? ansi[cell.ansi + (cell.bright ? 8 : 0)]
            NSString(string: cell.glyph).draw(at: NSPoint(x: x, y: bounds.height - topInset - CGFloat(row + 1) * cellHeight), withAttributes: attrs)
            x += cellWidth
        }
    }

    // keep the row centred.
    private func centered(_ cells: [Cell], width: Int, ansi: Int, bright: Bool = false) -> [Cell] {
        var line = Array(repeating: Cell(glyph: " ", ansi: ansi), count: max(0, width))
        let start = max(0, (width - cells.count) / 2)
        for (index, cell) in cells.enumerated() where start + index < line.count { line[start + index] = cell }
        return line
    }

    private func centered(_ text: String, width: Int, ansi: Int, bright: Bool = false) -> [Cell] {
        centered(Array(text).map { Cell(glyph: String($0), ansi: ansi, bright: bright, foreground: activeTextColor) }, width: width, ansi: ansi, bright: bright)
    }

    // repeatable noise keeps the field light.
    private func noise(x: Double, y: Double, seed: Double) -> Double {
        let value = sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453
        return value - floor(value)
    }
}

// the clock leaves only a small mark.
private extension DateFormatter {
    static func possessTime() -> String {
        let calendar = Calendar.current
        let now = Date()
        let hour = calendar.component(.hour, from: now)
        let minute = calendar.component(.minute, from: now)
        let circle = hour < 12 ? "○" : "●"
        let hour12 = hour % 12 == 0 ? 12 : hour % 12
        return "\(circle) \(String(format: "%02d:%02d", hour12, minute))"
    }
    static func possessDate() -> String {
        let calendar = Calendar.current
        let now = Date()
        return String(format: "%02d/%02d", calendar.component(.day, from: now), calendar.component(.month, from: now))
    }
}
