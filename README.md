# Golden Z-5 Photobooth (Windows)

Event kiosk for **Golden Z-5 Security & Investigation Agency, Inc.** — **20th Anniversary (2006–2026)**. Guests configure the session first, take photos, pick a frame & effect, then print.

## Guest flow (operator cheat sheet)

**Setup → Capture → Frame/Effects → Print**

1. Attract screen → **Start** or `Space`
2. Choose **Output format (2×6 or 4×6)** + **Number of photos** + **Countdown seconds** → **Begin Capture**
3. Countdown captures each shot
4. Customize in 3 zones (Frame / Effects / Personalize), preview updates live
5. **Print** opens the print page and system print dialog (set `"silentPrint": true` in `config.json` for kiosk silent print in Electron) or **Save PNG** → returns to attract

`Esc` cancels / goes back where safe. `Ctrl+,` opens operator settings. `F11` fullscreen.

---

## Typography

UI type matches the **logo style**:

- **Cinzel** — uppercase headings & primary buttons (inscription / “OF EXCELLENCE” ribbon feel)
- **Cormorant Garamond Variable** — organization line, dates, summaries (elegant serif like the logo footer)
- **Source Sans 3 Variable** — chips, hints, and controls (readable at kiosk distance)

Variable **`wght`** axes and `font-optical-sizing: auto` per [Using variable fonts on the web](https://fonts.google.com/knowledge/using_variable_fonts_on_the_web).

---

## Prerequisites

- Windows 10/11
- Node.js 20+ LTS
- Webcam
- Photo printer + drivers, 2×6" and/or 4×6 paper loaded

## Quick start

```bash
cd photobooth
npm install
npm run generate:template
npm start
```

Web preview only (no silent print):

```bash
npm run web
```

Open http://localhost:5173/

### Production build

```bash
npm run build
```

Artifacts in `release/`.

---

## Templates & composition

**Overlay mode:** underfill → photos (cover crop into slots) → template PNG on top (transparent holes + branding).

Primary 3-shot frames: **Gold Anniversary Strip** and **Navy Anniversary Strip** (`strip-gold-3.png`, `strip-blue-3.png`) — textured borders with `logo.png` in the footer (aspect preserved).  
Also generated: `strip-1.png`, `strip-2.png`, `strip-4.png` (anniversary `logo.png` footer).

**Logos:** `gz5-logo.png` — agency seal (idle, setup, customize UI).  
`logo.png` — “20 Years” anniversary art (print strip / frame footer only).

Templates live in `config.json` → `templates[]`. Each has `id`, `name`, `formatId`, `photoCount`, `path`, `slots`.
Customize UI **only shows frames matching the chosen `formatId` + `photoCount`**.

## Customize architecture

- `customize-layout` is a 3-zone grid:
  - left `tools-col` (tabs: Frame / Effects / Personalize)
  - center `preview-col` (strip canvas + interaction overlay)
  - right `action-col` (Print first, copies selector, utility actions)
- Tabs are state-driven via `session.customizeTab`; only one tool panel is visible at once.
- Print-safe bounds can be toggled in Customize (`safeBounds`) for operator calibration.

## Personalization data model

- Sticker/text items are serialized in `session.stickers`.
- Each item supports: `id`, `type`, `stickerId`, `text`, `x`, `y`, `size`, `rotation`, `flipX`, `locked`, `category`.
- Locked brand starter elements are auto-seeded when entering Customize.
- Undo/redo uses serialized snapshots: `session.personalizeHistory` and `session.personalizeFuture`.

## Filter pipeline

- Effect presets are non-destructive: source captures are never mutated.
- Render order for each compose:
  1) captured photos into template slots
  2) selected global effect (+ optional advanced adjustments)
  3) template/frame overlay
  4) locked branded elements
  5) user stickers/text
  6) optional safe-bounds debug overlay

## Adding stickers/frames

- Add/edit sticker definitions in `src/js/stickers.js` (`STICKER_CATALOG`, categories, draw functions).
- Add frame templates in `config.json` `templates[]` with `formatId` + `photoCount` and slot definitions.
- Place static frame images under `assets/templates/`.

### Add / calibrate a template

1. Add a blank PNG under `assets/templates/` (transparent photo holes).
2. Measure slot `{x,y,w,h}` at **600×1800** (or scale measurements).
3. Append an entry to `config.json` `templates` with matching `formatId` + `photoCount`.
4. Enable **Debug slot outlines** in Settings, take a test session, adjust slots, Save.

```bash
npm run generate:template
```

Rebuilds blanks from `strip-sample-reference.png`; 1/2/4-shot classics use anniversary `logo.png` in the footer.

---

## Printer

### Exact Windows printer name

```powershell
Get-Printer | Select-Object Name
```

Or Settings → Printers & scanners. Put the exact string in `config.json` `printerName`, or pick it in **Settings** (`Ctrl+,`) → Save.

### Test print

Settings → choose printer → **Test print**.

### Recommended 2×6 driver settings

- Paper: 2×6" / photo strip / borderless  
- Orientation: Portrait  
- Margins: none  
- Quality: Photo / Best  

App prints silent, marginless, 2×6 page size.

---

## Config highlights

| Key | Purpose |
|-----|---------|
| `defaults.photoCount` / `countdownSeconds` | Setup defaults |
| `allowedPhotoCounts` / `allowedCountdowns` | Setup chips |
| `formats[]` | Output formats (2×6 vs 4×6) + allowed photo counts |
| `templates[].formatId` | Which output format a template belongs to |
| `templates[]` | Frames + slots per `formatId` + `photoCount` |
| `canvas` | 600×1800 @ 300 DPI; `scale: 2` → 1200×3600 |
| `printerName` / `copies` | Silent print |
| `debugSlots` | Green slot outlines on composite |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Camera blocked | Address-bar camera icon → Allow; Windows Privacy → Camera |
| Wrong paper / crop | Set driver default to 2×6 borderless; Test print |
| Silent print fails | Exact printer name; update drivers; check logs |
| Frame missing for N photos | Add a template with the matching `"formatId"` + `"photoCount": N` |
| Mirror | Setup checkbox — strip matches what guest saw when on |
| Web Print shows dialog | Expected; use `npm start` (Electron) for silent print |

Logs (packaged): `%APPDATA%/<app>/logs/photobooth.log`

---

## Scripts

| Command | Purpose |
|---------|---------|
| `npm start` | Electron + Vite (full kiosk) |
| `npm run web` | Browser preview |
| `npm run generate:template` | Rebuild blank PNGs |
| `npm run build` | Windows installer |

## Out of scope (v1)

Payments, QR/cloud gallery, AI beauty filters, phone remote, macOS/Linux primary.
