/**
 * Phase state machine:
 * idle → setup → capture → customize → (print) → idle
 * idle → album → printing → idle
 * Order is enforced — phases cannot be skipped forward accidentally.
 */

import { DEFAULT_ADJUSTMENTS } from './filters.js';

export const Phase = Object.freeze({
  IDLE: 'idle',
  SETUP: 'setup',
  CAPTURE: 'capture',
  CUSTOMIZE: 'customize',
  ALBUM: 'album',
  PRINTING: 'printing',
});

const ALLOWED = {
  [Phase.IDLE]: [Phase.SETUP, Phase.ALBUM],
  [Phase.SETUP]: [Phase.CAPTURE, Phase.IDLE],
  [Phase.CAPTURE]: [Phase.CUSTOMIZE, Phase.SETUP, Phase.IDLE],
  [Phase.CUSTOMIZE]: [Phase.CAPTURE, Phase.SETUP, Phase.ALBUM, Phase.PRINTING, Phase.IDLE],
  [Phase.ALBUM]: [Phase.IDLE, Phase.PRINTING, Phase.CUSTOMIZE],
  [Phase.PRINTING]: [Phase.CUSTOMIZE, Phase.ALBUM, Phase.IDLE],
};

/** @type {{ phase: string, session: object, listeners: Set<Function> }} */
const store = {
  phase: Phase.IDLE,
  session: freshSession(),
  listeners: new Set(),
};

export function freshSession(defaults = {}) {
  return {
    photoCount: defaults.photoCount ?? 3,
    countdownSeconds: defaults.countdownSeconds ?? 3,
    mirrorPreview: defaults.mirrorPreview ?? true,
    confettiOverlap: defaults.confettiOverlap !== false,
    filterId: defaults.filter ?? 'natural',
    formatId: defaults.formatId ?? '2x6',
    adjustments: { ...DEFAULT_ADJUSTMENTS },
    adjustmentsEnabled: false,
    templateId: defaults.templateId ?? 'anniversary-navy',
    deviceId: null,
    shots: [],
    composed: null,
    pngBase64: null,
    stickers: [],
    selectedStickerId: null,
    personalizeHistory: [],
    personalizeFuture: [],
    customizeTab: 'frame',
    safeBounds: false,
    printCopies: 1,
    capturing: false,
    albumSelectedIds: [],
    printMode: 'strip', // 'strip' | 'a4'
  };
}

export function getPhase() {
  return store.phase;
}

export function getSession() {
  return store.session;
}

export function subscribe(fn) {
  store.listeners.add(fn);
  return () => store.listeners.delete(fn);
}

function emit() {
  for (const fn of store.listeners) fn(store.phase, store.session);
}

export function canGo(to) {
  return (ALLOWED[store.phase] || []).includes(to);
}

export function go(to, { force = false } = {}) {
  if (!force && !canGo(to)) {
    console.warn(`Blocked phase jump ${store.phase} → ${to}`);
    return false;
  }
  store.phase = to;
  emit();
  return true;
}

export function patchSession(partial) {
  Object.assign(store.session, partial);
  emit();
}

export function resetSession(defaults = {}) {
  const keep = {
    photoCount: store.session.photoCount,
    countdownSeconds: store.session.countdownSeconds,
    mirrorPreview: store.session.mirrorPreview,
    confettiOverlap: store.session.confettiOverlap,
    deviceId: store.session.deviceId,
  };
  clearShotBuffers(store.session.shots);
  if (store.session.composed) {
    store.session.composed.width = 0;
    store.session.composed.height = 0;
  }
  store.session = {
    ...freshSession({ ...defaults, ...keep }),
    photoCount: keep.photoCount,
    countdownSeconds: keep.countdownSeconds,
    mirrorPreview: keep.mirrorPreview,
    confettiOverlap: keep.confettiOverlap,
    deviceId: keep.deviceId,
  };
  emit();
}

export function clearAll(defaults = {}) {
  clearShotBuffers(store.session.shots);
  if (store.session.composed) {
    store.session.composed.width = 0;
    store.session.composed.height = 0;
  }
  store.session = freshSession(defaults);
  store.phase = Phase.IDLE;
  emit();
}

function clearShotBuffers(shots) {
  if (!shots) return;
  for (const c of shots) {
    if (c) {
      c.width = 0;
      c.height = 0;
    }
  }
  shots.length = 0;
}

export { clearShotBuffers };
