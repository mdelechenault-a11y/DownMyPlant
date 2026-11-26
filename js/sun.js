// Course réelle du soleil (calcul astronomique, sans réseau), lieu de l'utilisateur
// et météo du jour (Open-Meteo : gratuit, sans clé).

import { getSettings, saveSettings } from './settings.js';

const RAD = Math.PI / 180;

// Lieu par défaut tant que l'utilisateur n'a pas choisi sa ville.
export const DEFAULT_PLACE = { lat: 48.86, lon: 2.35, name: 'Paris', isDefault: true };

export function getPlace() {
  const p = getSettings().place;
  return p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? p : DEFAULT_PLACE;
}

export function setPlace(place) {
  saveSettings({ place: { lat: round2(place.lat), lon: round2(place.lon), name: place.name || '' } });
  try { localStorage.removeItem(WEATHER_KEY); } catch { /* ignoré */ }
}

const round2 = (v) => Math.round(v * 100) / 100;

// --- Position du soleil ------------------------------------------------------
// Formules de l'Astronomical Almanac (précision de l'ordre du degré, largement suffisante ici).

function toDays(date) { return date.getTime() / 86400000 - 10957.5; } // jours depuis J2000

// Renvoie { az, alt } en degrés : az = cap boussole (0 = nord, 90 = est), alt = hauteur au-dessus de l'horizon.
export function sunPosition(date, lat, lon) {
  const d = toDays(date);
  const M = (357.5291 + 0.98560028 * d) * RAD; // anomalie moyenne
  const C = (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) * RAD;
  const L = M + C + 102.9372 * RAD + Math.PI; // longitude écliptique
  const e = 23.4397 * RAD;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const sidereal = (280.16 + 360.9856235 * d) * RAD + lon * RAD;
  const H = sidereal - ra; // angle horaire
  const phi = lat * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  // Azimut compté depuis le sud, converti en cap depuis le nord.
  const azS = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { az: ((azS / RAD + 180) % 360 + 360) % 360, alt: alt / RAD };
}

// Positions du soleil au cours d'une journée (heure locale de l'appareil),
// toutes les `stepMin` minutes, quand il est au-dessus de l'horizon.
export function daySamples(day, lat, lon, stepMin = 20) {
  const start = new Date(day); start.setHours(0, 0, 0, 0);
  const out = [];
  for (let m = stepMin / 2; m < 24 * 60; m += stepMin) {
    const t = new Date(start.getTime() + m * 60000);
    const { az, alt } = sunPosition(t, lat, lon);
    if (alt > 1) out.push({ t, az, alt, hours: stepMin / 60 });
  }
  return out;
}

// Contexte de calcul de la lumière pour un jour donné (mis en cache).
let cache = { key: '', ctx: null };
export function sunContext(day = new Date()) {
  const place = getPlace();
  const d = new Date(day); d.setHours(12, 0, 0, 0);
  const key = `${place.lat},${place.lon},${d.toDateString()}`;
  if (cache.key === key) return cache.ctx;
  const samples = daySamples(d, place.lat, place.lon);
  const ctx = { key, day: d, place, samples, sunrise: samples[0]?.t || null, sunset: samples[samples.length - 1]?.t || null };
  cache = { key, ctx };
  return ctx;
}

// Jours de référence pour la vue Soleil.
export function referenceDay(kind) {
  const now = new Date();
  const south = getPlace().lat < 0;
  if (kind === 'summer') return new Date(now.getFullYear(), south ? 11 : 5, 21, 12);
  if (kind === 'winter') return new Date(now.getFullYear(), south ? 5 : 11, 21, 12);
  return now;
}

export function fmtHour(t) {
  if (!t) return '';
  const h = t.getHours(); const m = t.getMinutes();
  return `${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`;
}

// Arrondi au quart d'heure pour l'affichage des plages de soleil.
export function fmtHourRound(t) {
  if (!t) return '';
  const q = new Date(Math.round(t.getTime() / 900000) * 900000);
  return fmtHour(q);
}

export function fmtDuration(hours) {
  const total = Math.round(hours * 4) / 4;
  const h = Math.floor(total); const m = Math.round((total - h) * 60);
  if (!h) return `${m} min`;
  return `${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`;
}

// --- Ville et météo (Open-Meteo, gratuit et sans clé) ---------------------------

export async function searchCity(name) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=fr&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Recherche impossible pour le moment.');
  const data = await res.json();
  return (data.results || []).map((r) => ({
    lat: r.latitude, lon: r.longitude, name: r.name,
    detail: [r.admin1, r.country].filter(Boolean).join(', '),
  }));
}

// Position du téléphone, arrondie à environ 1 km.
export function locateMe() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Localisation indisponible sur cet appareil.')); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: round2(pos.coords.latitude), lon: round2(pos.coords.longitude) }),
      () => reject(new Error('Localisation refusée. Autorisez-la dans Réglages → Confidentialité, ou tapez votre ville.')),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 3600000 },
    );
  });
}

const WEATHER_KEY = 'downmyplant.weather';

// Prévisions sur 3 jours : soleil (heures), températures, type de temps. Cache de 3 h.
export async function weather() {
  const place = getPlace();
  try {
    const c = JSON.parse(localStorage.getItem(WEATHER_KEY) || 'null');
    if (c && c.key === `${place.lat},${place.lon}` && Date.now() - c.at < 3 * 3600000) return c.data;
  } catch { /* ignoré */ }
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}`
    + '&daily=sunshine_duration,temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=3';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Météo indisponible.');
  const j = await res.json();
  const data = (j.daily?.time || []).map((date, i) => ({
    date,
    sunHours: (j.daily.sunshine_duration[i] || 0) / 3600,
    tmax: j.daily.temperature_2m_max[i],
    tmin: j.daily.temperature_2m_min[i],
    code: j.daily.weather_code[i],
  }));
  try { localStorage.setItem(WEATHER_KEY, JSON.stringify({ key: `${place.lat},${place.lon}`, at: Date.now(), data })); } catch { /* ignoré */ }
  return data;
}

export function weatherLabel(code) {
  if (code === 0) return 'grand soleil';
  if (code <= 2) return 'éclaircies';
  if (code === 3) return 'couvert';
  if (code <= 48) return 'brouillard';
  if (code <= 67 || (code >= 80 && code <= 82)) return 'pluie';
  if (code <= 77 || code === 85 || code === 86) return 'neige';
  return 'orages';
}
