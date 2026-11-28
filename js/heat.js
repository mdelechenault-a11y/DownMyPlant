// Radiateurs : chaleur et air sec autour d'une source de chauffage, selon la
// saison de chauffe, la distance et la sensibilité de chaque espèce.
//
// Modèle (ordres de grandeur pour un radiateur d'environ 1000 W) :
// - contre le radiateur, l'air au niveau du feuillage est ~8 °C plus chaud que
//   la pièce ; l'écart diminue avec la distance (÷ 2,5 environ tous les 50 cm) :
//   ~+3 °C à 50 cm, ~+1 °C à 1 m, négligeable au-delà de 1,5 m ;
// - l'humidité relative baisse d'environ 6 % par degré gagné (même quantité
//   d'eau dans un air plus chaud) : 40 % dans la pièce, ~25 % contre le radiateur ;
// - la terre sèche plus vite : ~5 % d'évaporation en plus par degré.
// L'effet est multiplié par l'intensité de la saison de chauffe (mois de l'année).

import { getSettings } from './settings.js';
import { edges, distToSegment, windowEnds, plantNeed } from './light.js';

export const RADIATOR_TYPES = {
  radiator: { label: 'Radiateur', k: 1, width: 0.8, hint: 'à eau ou électrique à inertie' },
  convector: { label: 'Convecteur', k: 1.25, width: 0.6, hint: 'électrique, souffle de l\'air chaud et très sec' },
};

export const RADIATOR_POWER = {
  low: { label: 'Doux', k: 0.6 },
  mid: { label: 'Moyen', k: 1 },
  high: { label: 'Fort', k: 1.4 },
};

const DT0 = 8; // °C de plus contre un radiateur moyen
const DECAY = 0.55; // m : distance pour diviser l'écart par e (≈ 2,7)
const ROOM_RH = 40; // % d'humidité d'une pièce chauffée
const RH_PER_DEG = 0.065;
const OFF_SEASON_WEIGHT = 0.35; // hors saison : on garde un peu d'effet pour préparer l'hiver

// Intensité du chauffage, mois par mois (hémisphère nord, janvier = 0).
const HEATING = [1, 1, 0.75, 0.35, 0.05, 0, 0, 0, 0.05, 0.4, 0.85, 1];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export function heatingSeason(date = new Date()) {
  const m = date.getMonth();
  const pm = getSettings().hemisphere === 'south' ? (m + 6) % 12 : m;
  const f = HEATING[pm];
  const on = f >= 0.3;
  // Coefficient retenu pour choisir l'emplacement : jamais nul, pour qu'une
  // plante bien placée l'été ne se retrouve pas collée au radiateur à l'automne.
  const weight = Math.max(f, OFF_SEASON_WEIGHT);
  return { factor: f, weight, on, month: MONTHS[m] };
}

function radiatorStrength(r) {
  const t = RADIATOR_TYPES[r.type] || RADIATOR_TYPES.radiator;
  const p = RADIATOR_POWER[r.power] || RADIATOR_POWER.mid;
  const w = Math.max(0.85, Math.min(1.35, 0.75 + 0.3 * (r.width || 0.8)));
  return t.k * p.k * w;
}

// Écart de température « plein hiver » à une distance d d'un radiateur.
export function deltaAt(d, strength = 1) {
  return DT0 * strength * Math.exp(-Math.max(0, d) / DECAY);
}

// Distance où un radiateur donne encore `deg` °C de plus (pour les zones dessinées).
export function radiusFor(deg, r) {
  const s = DT0 * radiatorStrength(r);
  return s <= deg ? 0 : DECAY * Math.log(s / deg);
}

export function humidityFor(dT) {
  return ROOM_RH * Math.exp(-RH_PER_DEG * Math.max(0, dT));
}

// Combien plus souvent arroser (en %), pour un écart de température donné.
export function wateringBoost(dT) {
  return Math.round((Math.exp(0.05 * Math.max(0, dT)) - 1) * 100);
}

export function effectLabel(dT) {
  if (dT < 0.7) return { key: 'none', label: 'négligeable' };
  if (dT < 1.8) return { key: 'low', label: 'léger' };
  if (dT < 3.5) return { key: 'mid', label: 'modéré' };
  return { key: 'high', label: 'fort' };
}

// Chaleur reçue en un point de la pièce.
// full = plein hiver, now = aujourd'hui, eff = valeur retenue pour le placement.
export function heatAt(room, p, date = new Date()) {
  const rads = room.radiators || [];
  const season = heatingSeason(date);
  if (!rads.length) return { full: 0, now: 0, eff: 0, dist: Infinity, radiator: null, season };
  const walls = edges(room.points);
  let full = 0; let dist = Infinity; let radiator = null;
  for (const r of rads) {
    if (!walls[r.wall]) continue;
    const [A, B] = windowEnds(room, r);
    const d = distToSegment(p, A, B).d;
    full += deltaAt(d, radiatorStrength(r));
    if (d < dist) { dist = d; radiator = r; }
  }
  full = Math.min(12, full);
  return { full, now: full * season.factor, eff: full * season.weight, dist, radiator, season };
}

// --- Sensibilité des espèces ------------------------------------------------

export const SENSITIVITY = {
  high: {
    k: 1, label: 'forte',
    why: 'aime l\'air humide et frais : près d\'un radiateur, le bord des feuilles sèche et les araignées rouges s\'installent',
  },
  mid: {
    k: 0.6, label: 'moyenne',
    why: 'supporte un peu de chaleur, mais l\'air sec fait jaunir ou tomber des feuilles et la terre sèche vite',
  },
  low: {
    k: 0.25, label: 'faible',
    why: 'supporte bien l\'air sec',
  },
};

const SUCCULENTS = [
  'aloe', 'echeveria', 'crassula', 'sedum', 'kalanchoe', 'haworthia', 'haworthiopsis', 'gasteria', 'lithops',
  'opuntia', 'mammillaria', 'echinocactus', 'echinopsis', 'cereus', 'agave', 'sempervivum', 'graptopetalum',
  'pachyphytum', 'portulacaria', 'adenium', 'pachypodium', 'euphorbia',
];

const GENUS_SENS = {
  high: [
    'calathea', 'goeppertia', 'maranta', 'stromanthe', 'ctenanthe', 'nephrolepis', 'adiantum', 'asplenium',
    'davallia', 'pteris', 'platycerium', 'microsorum', 'phlebodium', 'pellaea', 'selaginella', 'soleirolia',
    'helxine', 'fittonia', 'alocasia', 'caladium', 'hedera', 'fatsia', 'cyclamen', 'rhododendron', 'gardenia',
    'schlumbergera', 'hypoestes', 'medinilla', 'nepenthes', 'dionaea', 'sarracenia', 'drosera', 'aeschynanthus',
    'columnea', 'nematanthus', 'cyperus', 'pilea cadierei', 'spathiphyllum',
  ],
  low: [
    ...SUCCULENTS, 'sansevieria', 'dracaena trifasciata',
    'zamioculcas', 'yucca', 'beaucarnea', 'aspidistra', 'senecio', 'curio', 'ceropegia', 'hoya', 'cycas',
  ],
};

const SUCC_HINT = ', mais un hiver trop chaud l\'empêche de se reposer (pousse molle, pas de fleurs)';

// Renvoie { key, k, label, why, source } pour une plante.
export function heatSensitivity(plant) {
  const sci = (plant?.scientificName || '').toLowerCase().trim();
  const fam = (plant?.family || '').toLowerCase();
  const two = sci.split(/\s+/).slice(0, 2).join(' ');
  const genus = sci.split(/\s+/)[0];
  const out = (key, source) => {
    const s = { key, ...SENSITIVITY[key], source };
    const succ = key === 'low' && (/cactaceae|crassulaceae/.test(fam) || SUCCULENTS.includes(genus));
    return succ ? { ...s, why: s.why + SUCC_HINT } : s;
  };
  if (sci) {
    if (two === 'euphorbia pulcherrima') return out('mid', 'd\'après l\'espèce');
    for (const key of ['high', 'low']) if (GENUS_SENS[key].includes(two)) return out(key, `d'après l'espèce (${genus})`);
    for (const key of ['high', 'low']) if (GENUS_SENS[key].includes(genus)) return out(key, `d'après l'espèce (${genus})`);
  }
  if (/marantaceae|ericaceae|primulaceae|gesneriaceae/.test(fam)) return out('high', 'd\'après la famille');
  if (/polypodiaceae|pteridaceae|aspleniaceae|nephrolepidaceae|dryopteridaceae|davalliaceae/.test(fam)) return out('high', 'd\'après la famille (fougère)');
  if (/cactaceae|crassulaceae|asphodelaceae/.test(fam)) return out('low', 'd\'après la famille (plante grasse)');
  if (sci) {
    const need = plantNeed(plant).key;
    if (need === 'mi-ombre') return out('high', 'plante de sous-bois');
    if (need === 'ombre') return out('low', 'plante robuste');
  }
  return out('mid', sci ? 'valeur moyenne' : 'valeur par défaut, espèce inconnue');
}

// Pénalité de placement (même échelle que la note de lumière).
// ~0,8 pour une plante très sensible à 40 cm d'un radiateur en plein hiver.
export function heatPenalty(sens, heat) {
  return Math.min(2, sens.k * (heat.eff / 5));
}

// --- Textes ---------------------------------------------------------------

const fmtDist = (d) => (d < 1 ? `${Math.max(5, Math.round(d * 20) * 5)} cm` : `${d.toFixed(1).replace('.', ',')} m`);
export const fmtDeg = (v) => `+${v < 2 ? v.toFixed(1).replace('.', ',') : Math.round(v)}\u00a0°C`;

// Description pour une plante à cet endroit, ou null si aucun radiateur n'a d'effet.
export function heatText(room, p, plant, date = new Date()) {
  const h = heatAt(room, p, date);
  if (!h.radiator || h.full < 0.7) return null;
  const sens = plant ? heatSensitivity(plant) : null;
  const label = RADIATOR_TYPES[h.radiator.type]?.label.toLowerCase() || 'radiateur';
  const where = `à ${fmtDist(h.dist)} d'un ${label}`;
  const winter = `${fmtDeg(h.full)} et ~${Math.round(humidityFor(h.full))} % d'humidité en plein hiver (au lieu de ${ROOM_RH} %)`;
  const now = h.season.on
    ? `Aujourd'hui (${h.season.month}) : ${fmtDeg(h.now)}, arrosage ~${wateringBoost(h.now)} % plus fréquent`
    : `Chauffage arrêté en ${h.season.month} : effet à prévoir dès l'automne`;
  return {
    ...h, sens, where, winter, now,
    effect: effectLabel(h.full),
    penalty: sens ? heatPenalty(sens, h) : 0,
    short: `${where}, ${fmtDeg(h.full)} en hiver`,
  };
}

// Tableau distance → effet pour un radiateur donné (plein hiver).
export function heatTable(r = { type: 'radiator', power: 'mid', width: 0.8 }) {
  const s = radiatorStrength(r);
  return [0.2, 0.5, 1, 1.5].map((d) => {
    const dT = deltaAt(d, s);
    return { d, label: fmtDist(d), dT, rh: Math.round(humidityFor(dT)), water: wateringBoost(dT), effect: effectLabel(dT) };
  });
}

export const ROOM_HUMIDITY = ROOM_RH;
