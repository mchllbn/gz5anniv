/**
 * Config loader — templates, defaults, session options.
 */

const DEFAULTS = {
  printerName: 'REPLACE_WITH_WINDOWS_PRINTER_NAME',
  copies: 1,
  defaults: {
    photoCount: 3,
    countdownSeconds: 3,
    mirrorPreview: false,
    filter: 'natural',
    templateId: 'anniversary-navy',
    formatId: '2x6',
    confettiOverlap: false,
  },
  allowedPhotoCounts: [3],
  allowedCountdowns: [3, 5, 10],
  canvas: { width: 600, height: 1800, dpi: 300, scale: 2 },
  formats: [],
  underfillColor: '#e8e8ec',
  templateMode: 'overlay',
  debugSlots: false,
  pauseBetweenShotsMs: 700,
  saveLocalCopy: true,
  /** When true (Electron only), Print strip skips the dialog and sends to the configured printer. */
  silentPrint: false,
  outputDir: 'output',
  showTimestamp: false,
  /** When true, print color adjustments are applied to preview + printed pages. */
  printAdjustmentsEnabled: true,
  /** When true, saved print color profile is reused for every future print. */
  printAdjustmentsPermanent: true,
  /** Print-color profile (brightness/clarity for brighter paper output). */
  printAdjustments: {
    brightness: 8,
    contrast: 4,
    clarity: 12,
    saturation: 0,
    exposure: 4,
    warmth: 0,
    shadows: 6,
    highlights: -4,
  },
  /** capture-card = HDMI → USB video grab; gphoto2/digicamcontrol = USB shutter */
  camera: {
    backend: 'capture-card',
    preferredDeviceLabel: 'USB Video',
    captureWidth: 1920,
    captureHeight: 1080,
    mode: 'remote',
    previewSource: 'capture-card',
    /** Auto-crop black letterbox/pillarbox from Fuji HDMI (and similar). */
    cropBlackBars: true,
    gphotoPath: '',
    useWslGphoto: true,
    cmdPath: '',
    remoteCmdPath: '',
    webPort: 5513,
    watchFolder: '',
    archiveFolder: '',
    timeoutMs: 45000,
    settleMs: 400,
    preferJpeg: true,
    archiveRaw: true,
    capturenoaf: false,
    mirrorCapture: false,
    fallbackToWebcam: false,
  },
  event: {
    title: '20th Anniversary',
    subtitle: '2006 ✦ 2026',
    organization: 'Golden Z-5 Security & Investigation Agency, Inc.',
    tagline: 'Golden Z-5 — 20th Anniversary Photobooth',
    agencyLogo: 'assets/templates/gz5-logo.png',
    anniversaryLogo: 'assets/templates/logo.png',
    logo: 'assets/templates/gz5-logo.png',
  },
  templates: [],
};

let state = {
  config: structuredClone(DEFAULTS),
  configPath: '',
  printers: [],
  printerWarning: null,
  isWeb: true,
  outputDir: '',
};

export function getState() {
  return state;
}

export function getConfig() {
  return state.config;
}

export function isWebMode() {
  return !window.photobooth;
}

export function getFormat(formatId, cfg = state.config) {
  const formats = Array.isArray(cfg.formats) ? cfg.formats : [];
  return formats.find((f) => f.id === formatId) || formats[0] || null;
}

export function composeSize(formatId, cfg = state.config) {
  const scale = cfg.canvas?.scale || 1;
  const dpi = cfg.canvas?.dpi || 300;
  const f = getFormat(formatId, cfg);
  const baseW = f?.canvasPx?.width ?? cfg.canvas?.width ?? 600;
  const baseH = f?.canvasPx?.height ?? cfg.canvas?.height ?? 1800;
  return {
    width: baseW * scale,
    height: baseH * scale,
    baseWidthPx: baseW,
    baseHeightPx: baseH,
    dpi,
    scale,
    format: f,
  };
}

/** Width ÷ height for UI/print (uses physical size when set, else canvas px). */
export function formatAspectRatio(formatId, cfg = state.config) {
  const f = getFormat(formatId, cfg);
  if (f?.physicalSizeInches?.width && f?.physicalSizeInches?.height) {
    return f.physicalSizeInches.width / f.physicalSizeInches.height;
  }
  if (f?.canvasPx?.width && f?.canvasPx?.height) {
    return f.canvasPx.width / f.canvasPx.height;
  }
  return 2 / 6;
}

export function scaleSlots(slots, scale) {
  return (slots || []).map((s) => ({
    x: Math.round(s.x * scale),
    y: Math.round(s.y * scale),
    w: Math.round(s.w * scale),
    h: Math.round(s.h * scale),
  }));
}

async function loadWebConfig() {
  let fileCfg = {};
  try {
    const res = await fetch('./config.json', { cache: 'no-store' });
    if (res.ok) fileCfg = await res.json();
  } catch {
    /* optional */
  }
  let local = {};
  try {
    local = JSON.parse(localStorage.getItem('photobooth-config') || '{}');
  } catch {
    local = {};
  }
  const config = {
    ...structuredClone(DEFAULTS),
    ...fileCfg,
    defaults: { ...DEFAULTS.defaults, ...fileCfg.defaults, ...local.defaults },
    event: { ...DEFAULTS.event, ...fileCfg.event },
    camera: { ...DEFAULTS.camera, ...fileCfg.camera, ...local.camera },
    canvas: {
      ...DEFAULTS.canvas,
      ...fileCfg.canvas,
      scale: local.canvas?.scale ?? 1,
    },
  };
  if (fileCfg.templates) config.templates = fileCfg.templates;
  if (local.printerName) config.printerName = local.printerName;
  if (local.copies != null) config.copies = local.copies;
  if (local.debugSlots != null) config.debugSlots = local.debugSlots;
  if (local.printAdjustments) {
    config.printAdjustments = { ...config.printAdjustments, ...local.printAdjustments };
  }
  if (local.printAdjustmentsEnabled != null) {
    config.printAdjustmentsEnabled = !!local.printAdjustmentsEnabled;
  }
  if (local.printAdjustmentsPermanent != null) {
    config.printAdjustmentsPermanent = !!local.printAdjustmentsPermanent;
  }

  state = {
    ...state,
    config,
    configPath: 'browser',
    printers: [],
    printerWarning:
      'Web preview: Print opens the in-app print page and system print dialog.',
    isWeb: true,
  };
  return state;
}

export async function loadBootstrap() {
  if (!window.photobooth) return loadWebConfig();
  const data = await window.photobooth.getConfig();
  state = {
    ...state,
    ...data,
    config: {
      ...structuredClone(DEFAULTS),
      ...data.config,
      defaults: { ...DEFAULTS.defaults, ...data.config?.defaults },
      event: { ...DEFAULTS.event, ...data.config?.event },
      camera: { ...DEFAULTS.camera, ...data.config?.camera },
      printAdjustments: {
        ...DEFAULTS.printAdjustments,
        ...data.config?.printAdjustments,
      },
    },
    isWeb: false,
  };
  return state;
}

export async function saveConfig(partial) {
  const next = { ...state.config, ...partial };
  if (!window.photobooth) {
    state.config = next;
    try {
      localStorage.setItem(
        'photobooth-config',
        JSON.stringify({
          printerName: next.printerName,
          copies: next.copies,
          defaults: next.defaults,
          debugSlots: next.debugSlots,
          camera: next.camera,
          canvas: { scale: next.canvas?.scale },
          printAdjustments: next.printAdjustments,
          printAdjustmentsEnabled: next.printAdjustmentsEnabled,
          printAdjustmentsPermanent: next.printAdjustmentsPermanent,
        })
      );
    } catch {
      /* ignore */
    }
    return next;
  }
  await window.photobooth.saveConfig(next);
  state.config = next;
  return next;
}

export function resolveAssetUrl(relPath) {
  if (!relPath) return null;
  if (relPath.startsWith('data:') || relPath.startsWith('http') || relPath.startsWith('blob:')) {
    return relPath;
  }
  const clean = relPath.replace(/^\.\//, '');
  return `./${clean}?v=1`;
}
