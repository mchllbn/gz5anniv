/**
 * Setup-phase helpers (Phase 1 — no capture timer).
 */

import { getConfig } from './config.js';
import { getSession, patchSession } from './app.js';
import { templatesForFormatCount, pickDefaultTemplate } from './frames.js';

export function setupSummary(session = getSession()) {
  return `${session.photoCount} photo${session.photoCount === 1 ? '' : 's'} · ${session.countdownSeconds}s timer`;
}

export function canBegin(session = getSession()) {
  return (
    !!session.photoCount &&
    !!session.countdownSeconds &&
    templatesForFormatCount(session.formatId || '2x6', session.photoCount).length > 0
  );
}

export function applyPhotoCount(n) {
  patchSession({ photoCount: n });
  const tpl = pickDefaultTemplate(getSession().formatId || '2x6', n, getSession().templateId);
  if (tpl) patchSession({ templateId: tpl.id });
}

export function defaultSetupFromConfig() {
  const d = getConfig().defaults || {};
  return {
    formatId: d.formatId || '2x6',
    photoCount: d.photoCount ?? 3,
    countdownSeconds: d.countdownSeconds ?? 3,
    mirrorPreview: d.mirrorPreview !== false,
    confettiOverlap: false,
    filterId: d.filter || 'natural',
    templateId: d.templateId || 'anniversary-navy',
  };
}
