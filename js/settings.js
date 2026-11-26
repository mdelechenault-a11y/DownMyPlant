// Réglages (clés API) stockés uniquement sur l'appareil.

const KEY = 'downmyplant.settings';

const DEFAULTS = {
  plantnetKey: '',
  anthropicKey: '',
  theme: 'light', // light | dark | auto
  seasonMode: true, // rythme d'arrosage et conseils selon la saison
  hemisphere: 'north', // north | south
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
