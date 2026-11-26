// Journal de suivi par plante : arrosages, engrais, rempotages, notes,
// photos de suivi et diagnostics, réunis dans une même chronologie.

import { newId } from './db.js';

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

export function waterStats(plant) {
  const dates = [...new Set(plant.events.filter((e) => e.type === 'water').map((e) => e.date.slice(0, 10)))].sort();
  if (!dates.length) return { last: null, days: null, avg: null, count: 0 };
  const last = dates[dates.length - 1];
  let avg = null;
  if (dates.length >= 2) {
    const recent = dates.slice(-6); // les 5 derniers intervalles
    const span = (new Date(`${recent[recent.length - 1]}T12:00:00`) - new Date(`${recent[0]}T12:00:00`)) / 86400000;
    avg = Math.round(span / (recent.length - 1));
  }
  return { last, days: daysSince(last), avg, count: dates.length };
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
