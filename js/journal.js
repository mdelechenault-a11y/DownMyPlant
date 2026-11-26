// Journal de suivi par plante : arrosages, engrais, rempotages, notes,
// photos de suivi et diagnostics, réunis dans une même chronologie.

import { newId } from './db.js';
import { waterFactor, baseInterval, seasonContext } from './season.js';

export const EVENT_TYPES = {
  water: { icon: '💧', label: 'Arrosage' },
  fertilize: { icon: '🌱', label: 'Engrais' },
  repot: { icon: '🪴', label: 'Rempotage' },
  note: { icon: '📝', label: 'Note' },
  photo: { icon: '📷', label: 'Photo de suivi' },
};

export const todayIso = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

// Met à niveau une plante enregistrée par une version précédente de l'app.
export function normalizePlant(p) {
  if (!Array.isArray(p.events)) p.events = [];
  if (!Array.isArray(p.diagnoses)) p.diagnoses = [];
  if (p.lastWatered && !p.events.some((e) => e.type === 'water')) {
    p.events.push({ id: newId(), type: 'water', date: p.lastWatered, text: '', photo: null });
  }
  delete p.lastWatered;
  p.diagnoses.forEach((d) => { if (!d.id) d.id = newId(); });
  return p;
}

export function addEvent(plant, { type, date, text = '', photo = null }) {
  plant.events.push({ id: newId(), type, date: date || todayIso(), text, photo, createdAt: new Date().toISOString() });
}

export function removeEntry(plant, id) {
  plant.events = plant.events.filter((e) => e.id !== id);
  plant.diagnoses = plant.diagnoses.filter((d) => d.id !== id);
}

// Nombre de jours entre une date (AAAA-MM-JJ) et aujourd'hui.
export function daysSince(iso) {
  if (!iso) return null;
  const a = new Date(`${iso.slice(0, 10)}T12:00:00`);
  const b = new Date(`${todayIso()}T12:00:00`);
  return Math.round((b - a) / 86400000);
}

// Statistiques d'arrosage. « expected » est le rythme conseillé aujourd'hui :
// la moyenne de vos intervalles, ramenée à la saison actuelle (mode saison),
// ou un rythme par défaut selon la plante tant qu'il n'y a pas d'historique.
export function waterStats(plant, now = new Date()) {
  const dates = [...new Set(plant.events.filter((e) => e.type === 'water').map((e) => e.date.slice(0, 10)))].sort();
  const factorNow = waterFactor(plant, now);
  const fallback = Math.max(2, Math.round(baseInterval(plant) * factorNow));
  if (!dates.length) return { last: null, days: null, avg: null, count: 0, expected: fallback, learned: false };
  const last = dates[dates.length - 1];
  let avg = null;
  let expected = fallback;
  let learned = false;
  if (dates.length >= 2) {
    const recent = dates.slice(-6); // les 5 derniers intervalles
    const at = (iso) => new Date(`${iso}T12:00:00`);
    const span = (at(recent[recent.length - 1]) - at(recent[0])) / 86400000;
    avg = Math.round(span / (recent.length - 1));
    // Chaque intervalle est ramené au « rythme de printemps » selon le mois où il a eu lieu.
    let norm = 0;
    for (let i = 1; i < recent.length; i++) {
      const a = at(recent[i - 1]); const b = at(recent[i]);
      const mid = new Date((a.getTime() + b.getTime()) / 2);
      norm += (b - a) / 86400000 / waterFactor(plant, mid);
    }
    norm /= recent.length - 1;
    expected = Math.max(1, Math.round(norm * factorNow));
    learned = true;
  }
  return { last, days: daysSince(last), avg, count: dates.length, expected, learned };
}

export function lastEventDate(plant, type) {
  const d = plant.events.filter((e) => e.type === type).map((e) => e.date).sort();
  return d[d.length - 1] || null;
}

// Chronologie complète, du plus récent au plus ancien.
export function timeline(plant) {
  const items = [
    ...plant.events.map((e) => ({ ...e, kind: 'event', sortKey: `${e.date.slice(0, 10)}|${e.createdAt || ''}` })),
    ...plant.diagnoses.map((d) => ({ ...d, kind: 'diagnosis', sortKey: `${d.date.slice(0, 10)}|${d.date}` })),
  ];
  return items.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
}

// Résumé texte pour donner du contexte au diagnostic.
export function historySummary(plant) {
  const lines = [];
  const ws = waterStats(plant);
  if (ws.last) {
    lines.push(`Dernier arrosage : il y a ${ws.days} jour(s)${ws.avg ? `, en moyenne tous les ${ws.avg} jours` : ''}.`);
  }
  lines.push(seasonContext());
  const fert = lastEventDate(plant, 'fertilize');
  if (fert) lines.push(`Dernier engrais : il y a ${daysSince(fert)} jour(s).`);
  const repot = lastEventDate(plant, 'repot');
  if (repot) lines.push(`Dernier rempotage : il y a ${daysSince(repot)} jour(s).`);
  const notes = plant.events.filter((e) => e.type === 'note' && e.text).slice(-3);
  notes.forEach((n) => lines.push(`Note du ${n.date} : ${n.text}`));
  const lastDiag = plant.diagnoses[0];
  if (lastDiag?.result?.resume) {
    lines.push(`Diagnostic précédent (${lastDiag.date.slice(0, 10)}) : ${lastDiag.result.resume}`);
  }
  return lines.join('\n');
}

// --- Suivi photo -----------------------------------------------------------

// Toutes les photos d'une plante, de la plus ancienne à la plus récente :
// photo principale, photos du journal et photos des diagnostics.
export function photoHistory(plant) {
  const out = [];
  if (plant.photo) {
    out.push({ id: 'main', date: (plant.photoAt || plant.createdAt || new Date().toISOString()).slice(0, 10), blob: plant.photo, source: 'main' });
  }
  plant.events.filter((e) => e.photo).forEach((e) => out.push({
    id: e.id, date: e.date.slice(0, 10), blob: e.photo, source: 'event', text: e.text,
  }));
  plant.diagnoses.filter((d) => d.photo).forEach((d) => out.push({
    id: d.id, date: d.date.slice(0, 10), blob: d.photo, source: 'diagnosis', etat: d.result?.etat_general, evolution: d.result?.evolution,
  }));
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.source === 'main' ? -1 : 1));
}

// Photo de référence pour comparer un nouveau diagnostic : la plus récente
// prise il y a au moins `minDays` jours (sinon la plus ancienne disponible).
export function referencePhoto(plant, minDays = 7) {
  const all = photoHistory(plant);
  if (!all.length) return null;
  const old = all.filter((p) => daysSince(p.date) >= minDays);
  const ref = old.length ? old[old.length - 1] : null;
  if (!ref) return null;
  // Diagnostic fait à cette date ou juste avant : son résumé aide à comparer.
  const diag = plant.diagnoses.find((d) => d.date.slice(0, 10) <= ref.date && d.result?.resume);
  return { ...ref, diagnosis: diag || null };
}

// Jours depuis la dernière photo (null si aucune).
export function daysSinceLastPhoto(plant) {
  const all = photoHistory(plant);
  return all.length ? daysSince(all[all.length - 1].date) : null;
}
