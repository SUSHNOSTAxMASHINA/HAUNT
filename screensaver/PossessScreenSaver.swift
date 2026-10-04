import ScreenSaver
import AppKit
import CoreImage
import CoreText

// one colour sample for the field.
private struct RGB {
    var r: Double
    var g: Double
    var b: Double
}

private struct Motion {
    var speed: Double
    var breath: Double
    var noise: Double
}

private struct Knock {
    var kind: Int
    var cycle: Double
    var strength: Double
    var phase: Double
}

// one glyph, already lit.
private struct Cell {
    var glyph: String
    var r: Double
    var g: Double
    var b: Double
}

private struct FieldState {
    var ink: [RGB]
    var motion: Motion
    var phase: Double
    var scanPhase: Double
    var drift: Double
    var crt: CRT
    var glitch: Double
}

// the surface the field plays on. every dial at zero is the bare glass.
private struct CRT {
    var split = 0.0      // chroma aberration, screen px
    var bloom = 0.0      // phosphor glow
    var warp = 0.0       // barrel curvature
    var band = 0.0       // tape wobble, horizontal displacement
    var jitter = 0.0     // tracking noise, per-band displacement
    var vignette = 0.0   // corner falloff
    var grain = 0.0      // per-cell brightness speckle
    var desat = 0.0      // signal washout
    var punch = 1.3      // saturation + gain push (1 = none)
}

// the dials locked to the base — the room's one setting.
private let crtPresets: [(name: String, crt: CRT)] = [
    ("clean", CRT(split: 3, bloom: 1, jitter: 1, grain: 0.6, punch: 1.65)),
]

// the ink. three colours each, so one palette can dissolve into the next.
private let palettes: [(name: String, ink: [RGB], swirl: Double)] = [
    ("abyss",    [RGB(r: 91, g: 112, b: 232), RGB(r: 182, g: 82, b: 210), RGB(r: 49, g: 180, b: 207)], 0.26),
    ("current",  [RGB(r: 43, g: 244, b: 238), RGB(r: 243, g: 47, b: 153), RGB(r: 154, g: 255, b: 72)], 0.82),
    ("thought",  [RGB(r: 243, g: 44, b: 181), RGB(r: 95, g: 126, b: 255), RGB(r: 236, g: 220, b: 155)], 1.0),
    ("hellfire", [RGB(r: 255, g: 40, b: 10), RGB(r: 255, g: 150, b: 0), RGB(r: 255, g: 236, b: 190)], 0.5),
    ("venom",    [RGB(r: 84, g: 196, b: 96), RGB(r: 232, g: 227, b: 89), RGB(r: 157, g: 67, b: 157)], 0.75),
    ("vapor",    [RGB(r: 232, g: 86, b: 201), RGB(r: 84, g: 203, b: 232), RGB(r: 236, g: 236, b: 236)], 0.9),
    ("royal",    [RGB(r: 76, g: 84, b: 232), RGB(r: 157, g: 67, b: 157), RGB(r: 232, g: 86, b: 201)], 0.55),
    ("lagoon",   [RGB(r: 62, g: 156, b: 156), RGB(r: 84, g: 203, b: 232), RGB(r: 42, g: 63, b: 176)], 0.4),
    ("matrix",   [RGB(r: 84, g: 196, b: 96), RGB(r: 63, g: 156, b: 66), RGB(r: 236, g: 236, b: 236)], 0.45),
    ("halogen",  [RGB(r: 255, g: 84, b: 0), RGB(r: 255, g: 150, b: 24), RGB(r: 255, g: 214, b: 120)], 0.3),
]

// the glass's three motions.
private let motions: [(name: String, motion: Motion)] = [
    ("waiting",  Motion(speed: 0.48, breath: 0.11, noise: 0.26)),
    ("writing",  Motion(speed: 1.90, breath: 0.06, noise: 0.82)),
    ("thinking", Motion(speed: 1.55, breath: 0.085, noise: 1.0)),
]

private let paletteFade: Double = 1.6  // seconds
private let knockLife: Double = 12     // ticks, as on the glass (~5s)

// a cheap deterministic hash-noise, 0..1 — the glass's grain, static and drift.
private func noise(x: Double, y: Double, seed: Double) -> Double {
    let value = sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453
    return value - floor(value)
}

// the composite stage in one CI chain: real gaussian softness of the video signal +
// the vibrancy lift that keeps colours hot through heavy damage.
private let ciContext = CIContext(options: [:])
private func ciPass(_ source: NSImage, _ radius: Double, _ sat: Double) -> NSImage {
    guard let cg = source.cgImage(forProposedRect: nil, context: nil, hints: nil),
          let blurF = CIFilter(name: "CIGaussianBlur"),
          let colorF = CIFilter(name: "CIColorControls") else { return source }
    let ciBase = CIImage(cgImage: cg)
    blurF.setValue(ciBase.clampedToExtent(), forKey: kCIInputImageKey)
    blurF.setValue(radius, forKey: kCIInputRadiusKey)
    colorF.setValue(blurF.outputImage, forKey: kCIInputImageKey)
    colorF.setValue(sat, forKey: kCIInputSaturationKey)
    colorF.setValue(1.1, forKey: kCIInputContrastKey)
    guard let out = colorF.outputImage,
          let outCG = ciContext.createCGImage(out, from: ciBase.extent,
                                              format: CIFormat.RGBA8,
                                              colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!) else { return source }
    return NSImage(cgImage: outCG, size: source.size)
}

// glass textures, baked once per size at pixel pitch — multiply-only, so the glass
// textures the light and never the void. grille: scanlines + rgb triads. moire:
// two fine grids; the beat between their pitches at blit time makes the bands crawl.
private var glassCache: [String: NSImage] = [:]
private func glassPattern(_ kind: String, _ size: NSSize) -> NSImage? {
    let key = "\(kind)-\(Int(size.width))x\(Int(size.height))"
    if let hit = glassCache[key] { return hit }
    let img = NSImage(size: size)
    img.lockFocus()
    NSGraphicsContext.current?.compositingOperation = .sourceOver
    NSColor.white.setFill()
    NSRect(origin: .zero, size: size).fill()
    NSGraphicsContext.current?.compositingOperation = .multiply
    switch kind {
    case "grille":
        NSColor(calibratedWhite: 0.72, alpha: 1).setFill()          // scanlines: every other row bites
        for y in stride(from: 0, to: Int(size.height), by: 2) {
            NSRect(x: 0, y: CGFloat(y), width: size.width, height: 1).fill()
        }
        let triads = [NSColor(calibratedRed: 1.0, green: 0.93, blue: 0.93, alpha: 1),
                      NSColor(calibratedRed: 0.93, green: 1.0, blue: 0.93, alpha: 1),
                      NSColor(calibratedRed: 0.93, green: 0.93, blue: 1.0, alpha: 1)]
        for x in 0..<Int(size.width) {                              // shadowmask: rgb triads down the columns
            triads[x % 3].setFill()
            NSRect(x: CGFloat(x), y: 0, width: 1, height: size.height).fill()
        }
    case "moireA", "moireB":
        NSColor(calibratedWhite: 0.8, alpha: 1).setFill()
        for y in stride(from: 0, to: Int(size.height), by: 3) {
            NSRect(x: 0, y: CGFloat(y), width: size.width, height: 1).fill()
        }
        for x in stride(from: 0, to: Int(size.width), by: 3) {
            NSRect(x: CGFloat(x), y: 0, width: 1, height: size.height).fill()
        }
    case "glare":
        NSGraphicsContext.current?.compositingOperation = .copy       // replace, don't blend —
        NSColor.clear.setFill()                                       // sourceOver ignores a clear fill
        NSRect(origin: .zero, size: size).fill()                      // glare rides on transparency, not white
        NSGraphicsContext.current?.compositingOperation = .sourceOver
        let ctx = NSGraphicsContext.current!.cgContext
        let rad = max(size.width, size.height) * 0.72
        let grad = CGGradient(colorSpace: CGColorSpaceCreateDeviceRGB(),
                              colorComponents: [1, 1, 1, 0.5, 1, 1, 1, 0.1, 1, 1, 1, 0],
                              locations: [0, 0.35, 1], count: 3)!
        ctx.saveGState()                                              // squash to a dome-shaped ellipse
        ctx.translateBy(x: size.width / 2, y: size.height * 0.6)
        ctx.scaleBy(x: 1, y: 0.55)
        ctx.drawRadialGradient(grad, startCenter: .zero, startRadius: 0,
                               endCenter: .zero, endRadius: rad, options: [])
        ctx.restoreGState()
    default: break
    }
    img.unlockFocus()
    glassCache[key] = img
    return img
}

// the glass where the field remains.
final class PossessView: ScreenSaverView {

    override init?(frame: NSRect, isPreview: Bool) {
        super.init(frame: frame, isPreview: isPreview)
        animationTimeInterval = 0.42
        loadFont()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        animationTimeInterval = 0.42
        loadFont()
    }

    override var hasConfigureSheet: Bool { false }
    override func startAnimation() { super.startAnimation(); needsDisplay = true }

    // the braille field rides Apple Braille — Hack has no braille patterns, and
    // drawing ASCII through it would fall back mid-string with mismatched
    // advances (the banner gap). the banner rides Hack itself: one font per
    // string, natural advances, no drift.
    private var fieldFont = NSFont.monospacedSystemFont(ofSize: 10, weight: .regular)
    private var bannerFont = NSFont.monospacedSystemFont(ofSize: 10, weight: .regular)
    private func loadFont() {
        if let url = Bundle(for: type(of: self)).url(forResource: "Hack-Regular", withExtension: "ttf") {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
        let hack = NSFont(name: "Hack Regular", size: 10) ?? bannerFont
        var chars: [UniChar] = [0x2801]
        var glyphs = [CGGlyph](repeating: 0, count: 1)
        fieldFont = CTFontGetGlyphsForCharacters(hack, &chars, &glyphs, 1)
            ? hack
            : (NSFont(name: "Apple Braille", size: 10) ?? NSFont(name: "AppleBraille", size: 10) ?? hack)
        bannerFont = hack
    }

    private let brailleDots: [(Int, Int, UInt8)] = [
        (0, 0, 0x01), (0, 1, 0x02), (0, 2, 0x04), (1, 0, 0x08),
        (1, 1, 0x10), (1, 2, 0x20), (0, 3, 0x40), (1, 3, 0x80)
    ]
    private let bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
    private var colorCache: [UInt32: NSColor] = [:]
    private let whispers = ["шёпот", "НЕ СМОТРИ", "VOID", "h̷u̷s̷h̷", "помни", "[REDACTED]", "не здесь", "E̸C̸H̸O̸"]

    // the glass stepped its tick once per animationTimeInterval (0.42s) — the
    // frame counter IS that tick, so every motion, dither crawl and knock ramp
    // stays at exactly the screensaver's cadence; only ink fades stay smooth.
    private var tick: Double = 0
    private var paletteIdx = 0
    private var motionIdx = 0
    private var fadeInk = palettes[0].ink
    private var fadeSwirl = palettes[0].swirl
    private var inkFadeStart = Date().timeIntervalSinceReferenceDate
    // the colour drift accumulates at the *shown* swirl rate instead of being
    // recomputed from phase × swirl — blending swirl the old way re-mapped the
    // whole colour field every fade, and the pattern raced while it ran.
    private var colourDrift = 0.0
    private var shownSwirl = palettes[0].swirl
    private var lastDriftTick = 0.0
    // speed lives inside three accumulated phases; blending it directly would
    // re-map the whole field mid-fade, exactly like the swirl bug.
    private var phase = 0.0
    private var scanPhase = 0.0
    private var shownSpeed = motions[0].motion.speed
    private var shownBreath = motions[0].motion.breath
    private var shownNoise = motions[0].motion.noise
    private var fadeMotion = motions[0].motion
    private var motionStartTick = 0.0
    private var knocks: [(kind: Int, start: Double)] = []
    private var glitchStart: Double?

    // the room drifts on its own: palettes, motions, knocks, glitch bursts.
    override func animateOneFrame() {
        tick += 1
        let odds = 0.42 / 60.0
        if Double.random(in: 0..<1) < odds { setMotion(Int.random(in: 0..<motions.count)) }
        if Double.random(in: 0..<1) < odds { setPalette(Int.random(in: 0..<4)) }   // palettes 1–4 only
        if knocks.isEmpty && Double.random(in: 0..<1) < odds { fireKnock(Int.random(in: 0..<12)) }
        if glitchStart == nil && Double.random(in: 0..<1) < odds { glitchStart = tick }
        refreshTemperature()
        needsDisplay = true
    }

    private func setPalette(_ p: Int) {
        guard p != paletteIdx else { return }
        fadeInk = sample().ink
        fadeSwirl = shownSwirl
        paletteIdx = p
        inkFadeStart = Date().timeIntervalSinceReferenceDate
    }

    private func setMotion(_ m: Int) {
        guard m != motionIdx else { return }
        fadeMotion = Motion(speed: shownSpeed, breath: shownBreath, noise: shownNoise)
        motionIdx = m
        motionStartTick = tick
    }

    private func fireKnock(_ kind: Int) {
        knocks.append((kind, tick))
        while knocks.count > 4 { knocks.removeFirst() }   // can't stack forever
    }

    // a glitch burst: snappy in over half a tick, out over ~1.5s, once through.
    private func glitchLevel() -> Double {
        guard let s = glitchStart else { return 0 }
        let age = tick - s
        guard age <= 3.5 else { glitchStart = nil; return 0 }
        let cycle = min(1, age / 3.5)
        return max(0, min(1, age / 0.5) * (1 - max(0, cycle - 0.55) / 0.45))
    }

    private func sample() -> FieldState {
        if tick > lastDriftTick {
            let dt = tick - lastDriftTick
            phase += dt * 0.095 * shownSpeed
            scanPhase += dt * 0.55 * shownSpeed
            colourDrift += dt * 0.095 * shownSpeed * shownSwirl
            lastDriftTick = tick
            // motions step over four field frames, never interpolated between
            // them — a per-render blend moves faster than the glass ever did.
            let motionTarget = motions[motionIdx].motion
            let mt = min(1, floor(tick - motionStartTick) / 4.0)
            shownSpeed = fadeMotion.speed + (motionTarget.speed - fadeMotion.speed) * mt
            shownBreath = fadeMotion.breath + (motionTarget.breath - fadeMotion.breath) * mt
            shownNoise = fadeMotion.noise + (motionTarget.noise - fadeMotion.noise) * mt
        }
        let now = Date().timeIntervalSinceReferenceDate
        let inkT = min(1, (now - inkFadeStart) / paletteFade)
        let inkTarget = palettes[paletteIdx]
        shownSwirl = fadeSwirl + (inkTarget.swirl - fadeSwirl) * inkT
        let ink = zip(fadeInk, inkTarget.ink).map { RGB(r: $0.r + ($1.r - $0.r) * inkT, g: $0.g + ($1.g - $0.g) * inkT, b: $0.b + ($1.b - $0.b) * inkT) }
        return FieldState(ink: ink, motion: Motion(speed: shownSpeed, breath: shownBreath, noise: shownNoise),
                          phase: phase, scanPhase: scanPhase, drift: colourDrift,
                          crt: crtPresets[0].crt, glitch: glitchLevel())
    }

    private func knocksNow(phase: Double) -> [Knock] {
        knocks.removeAll { tick - $0.start > knockLife }
        return knocks.map {
            let age = tick - $0.start
            let cycle = min(1, age / knockLife)
            let strength = min(1, age / 3) * (1 - max(0, cycle - 0.72) / 0.28)
            return Knock(kind: $0.kind, cycle: cycle, strength: max(0, strength), phase: phase)
        }
    }

    // current-location temperature: wttr.in resolves the location from the
    // network — no permission dance at the lock screen. cached 10 minutes in
    // defaults; the background fetch racing the draw is harmless.
    private var temperature = UserDefaults.standard.string(forKey: "possess.temperature") ?? "--°"
    private var temperatureAt = Date.distantPast
    private func refreshTemperature() {
        guard Date().timeIntervalSince(temperatureAt) > 600 else { return }
        temperatureAt = Date()
        guard let url = URL(string: "https://wttr.in/?format=%t") else { return }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let s = String(data: data ?? Data(), encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines), s.count > 3 else { return }
            let t = s.hasPrefix("+") ? String(s.dropFirst()) : s
            self.temperature = t
            UserDefaults.standard.set(t, forKey: "possess.temperature")
        }.resume()
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.black.setFill()
        bounds.fill()

        let field = sample()
        let knock = knocksNow(phase: field.phase)

        let cellWidth = max(1, fieldFont.maximumAdvancement.width)
        let cellHeight = max(12, fieldFont.boundingRectForFont.height + 2)
        let columns = max(1, Int(bounds.width / cellWidth))
        let hasNotch = (window?.screen?.safeAreaInsets.top ?? 0) > 0
        let safeTop = max(hasNotch ? 46 : 0, safeAreaInsets.top)
        let safeBottom = max(0, safeAreaInsets.bottom)
        let rows = max(1, Int((bounds.height - safeTop - safeBottom) / cellHeight))
        let cy = bounds.midY

        // the field is pure math per dot; spread the rows over the cores.
        var grid = [[Cell]?](repeating: nil, count: rows)
        let gridLock = NSLock()
        DispatchQueue.concurrentPerform(iterations: rows) { row in
            let cells = fieldRow(width: columns, rows: rows, row: row, tick: tick, motion: field.motion,
                                 phase: field.phase, scanPhase: field.scanPhase, ink: field.ink,
                                 drift: field.drift, knocks: knock, crt: field.crt, glitch: field.glitch)
            gridLock.lock()
            grid[row] = cells
            gridLock.unlock()
        }

        // no commands reach this room. one broken word still surfaces.
        let whisper = whispers[Int(tick / 3) % whispers.count]
        let whisperRow = Int(tick / 5) % rows
        if var cells = grid[whisperRow] {
            let hot = field.ink.max { ($0.r + $0.g + $0.b) < ($1.r + $1.g + $1.b) } ?? RGB(r: 255, g: 255, b: 255)
            let word = Array(glitched(whisper))
            let start = max(0, min(columns - word.count, Int(tick * 7) % max(1, columns - word.count + 1)))
            for (index, character) in word.enumerated() where start + index < cells.count {
                cells[start + index] = Cell(glyph: String(character),
                                            r: min(255, hot.r * 1.4), g: min(255, hot.g * 1.4), b: min(255, hot.b * 1.4))
            }
            grid[whisperRow] = cells
        }

        // the banner lives IN the field: its rows replace field rows, and its
        // spaces erase the braille, so nothing pokes through around the words.
        // no blackout bar — the bleed is free to glow in from the rows above and
        // below. it rides the field's own ink, pushed hot, at the field's own
        // font metrics; the flat row is pre-compensated so the dome lands it on
        // the lower third.
        let hot = field.ink.max { ($0.r + $0.g + $0.b) < ($1.r + $1.g + $1.b) } ?? RGB(r: 255, g: 255, b: 255)
        // pad in Hack advances: the row draws as one Hack string, so its spaces
        // advance at Hack's metric, not the braille cell width.
        let hackAdv = bannerFont.maximumAdvancement.width
        func bannerRow(_ text: String, _ bright: Double) -> [Cell] {
            let tw = (text as NSString).size(withAttributes: [.font: bannerFont]).width
            let pad = max(0, Int(round((bounds.width / 2 - tw / 2) / hackAdv)))
            var row = Array(repeating: Cell(glyph: " ", r: 0, g: 0, b: 0), count: pad)
            for character in text {
                row.append(Cell(glyph: String(character),
                                r: min(255, hot.r * bright), g: min(255, hot.g * bright), b: min(255, hot.b * bright)))
            }
            return row
        }
        let scan = String(repeating: ["·", "┄", "─", "┄"][Int(tick / 2) % 4], count: Int(bounds.width / hackAdv) + 1)
        let trace = ["·────·────┈┈·───·", "·──┈┈·────·─────·", "┈·────·──┈┈·────·", "·────┈┈·────·───·"][Int(tick) % 4]
        let banner = [
            bannerRow(scan, 1.0),
            bannerRow(" GHOST // MACHINE ", 1.5),
            bannerRow("\(DateFormatter.possessDate()) / \(DateFormatter.possessTime()) / \(temperature)", 1.15),
            bannerRow("  \(trace)", 1.15),
        ]
        let nyBand = bounds.height / 3 / bounds.height * 2 - 1
        let fBand = 1 + 0.1 * (1 - nyBand * nyBand) - 0.03 * nyBand * nyBand
        let flatCenter = cy + (bounds.height / 3 - cy) / fBand
        let centerRow = Int((bounds.height - safeTop - flatCenter) / cellHeight - 0.5)
        for (i, row) in banner.enumerated() {
            let r = centerRow - banner.count / 2 + i
            guard r >= 0, r < rows else { continue }
            grid[r] = row
        }
        let bandY = bounds.height - safeTop - (CGFloat(centerRow) + 0.5) * cellHeight

        // four layers, back to front: raw braille rows → vhs/composite → crt
        // beam, split + bloom → glass, curvature + grille + moire. the glass
        // recipe and every dial sit at the DMX ladder's n.
        let sev = 2
        let splitPx = CGFloat(field.crt.split) * (1 + 2.0 * field.glitch)
            * (1 + 0.2 * CGFloat(sev - 1))   // chroma aberration widens with severity
        let base = NSImage(size: bounds.size)
        base.lockFocus()
        NSColor.black.setFill()
        bounds.fill()
        drawRows(grid, split: splitPx, cellWidth: cellWidth, cellHeight: cellHeight, topInset: safeTop, bandY: bandY)
        base.unlockFocus()
        let degraded = vhsPass(base, sev)

        // one pipeline, two strengths: the composite runs again at half scale
        // and shows through only around the band — the field's own settings,
        // scaled toward the middle so the words clear.
        let gentle = vhsPass(base, sev, scale: 0.5)
        let gentleMasked = NSImage(size: bounds.size)
        gentleMasked.lockFocus()
        gentle.draw(in: bounds, from: .zero, operation: .sourceOver, fraction: 1)
        NSGraphicsContext.current?.compositingOperation = .destinationOut
        if let ctx = NSGraphicsContext.current?.cgContext {
            let ryIn: CGFloat = 90      // fully clear around the words (x-radius scales with ryOut)
            let ryOut: CGFloat = 240, rxOut: CGFloat = 520   // full strength beyond
            ctx.saveGState()
            ctx.translateBy(x: bounds.midX, y: bandY)
            ctx.scaleBy(x: rxOut / ryOut, y: 1)
            let stops = [CGColor(gray: 0, alpha: 0), CGColor(gray: 0, alpha: 0), CGColor(gray: 0, alpha: 1)] as CFArray
            if let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceGray(), colors: stops,
                                  locations: [0, Double(ryIn / ryOut), 1]) {
                ctx.drawRadialGradient(g, startCenter: .zero, startRadius: 0,
                                       endCenter: .zero, endRadius: ryOut, options: [.drawsAfterEndLocation])
            }
            ctx.restoreGState()
        }
        NSGraphicsContext.current?.compositingOperation = .sourceOver
        gentleMasked.unlockFocus()

        let composed = NSImage(size: bounds.size)
        composed.lockFocus()
        NSColor.black.setFill()
        bounds.fill()
        degraded.draw(in: bounds, from: .zero, operation: .sourceOver, fraction: 1)
        let bloomF = CGFloat(field.crt.bloom)
        if bloomF > 0.01 {                                                // phosphor bloom
            let b1 = bounds.insetBy(dx: -6, dy: -4), b2 = bounds.insetBy(dx: -14, dy: -9)
            degraded.draw(in: b1, from: .zero, operation: .screen, fraction: bloomF * 0.6)
            degraded.draw(in: b2, from: .zero, operation: .screen, fraction: bloomF * 0.32)
        }
        gentleMasked.draw(in: bounds, from: .zero, operation: .sourceOver, fraction: 1)
        composed.unlockFocus()
        // curvature: a vintage CRT dome bulging toward the eye — the centre of the
        // faceplate is closer, so it magnifies; the edges tuck back.
        let strips = 36
        let sh = bounds.height / CGFloat(strips)
        for i in 0..<strips {
            let ny = (CGFloat(i) + 0.5) / CGFloat(strips) * 2 - 1
            let bulge = 1 - ny * ny
            let f = 1 + 0.1 * bulge - 0.03 * ny * ny
            let w = bounds.width * (1 + 0.16 * bulge - 0.03 * ny * ny)
            composed.draw(in: NSRect(x: (bounds.width - w) / 2, y: cy + (CGFloat(i) * sh - cy) * f,
                                     width: w, height: sh * f + 1.5),
                          from: NSRect(x: 0, y: CGFloat(i) * sh, width: composed.size.width, height: sh + 1),
                          operation: .sourceOver, fraction: 1)
        }
        // the grille + moire beat: pixel-pitch multiply blits; the moire drifts one
        // glass step at a time, so nothing on the glass outruns the tube.
        if let grille = glassPattern("grille", bounds.size) {
            grille.draw(in: bounds, from: .zero, operation: .multiply, fraction: 0.52)
        }
        let depth: CGFloat = 0.16
        let drift = 1.05 + 0.015 * sin(tick * 0.55)
        glassPattern("moireA", bounds.size)?.draw(in: bounds, from: .zero, operation: .multiply, fraction: depth)
        if let b = glassPattern("moireB", bounds.size) {
            let w = bounds.width * CGFloat(drift), h = bounds.height * CGFloat(drift)
            b.draw(in: bounds.insetBy(dx: (bounds.width - w) / 2, dy: (bounds.height - h) / 2),
                   from: .zero, operation: .multiply, fraction: depth)
        }
        NSGraphicsContext.current?.compositingOperation = .sourceOver
        if let glare = glassPattern("glare", bounds.size) {              // specular sheen on the dome —
            glare.draw(in: bounds, from: .zero, operation: .overlay, fraction: 0.3)   // overlay: black stays black
        }
    }

    private func color(r: Double, g: Double, b: Double) -> NSColor {
        let red = UInt32(min(255, max(0, r))), green = UInt32(min(255, max(0, g))), blue = UInt32(min(255, max(0, b)))
        let key = (red << 16) | (green << 8) | blue
        if let cached = colorCache[key] { return cached }
        let fresh = NSColor(calibratedRed: CGFloat(red) / 255, green: CGFloat(green) / 255,
                            blue: CGFloat(blue) / 255, alpha: 1)
        if colorCache.count > 16384 { colorCache.removeAll(keepingCapacity: true) }
        colorCache[key] = fresh
        return fresh
    }

    // the crt beam: three channel-isolated passes per row, split apart —
    // ported from the DMX build's drawRows. the split scales with the dome's
    // curve, centred on the banner band: tight where the words sit, full
    // step-n toward the rim.
    private func drawRows(_ grid: [[Cell]?], split: CGFloat, cellWidth: CGFloat, cellHeight: CGFloat, topInset: CGFloat, bandY: CGFloat) {
        let bucket = 16                                   // glyphs per span — smooth enough, cheap enough
        for (row, rowCells) in grid.enumerated() {
            guard let cells = rowCells else { continue }
            let y = bounds.height - topInset - CGFloat(row + 1) * cellHeight
            let rowY = y + cellHeight / 2
            // rows holding non-braille glyphs (banner, whisper words) draw as one
            // Hack run — braille falls back uniformly, ascii stays Hack: no
            // per-bucket advance drift, no gaps in the words.
            let hasASCII = cells.contains { ($0.glyph.unicodeScalars.first?.value ?? 0x2800) < 0x2800 }
            if hasASCII {
                var text = ""
                text.reserveCapacity(cells.count)
                for c in cells { text += c.glyph }
                let t = damageTaper(bounds.midX, rowY, bandY: bandY)
                for (channel, op) in [(0, NSCompositingOperation.sourceOver),
                                      (1, NSCompositingOperation.screen),
                                      (2, NSCompositingOperation.screen)] {
                    NSGraphicsContext.current?.compositingOperation = op
                    let line = NSMutableAttributedString(string: text, attributes: [.font: bannerFont])
                    for (i, c) in cells.enumerated() {
                        let v = channel == 0 ? c.r : channel == 1 ? c.g : c.b
                        line.addAttribute(.foregroundColor,
                                          value: color(r: channel == 0 ? v : 0,
                                                       g: channel == 1 ? v : 0,
                                                       b: channel == 2 ? v : 0),
                                          range: NSRange(location: i, length: 1))
                    }
                    let dx: CGFloat = channel == 0 ? -split * t : channel == 2 ? split * t : 0
                    line.draw(at: NSPoint(x: dx, y: y))
                }
                continue
            }
            for (channel, op) in [(0, NSCompositingOperation.sourceOver),
                                  (1, NSCompositingOperation.screen),
                                  (2, NSCompositingOperation.screen)] {
                NSGraphicsContext.current?.compositingOperation = op
                var start = 0
                while start < cells.count {
                    let end = min(cells.count, start + bucket)
                    let spanX = (CGFloat(start) + CGFloat(end - start) / 2) * cellWidth
                    let taper = damageTaper(spanX, rowY, bandY: bandY)
                    let dx = channel == 0 ? -split * taper : channel == 2 ? split * taper : 0
                    var text = ""
                    text.reserveCapacity(end - start)
                    for c in cells[start..<end] { text += c.glyph }
                    let line = NSMutableAttributedString(string: text, attributes: [.font: fieldFont])
                    for i in start..<end {
                        let c = cells[i]
                        let v = channel == 0 ? c.r : channel == 1 ? c.g : c.b
                        line.addAttribute(.foregroundColor,
                                          value: color(r: channel == 0 ? v : 0,
                                                       g: channel == 1 ? v : 0,
                                                       b: channel == 2 ? v : 0),
                                          range: NSRange(location: i - start, length: 1))
                    }
                    line.draw(at: NSPoint(x: CGFloat(start) * cellWidth + dx, y: y))
                    start = end
                }
            }
        }
        NSGraphicsContext.current?.compositingOperation = .sourceOver
    }

    // radial aberration falloff — elliptical like the dome's face, centred on
    // the banner band: ~0 at the words, full split at the rim.
    private func damageTaper(_ x: CGFloat, _ y: CGFloat, bandY: CGFloat) -> CGFloat {
        let rad = max(bounds.width, bounds.height) * 0.75
        let dx = (x - bounds.midX) / rad
        let dy = (y - bandY) / (rad * 0.62)
        let r = (dx * dx + dy * dy).squareRoot()
        if r >= 1 { return 1 }
        return r < 0.5 ? 0.05 + 0.7 * r : 0.4 + 1.2 * (r - 0.5)
    }

    // the vhs pass, straight off the DMX ladder: level 2 = the exact step-n
    // settings (blur 2.2 · sat 1.15 · bleed 0.12/0.3 · haze 0.185).
    // scale < 1 runs the same settings scaled down — used around the band so
    // the banner text clears without ever leaving the pipeline.
    private func vhsPass(_ source: NSImage, _ level: Int, scale: Double = 1.0) -> NSImage {
        let bleed: [CGFloat] = [0.08, 0.12, 0.14, 0.16]                  // of width, level 1…4
        let bleedA: [CGFloat] = [0.24, 0.3, 0.33, 0.36]
        let blur: [Double] = [1.2, 2.2, 2.7, 3.2]
        let s = CGFloat(scale)
        let soft = ciPass(source, blur[level - 1] * scale, [1.05, 1.15, 1.22, 1.3][level - 1])
        let out = NSImage(size: bounds.size)
        out.lockFocus()
        NSColor.black.setFill()
        bounds.fill()
        soft.draw(in: bounds, from: .zero, operation: .sourceOver, fraction: 1)
        soft.draw(in: bounds.insetBy(dx: -bounds.width * bleed[level - 1] * s, dy: 0), from: .zero,
                  operation: .screen, fraction: bleedA[level - 1] * s)        // composite chroma bleed
        // haze: the composite bleeding its glow — screen blend only ever adds light
        // where the signal is, so the void stays pure black.
        soft.draw(in: bounds.insetBy(dx: (-8 - CGFloat(level * 8)) * s, dy: (-6 - CGFloat(level * 6)) * s),
                  from: .zero, operation: .screen, fraction: (0.14 + CGFloat(level - 1) * 0.045) * s)
        out.unlockFocus()
        return out
    }

    private func glitched(_ text: String) -> String {
        let marks = Array("░▒▓█·╳")
        return String(Array(text).enumerated().map { index, character in
            guard character != " ", (Int(tick) + index * 7) % 13 < 2 else { return character }
            return marks[(Int(tick) + index) % marks.count]
        })
    }

    // pack the field into braille cells.
    private func fieldRow(width: Int, rows: Int, row: Int, tick: Double, motion: Motion,
                          phase: Double, scanPhase: Double, ink: [RGB], drift: Double,
                          knocks: [Knock], crt: CRT, glitch: Double) -> [Cell] {
        let heightDots = Double(rows * 4)
        let rollY = 1.4 - 2.8 * (1 - glitch)   // the burst's bright bar sweeps top to bottom
        var result = [Cell]()
        result.reserveCapacity(width)
        for column in 0..<width {
            var mask: UInt8 = 0
            var samples: [RGB] = []
            for (dx, dy, bit) in brailleDots {
                let px = column * 2 + dx
                let py = row * 4 + dy
                let sample = pixel(px: px, py: py, width: width * 2, height: rows * 4, tick: tick, motion: motion,
                                   phase: phase, scanPhase: scanPhase, ink: ink, drift: drift, knocks: knocks,
                                   crt: crt, glitch: glitch)
                let ditherX = Int(floor(tick / 6))
                let ditherY = Int(floor(tick / 4))
                let ditherIndex = ((py + ditherY) & 3) * 4 + ((px + ditherX) & 3)
                let ditherNext = ((py + ditherY) & 3) * 4 + ((px + ditherX + 1) & 3)
                let amount = tick - floor(tick)
                let dither = Double(bayer[ditherIndex]) + Double(bayer[ditherNext] - bayer[ditherIndex]) * amount
                let threshold = 0.20 + dither / 32
                if sample.density > threshold { mask |= bit; samples.append(sample.color) }
            }
            if mask == 0 {
                result.append(Cell(glyph: String(UnicodeScalar(0x2800)!), r: 0, g: 0, b: 0))
            } else {
                let count = Double(max(1, samples.count))
                var red = samples.reduce(0) { $0 + $1.r } / count
                var green = samples.reduce(0) { $0 + $1.g } / count
                var blue = samples.reduce(0) { $0 + $1.b } / count
                // push it: punch dials saturation and gain together.
                let luma0 = red * 0.299 + green * 0.587 + blue * 0.114
                red = (luma0 + (red - luma0) * crt.punch) * (1 + (crt.punch - 1) * 0.5)
                green = (luma0 + (green - luma0) * crt.punch) * (1 + (crt.punch - 1) * 0.5)
                blue = (luma0 + (blue - luma0) * crt.punch) * (1 + (crt.punch - 1) * 0.5)
                // the tube: the glitch roll bar (vignette sits at zero here).
                if glitch > 0.001 {
                    let ny = (Double(row) * 4 + 2) / heightDots * 2 - 1
                    let roll = exp(-pow(ny - rollY, 2) / 0.004) * glitch * 0.6
                    red *= 1 + roll; green *= 1 + roll; blue *= 1 + roll
                }
                result.append(Cell(glyph: String(UnicodeScalar(0x2800 + Int(mask))!),
                                   r: max(0, min(255, red)), g: max(0, min(255, green)), b: max(0, min(255, blue))))
            }
        }
        return result
    }

    // shape one pixel from waves, traces, and noise — the glass's own math,
    // seen through the tube: barrel warp, tape wobble, glitch tearing.
    private func pixel(px: Int, py: Int, width: Int, height: Int, tick: Double, motion: Motion,
                       phase: Double, scanPhase: Double, ink: [RGB], drift: Double,
                       knocks: [Knock], crt: CRT, glitch: Double) -> (density: Double, color: RGB) {
        var x = (Double(px) + 0.5) / Double(width) * 2 - 1
        var y = (Double(py) + 0.5) / Double(height) * 2 - 1
        let rr = x * x + y * y
        let k = crt.warp * 0.085
        x *= 1 + k * rr; y *= 1 + k * rr
        x += crt.band * 0.045 * (sin(y * 6.5 + phase * 0.9) + 0.4 * sin(y * 23 - phase * 0.43))
        // tracking jitter: each band re-rolls on its own scattered schedule —
        // continuous shimmer, never a global snap-and-loop.
        if crt.jitter > 0.001 {
            let band = Double(py / 6)
            let jp = noise(x: 0, y: band, seed: 9.1) * 2.0
            x += crt.jitter * (noise(x: 3.1, y: 8.8, seed: floor((tick + jp) / 2) * 3.1 + band * 2.7) - 0.5) * 0.05
        }
        if glitch > 0.01 {
            x += glitch * (noise(x: 7.3, y: 11.7, seed: Double(py / 5) * 3.1 + tick * 2) - 0.5) * 0.5
        }
        // grain rides the warped coords, so it wobbles and tears with the signal
        // instead of sitting still on the glass.
        var grainF = 1.0
        if crt.grain > 0.001 {
            // every dot holds ~3 frames but re-rolls scattered in time: no beat.
            let scatter = noise(x: x * 3.0, y: y * 3.0, seed: 7.7) * 3.0
            grainF = 1 + (noise(x: x, y: y, seed: floor((tick + scatter) / 3) * 5.7 + 13) - 0.5) * 2 * crt.grain
        }
        let breath = 1 + sin(phase * 0.7) * motion.breath
        let inhale = 1 + sin(phase * 0.31 - 0.8) * motion.breath * 1.6
        let wx = (x - sin(y * 11 + phase * 1.3) * 0.045 * motion.noise) / inhale
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
        var density = envelope * (0.13 + carrier * 0.32 + counter * 0.18) + eyeRim * 0.46 * featureMix
            + mouth * 0.23 * featureMix + jaw * 0.11 * featureMix + ring * 0.12 + pulse * 0.18
            + breathRing + memory - eyeVoid * 0.24 * featureMix
        density = max(0, density * (0.7 + 0.3 * sin((Double(py) + scanPhase) * .pi / 3)
            + sin(wx * 29 + wy * 17 + phase * 2.2) * 0.16 * motion.noise))
        if noise(x: Double(px) * 0.7, y: Double(py) * 0.9, seed: tick / 3 + 31) < max(0, abs(wx) - 0.58) * (0.08 + motion.noise * 0.05) { density *= 0.3 }
        if sin(wy * 33 + phase * 2.5) > 0.78 && noise(x: Double(px), y: Double(py), seed: tick / 2) < 0.24 + motion.noise * 0.18 { density *= 0.12 }
        // leave a little dust at the edge.
        if density < 0.08 && noise(x: Double(px) * 0.8, y: Double(py) * 0.7, seed: tick / 3 + 9) < 0.02 + motion.noise * 0.018 {
            density = 0.12 + noise(x: Double(px + 5), y: Double(py + 2), seed: tick) * 0.3
        }
        let response = knocks.reduce(0) { $0 + knockDensity($1, wx: wx, wy: wy) }
        let palettePosition = abs((wx + 1) * 1.8 + sin(wy * 5 + phase) * 1.4 + drift)
        let index = Int(palettePosition) % ink.count
        let blend = palettePosition - floor(palettePosition)
        let a = ink[index]
        let b = ink[(index + 1) % ink.count]
        let brightness = 0.5 + max(0, 1 - abs(wx + 0.35)) * 0.42 + density * 0.42
        return (max(0, min(1, (density + response) * grainF)),
                RGB(r: min(255, (a.r + (b.r - a.r) * blend) * brightness * grainF),
                    g: min(255, (a.g + (b.g - a.g) * blend) * brightness * grainF),
                    b: min(255, (a.b + (b.b - a.b) * blend) * brightness * grainF)))
    }

    // add the answer to the current knock — the glass's own math.
    private func knockDensity(_ k: Knock, wx: Double, wy: Double) -> Double {
        let radius = sqrt(wx * wx + wy * wy)
        func ring(_ r: Double, _ width: Double = 0.012) -> Double { exp(-pow(radius - r, 2) / width) }
        func eye(_ x: Double, _ y: Double, _ sx: Double, _ sy: Double) -> Double { exp(-(pow((wx - x) / sx, 2) + pow((wy - y) / sy, 2))) }
        let pulse = exp(-pow(k.cycle * 13, 2))
        let tremor = sin(k.phase * 2.7) * 0.025
        var response = 0.0
        switch k.kind {
        case 0: response = ring(0.08 + k.cycle * 1.05, 0.01) * (1 - k.cycle * 0.6) + pulse * 0.5
        case 1: response = (eye(-0.3 + tremor, -0.18, 0.2, 0.07) + eye(0.3 + tremor, -0.18, 0.2, 0.07)) * (0.35 + pulse)
        case 2: response = exp(-pow(wy - tremor, 2) / 0.012) * (0.3 + pulse)
        case 3: response = (ring(0.2 + k.cycle * 0.8, 0.012) + ring(0.45 + k.cycle * 0.3, 0.02) * 0.4) * (1 - k.cycle * 0.45)
        case 4: response = ring(0.35 + sin(k.phase * 0.8) * 0.08, 0.025) * 0.8 + eye(0, 0, 0.5, 0.8) * pulse * 0.45
        case 5: response = [-0.48, 0, 0.48].reduce(0) { $0 + eye($1 + tremor, sin(k.phase + $1) * 0.18, 0.09, 0.045) } * (0.35 + pulse * 0.7)
        case 6: response = eye(-0.12 + tremor, 0.18, 0.26, 0.32) * 0.55 + ring(0.4 + k.cycle * 0.3, 0.018) * pulse
        case 7: response = [-0.5, -0.25, 0, 0.25, 0.5].reduce(0) { $0 + exp(-pow(wx - $1 - tremor, 2) / 0.012) * (0.25 + pulse) }
        case 8: response = exp(-pow(wy - 0.28 - tremor, 2) / 0.018) * exp(-wx * wx / 0.35) * (0.35 + pulse)
        case 9: response = ring(0.22 + k.cycle * 0.45, 0.018) * 0.8 + pulse * 0.35
        case 10: response = exp(-pow(wy - (k.cycle * 1.8 - 0.9), 2) / 0.012) * (0.25 + pulse * 0.75)
        default: response = ring(0.24 + k.cycle * 0.38, 0.012) * 0.75 + eye(0, 0, 0.52, 0.24) * pulse * 0.45
        }
        return max(0, min(1, response * k.strength))
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
