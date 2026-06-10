// CondX — settings persistence (localStorage)
import { DEFAULT_SETTINGS } from './config.js';

const KEY = 'condx.settings.v1';

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {}
  return s;
}
