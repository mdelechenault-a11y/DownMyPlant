// Réglages (clés API) stockés uniquement sur l'appareil.

const KEY = 'downmyplant.settings';

const DEFAULTS = {
  plantnetKey: '',
  anthropicKey: '',
};

export function getSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* stockage indisponible */ }
  return next;
}
