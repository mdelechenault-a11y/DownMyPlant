// Lulu vivante : humeur selon l'état du jardin, séries d'arrosage et badges.
// Tout est calculé à partir du journal ; seuls les badges déjà vus et le record
// de série sont gardés sur l'appareil (localStorage).

import { waterStats, daysSince, todayIso, photoHistory } from './journal.js';
import { waterFactor, seasonOf, seasonEnabled } from './season.js';
import { fitAt } from './light.js';

const STORE = 'downmyplant.lulu';

function loadStore() {
  try { return { seen: [], best: 0, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch { return { seen: [], best: 0 }; }
}
function saveStore(st) {
  try { localStorage.setItem(STORE, JSON.stringify(st)); } catch { /* ignoré */ }
}

const DAY = 86400000;
const at = (iso) => new Date(`${iso.slice(0, 10)}T12:00:00`);
const plantName = (p) => p.nickname || p.commonName || p.scientificName || 'Ta plante';

// --- Séries d'arrosage -------------------------------------------------------

// Délai toléré entre deux arrosages à une date donnée (rythme de la plante, saison comprise),
// avec la même règle que le « Soif ? » de l'accueil.
function allowedGap(plant, ws, date) {
  const base = ws.expected / waterFactor(plant);
  return Math.max(1, Math.round(base * waterFactor(plant, date))) + (ws.learned ? 0 : 1);
}

// Arrosages à temps d'affilée pour une plante (le plus récent compris).
export function plantStreak(plant) {
  const ws = waterStats(plant);
  const dates = [...new Set(plant.events.filter((e) => e.type === 'water').map((e) => e.date.slice(0, 10)))].sort();
  if (!dates.length) return 0;
  if (ws.days > allowedGap(plant, ws, new Date())) return 0; // en retard en ce moment
  let n = 1;
  for (let i = dates.length - 1; i > 0; i--) {
    const gap = (at(dates[i]) - at(dates[i - 1])) / DAY;
    if (gap > allowedGap(plant, ws, at(dates[i - 1]))) break;
    n += 1;
  }
  return n;
}

// Série du jardin : nombre de jours d'affilée (jusqu'à aujourd'hui) sans aucune plante assoiffée.
export function gardenStreak(plants) {
  const today = at(todayIso());
  let lastBad = null; // dernier jour où une plante était en retard
  let start = null; // premier arrosage noté (avant, on ne sait rien)
  for (const p of plants) {
    const ws = waterStats(p);
    const dates = [...new Set(p.events.filter((e) => e.type === 'water').map((e) => e.date.slice(0, 10)))].sort();
    if (!dates.length) continue;
    if (!start || at(dates[0]) < start) start = at(dates[0]);
    const ends = [...dates.slice(1).map(at), new Date(today.getTime() + DAY)];
    dates.forEach((d, i) => {
      const from = at(d);
      const allowed = allowedGap(p, ws, from);
      const firstLate = new Date(from.getTime() + (allowed + 1) * DAY);
      const lastLate = new Date(ends[i].getTime() - DAY); // la veille de l'arrosage suivant
      if (firstLate <= lastLate && firstLate <= today) {
        const end = lastLate > today ? today : lastLate;
        if (!lastBad || end > lastBad) lastBad = end;
      }
    });
  }
  if (!start) return 0;
  const from = lastBad ? new Date(lastBad.getTime() + DAY) : start;
  return Math.max(0, Math.round((today - from) / DAY) + 1);
}

// --- Badges ------------------------------------------------------------------

const BADGES = [
  { id: 'premiere', icon: 'sprout', color: 'var(--ok)', title: 'Première pousse', text: 'Ajouter une première plante', goal: 1, value: (d) => d.plants.length },
  { id: 'jardin', icon: 'leaf', color: 'var(--ok)', title: 'Petit jardin', text: 'Avoir 5 plantes', goal: 5, value: (d) => d.plants.length },
  { id: 'jungle', icon: 'leaf', color: 'var(--accent)', title: 'Jungle urbaine', text: 'Avoir 10 plantes', goal: 10, value: (d) => d.plants.length },
  { id: 'serie7', icon: 'flame', color: 'var(--warn)', title: 'Une semaine au top', text: '7 jours sans plante assoiffée', goal: 7, value: (d) => d.best },
  { id: 'serie30', icon: 'flame', color: 'var(--bad)', title: 'Main verte', text: '30 jours sans plante assoiffée', goal: 30, value: (d) => d.best },
  { id: 'arrosoir', icon: 'drop', color: 'var(--water)', title: 'Arrosoir d\'or', text: 'Noter 50 arrosages', goal: 50, value: (d) => d.waterings },
  { id: 'docteur', icon: 'heart', color: 'var(--primary)', title: 'Docteur Lulu', text: 'Faire un premier diagnostic', goal: 1, value: (d) => d.diagnoses },
  { id: 'remise', icon: 'sparkle', color: 'var(--primary)', title: 'Remise en forme', text: 'Un diagnostic qui dit « va mieux »', goal: 1, value: (d) => d.better },
  { id: 'photographe', icon: 'camera', color: 'var(--lilac)', title: 'Photographe', text: 'Prendre 10 photos de suivi', goal: 10, value: (d) => d.photos },
  { id: 'architecte', icon: 'home', color: 'var(--warn)', title: 'Architecte', text: 'Dessiner une pièce avec sa fenêtre', goal: 1, value: (d) => d.roomsWithWindows },
  { id: 'placees', icon: 'star', color: 'var(--warn)', title: 'Chacune à sa place', text: '3 plantes bien placées dans vos pièces', goal: 3, value: (d) => d.wellPlaced },
  { id: 'saisons', icon: 'sun', color: 'var(--accent)', title: 'Quatre saisons', text: 'Suivre une plante pendant un an', goal: 365, value: (d) => d.oldest, unit: 'jours' },
];

function gardenData(plants, rooms) {
  const byId = new Map(plants.map((p) => [p.id, p]));
  let wellPlaced = 0;
  for (const r of rooms) {
    if (!(r.windows || []).length) continue;
    for (const pl of r.plants || []) {
      const p = byId.get(pl.plantId);
      if (p && fitAt(r, p, pl).status === 'good') wellPlaced += 1;
    }
  }
  const streak = gardenStreak(plants);
  const store = loadStore();
  const best = Math.max(store.best || 0, streak);
  if (best !== store.best) { store.best = best; saveStore(store); }
  return {
    plants,
    streak,
    best,
    waterings: plants.reduce((a, p) => a + p.events.filter((e) => e.type === 'water').length, 0),
    diagnoses: plants.reduce((a, p) => a + p.diagnoses.length, 0),
    better: plants.reduce((a, p) => a + p.diagnoses.filter((d) => d.result?.evolution === 'mieux').length, 0),
    photos: plants.reduce((a, p) => a + Math.max(0, photoHistory(p).length - (p.photo ? 1 : 0)), 0),
    roomsWithWindows: rooms.filter((r) => (r.windows || []).length).length,
    wellPlaced,
    oldest: plants.reduce((a, p) => Math.max(a, daysSince(p.createdAt) || 0), 0),
  };
}

export function badges(data) {
  return BADGES.map((b) => {
    const v = b.value(data);
    return { ...b, current: Math.min(v, b.goal), earned: v >= b.goal };
  });
}

// Badges gagnés depuis la dernière visite (et les marque comme vus).
function newBadges(list) {
  const store = loadStore();
  const seen = new Set(store.seen);
  const fresh = list.filter((b) => b.earned && !seen.has(b.id));
  if (fresh.length) {
    store.seen = [...seen, ...fresh.map((b) => b.id)];
    saveStore(store);
  }
  return fresh;
}

// --- Humeur ------------------------------------------------------------------

// État de Lulu pour l'accueil : { mood, title, text, streak, best, badges, fresh }.
export function luluState(plants, rooms = [], { now = new Date(), markSeen = true } = {}) {
  const data = gardenData(plants, rooms);
  const list = badges(data);
  // Au tout premier passage, les badges déjà mérités ne font pas la fête.
  const firstVisit = !loadStore().seen.length && !localStorage.getItem(`${STORE}.init`);
  if (firstVisit) {
    try { localStorage.setItem(`${STORE}.init`, '1'); } catch { /* ignoré */ }
  }
  const fresh = markSeen ? newBadges(list) : [];
  const shownFresh = firstVisit ? [] : fresh;
  const thirsty = plants.filter((p) => {
    const ws = waterStats(p);
    return ws.last && ws.days > ws.expected + (ws.learned ? 0 : 1);
  });
  const sick = plants.filter((p) => {
    const d = p.diagnoses[0];
    return d?.result?.etat_general === 'mauvais' && daysSince(d.date) <= 30;
  });
  const wateredToday = plants.filter((p) => p.events.some((e) => e.type === 'water' && e.date.slice(0, 10) === todayIso())).length;
  const h = now.getHours();
  const base = { streak: data.streak, best: data.best, badges: list, fresh: shownFresh, data };

  if (shownFresh.length) {
    return { ...base, mood: 'party', title: 'Youpi, un badge !', text: `Tu as gagné « ${shownFresh[0].title} ». ${shownFresh[0].text}, bravo !` };
  }
  if (sick.length) {
    return { ...base, mood: 'sad', title: 'Oh non…', text: `${plantName(sick[0])} ne va pas fort. On regarde ses conseils ensemble ?`, target: sick[0].id };
  }
  if (thirsty.length) {
    const shown = thirsty.slice(0, 2).map(plantName);
    const more = thirsty.length - shown.length;
    const names = more ? `${shown.join(', ')} et ${more} autre${more > 1 ? 's' : ''}` : shown.join(' et ');
    return {
      ...base,
      mood: 'worried',
      title: thirsty.length > 1 ? `${thirsty.length} plantes ont soif` : 'Quelqu\'un a soif !',
      text: `${names} ${thirsty.length > 1 ? 'attendent' : 'attend'} un peu d'eau.${data.streak >= 3 ? ` Ne casse pas ta série de ${data.streak} jours !` : ''}`,
      target: thirsty.length === 1 ? thirsty[0].id : null,
    };
  }
  if (h >= 22 || h < 6) {
    return { ...base, mood: 'sleepy', title: 'Bonne nuit…', text: 'Tout le monde a bu, le jardin dort. On se retrouve demain ?' };
  }
  if ([7, 14, 30, 60, 100, 365].includes(data.streak)) {
    return { ...base, mood: 'party', title: `${data.streak} jours de suite !`, text: 'Aucune plante n\'a eu soif depuis tout ce temps. Tu es incroyable.' };
  }
  if (wateredToday && wateredToday === plants.length && plants.length > 1) {
    return { ...base, mood: 'party', title: 'Tournée générale !', text: 'Toutes tes plantes ont été arrosées aujourd\'hui.' };
  }
  const season = seasonEnabled() ? {
    hiver: 'C\'est l\'hiver : tes plantes se reposent, j\'ai espacé leurs arrosages.',
    printemps: 'C\'est le printemps : tout se réveille, on arrose un peu plus souvent.',
    ete: 'C\'est l\'été : tes plantes boivent plus, je surveille !',
    automne: 'Les jours raccourcissent : j\'espace doucement les arrosages.',
  }[seasonOf(now)] : 'Belle journée au jardin !';
  return {
    ...base,
    mood: 'happy',
    title: h < 12 ? 'Bonjour !' : h < 18 ? 'Coucou !' : 'Bonsoir !',
    text: data.streak >= 2 ? `${data.streak} jours sans plante assoiffée. ${season}` : `Tout le monde a l'air bien hydraté. ${season}`,
  };
}

// Petites phrases quand on touche Lulu.
const TIPS = [
  'Arrose le matin : la terre a le temps de sécher avant la nuit.',
  'Une eau à température ambiante, c\'est plus doux pour les racines.',
  'Glisse un doigt dans la terre : si elle est sèche sur 2 cm, c\'est le moment.',
  'Les feuilles poussiéreuses captent moins la lumière : un coup d\'éponge douce !',
  'Tourne tes pots d\'un quart de tour de temps en temps.',
  'Trop d\'eau tue plus de plantes que pas assez.',
  'Un pot sans trou, c\'est une piscine pour les racines.',
  'Les plantes adorent être regroupées : elles gardent l\'humidité entre elles.',
  'Une feuille jaune de temps en temps, c\'est normal. Plusieurs d\'un coup, on regarde !',
  'Une photo par mois, et tu verras ta plante grandir.',
];
let tipIndex = Math.floor(Math.random() * TIPS.length);
export function nextTip() {
  tipIndex = (tipIndex + 1) % TIPS.length;
  return TIPS[tipIndex];
}
