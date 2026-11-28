// Modèle de lumière d'une pièce et besoins en lumière des plantes.
// Tout est calculé sur l'appareil, sans appel réseau : la course du soleil
// vient de sun.js (ville choisie dans Réglages, Paris par défaut).

import { sunContext, fmtHourRound, fmtDuration } from './sun.js';
import { heatAt, heatSensitivity, heatPenalty } from './heat.js';
//
// Coordonnées du plan : mètres, x vers la droite, y vers le bas (comme le SVG).
// room.upBearing : direction (boussole, en degrés) vers laquelle regarde le haut du plan
// (0 = nord, 90 = est, 180 = sud, 270 = ouest).

// --- Géométrie -------------------------------------------------------------

export function edges(points) {
  return points.map((p, i) => [p, points[(i + 1) % points.length]]);
}

export function pointInPolygon([x, y], points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax; const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return { d: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t };
}

export function distToWalls(p, points) {
  return Math.min(...edges(points).map(([a, b]) => distToSegment(p, a, b).d));
}

// Point du mur le plus proche : { wall, t, d }.
export function nearestWall(p, points) {
  let best = { wall: 0, t: 0, d: Infinity };
  edges(points).forEach(([a, b], i) => {
    const r = distToSegment(p, a, b);
    if (r.d < best.d) best = { wall: i, t: r.t, d: r.d };
  });
  return best;
}

function segmentsCross(p1, p2, p3, p4) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1); const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3); const d4 = d(p1, p2, p4);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9))
    && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}

export function wallLength(points, i) {
  const [a, b] = edges(points)[i];
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

// Normale du mur i tournée vers l'extérieur de la pièce.
export function outwardNormal(points, i) {
  const [a, b] = edges(points)[i];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  let n = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
  const mid = [(a[0] + b[0]) / 2 + n[0] * 0.02, (a[1] + b[1]) / 2 + n[1] * 0.02];
  if (pointInPolygon(mid, points)) n = [-n[0], -n[1]];
  return n;
}

// Extrémités d'une fenêtre sur son mur.
export function windowEnds(room, w) {
  const [a, b] = edges(room.points)[w.wall];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const c = Math.max(w.width / 2, Math.min(len - w.width / 2, w.at));
  return [
    [a[0] + u[0] * (c - w.width / 2), a[1] + u[1] * (c - w.width / 2)],
    [a[0] + u[0] * (c + w.width / 2), a[1] + u[1] * (c + w.width / 2)],
  ];
}

// --- Orientation -----------------------------------------------------------

const DIRS = ['Nord', 'Nord-Est', 'Est', 'Sud-Est', 'Sud', 'Sud-Ouest', 'Ouest', 'Nord-Ouest'];
const DIRS_SHORT = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

export const COMPASS = DIRS_SHORT.map((s, i) => ({ short: s, label: DIRS[i], deg: i * 45 }));

export function bearingLabel(deg, short = false) {
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return short ? DIRS_SHORT[i] : DIRS[i];
}

// Cap (boussole) d'une direction du plan.
export function bearingOf([vx, vy], upBearing) {
  const a = (Math.atan2(vx, -vy) * 180) / Math.PI;
  return (((upBearing + a) % 360) + 360) % 360;
}

// Direction du plan qui pointe vers un cap donné (pour dessiner la boussole).
export function planVector(bearing, upBearing) {
  const a = ((bearing - upBearing) * Math.PI) / 180;
  return [Math.sin(a), -Math.cos(a)];
}

export function windowBearing(room, w) {
  return bearingOf(outwardNormal(room.points, w.wall), room.upBearing || 0);
}

// --- Soleil réel -------------------------------------------------------------
// Le calcul se fait pour un jour donné (aujourd'hui par défaut) : la vue Soleil
// peut choisir un autre jour (solstices) avec setSunDay().

const RAD = Math.PI / 180;
let sunDay = null; // null = aujourd'hui
export function setSunDay(day) { sunDay = day; }
export function currentSun() { return sunContext(sunDay || new Date()); }

const WINDOW_TOP = 2.1; // haut d'une fenêtre (m)
const SILL = { window: 0.9, french: 0 }; // hauteur d'allège
const PLANT_H = 0.5; // hauteur où l'on regarde la lumière (feuillage d'une plante en pot)

// Rayonnement direct reçu par une vitre verticale orientée `bearing`, sur la journée.
function windowDirect(bearing, samples) {
  let e = 0;
  for (const s of samples) {
    const c = Math.cos((s.az - bearing) * RAD);
    if (c <= 0) continue;
    const sinAlt = Math.max(0.05, Math.sin(s.alt * RAD));
    const trans = 0.7 ** ((1 / sinAlt) ** 0.678); // atténuation par l'atmosphère
    e += c * Math.cos(s.alt * RAD) * trans * s.hours;
  }
  return e;
}

// Référence : vitre plein sud à l'équinoxe, latitude 46° N (vaut 1 dans le modèle).
let refE = null;
function referenceDirect() {
  if (refE == null) {
    const phi = 46 * RAD; const samples = [];
    for (let h = -6; h <= 6; h += 1 / 3) {
      const H = h * 15 * RAD;
      const alt = Math.asin(Math.cos(phi) * Math.cos(H));
      if (alt <= 0.02) continue;
      const az = 180 + Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi)) / RAD;
      samples.push({ az, alt: alt / RAD, hours: 1 / 3 });
    }
    refE = windowDirect(180, samples) || 1;
  }
  return refE;
}

// Apport de lumière d'une fenêtre selon son orientation et la course du soleil du jour :
// 0,3 de lumière du ciel + la part de soleil direct (0,7 pour une vitre sud à l'équinoxe).
export function exposureFactor(bearing, sun = currentSun()) {
  return Math.min(1.4, 0.3 + 0.7 * (windowDirect(bearing, sun.samples) / referenceDirect()));
}

// Heures où le soleil touche la vitre, et plage horaire.
export function windowSun(bearing, sun = currentSun()) {
  let hours = 0; let from = null; let to = null;
  for (const s of sun.samples) {
    if (Math.cos((s.az - bearing) * RAD) > 0.08 && s.alt > 3) {
      hours += s.hours;
      if (!from) from = s.t;
      to = s.t;
    }
  }
  return { hours, from, to };
}

export function getsDirectSun(bearing, sun = currentSun()) {
  return windowSun(bearing, sun).hours >= 0.5;
}

// Le point p reçoit-il le soleil par cette fenêtre à cet instant ?
function sunThrough(room, win, p, s, walls) {
  if (s.alt < 2) return false;
  const { w, A, B, n } = win;
  const v = planVector(s.az, room.upBearing || 0); // direction du soleil sur le plan
  if (v[0] * n[0] + v[1] * n[1] <= 0.05) return false; // soleil derrière cette façade
  const ex = B[0] - A[0]; const ey = B[1] - A[1];
  const den = v[0] * ey - v[1] * ex;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((A[0] - p[0]) * ey - (A[1] - p[1]) * ex) / den; // distance jusqu'à la vitre
  const u = ((A[0] - p[0]) * v[1] - (A[1] - p[1]) * v[0]) / den; // position le long de la vitre
  if (t <= 0 || u < 0 || u > 1) return false;
  // Le rayon passe-t-il entre l'allège et le haut de la fenêtre ?
  const z = PLANT_H + t * Math.tan(s.alt * RAD);
  if (z > WINDOW_TOP || z < (SILL[w.type] ?? 0.9)) return false;
  const hit = [p[0] + v[0] * t, p[1] + v[1] * t];
  return !walls.some(([a, b], i) => i !== w.wall && segmentsCross(p, hit, a, b));
}

function windowsOf(room) {
  return (room.windows || []).map((w) => {
    const [A, B] = windowEnds(room, w);
    return { w, A, B, n: outwardNormal(room.points, w.wall) };
  });
}

// Soleil direct en un point sur la journée : { hours, from, to }.
export function sunAt(room, p, sun = currentSun()) {
  const walls = edges(room.points);
  const wins = windowsOf(room);
  let hours = 0; let from = null; let to = null;
  for (const s of sun.samples) {
    if (wins.some((win) => sunThrough(room, win, p, s, walls))) {
      hours += s.hours;
      if (!from) from = s.t;
      to = s.t;
    }
  }
  return { hours, from, to };
}

// Soleil direct en un point à un instant précis (pour la tache de soleil de la vue Soleil).
export function sunNowAt(room, p, s) {
  const walls = edges(room.points);
  return windowsOf(room).some((win) => sunThrough(room, win, p, s, walls));
}

export const WINDOW_TYPES = {
  window: { label: 'Fenêtre', width: 1.0, gain: 1 },
  french: { label: 'Porte-fenêtre', width: 1.6, gain: 1.35 },
};

// --- Lumière en un point ---------------------------------------------------

// Renvoie { level (≈ 0 à 1+), direct (≥ 1 h de soleil direct), sunHours, sunFrom, sunTo, main }.
export function lightAt(room, p, sun = currentSun()) {
  let level = 0; let main = null; let mainV = 0;
  const walls = edges(room.points);
  for (const w of room.windows || []) {
    const [A, B] = windowEnds(room, w);
    const nOut = outwardNormal(room.points, w.wall);
    const nIn = [-nOut[0], -nOut[1]];
    const bearing = bearingOf(nOut, room.upBearing || 0);
    const gain = exposureFactor(bearing, sun) * (WINDOW_TYPES[w.type]?.gain || 1);
    const N = 5;
    let v = 0; let minR = Infinity;
    for (let k = 0; k < N; k++) {
      const t = (k + 0.5) / N;
      const S = [A[0] + (B[0] - A[0]) * t + nIn[0] * 0.01, A[1] + (B[1] - A[1]) * t + nIn[1] * 0.01];
      const d = [p[0] - S[0], p[1] - S[1]];
      const r = Math.hypot(d[0], d[1]) || 0.01;
      const cos = (d[0] * nIn[0] + d[1] * nIn[1]) / r;
      if (cos <= 0) continue;
      // Un mur entre la fenêtre et le point (pièce en L) bloque la lumière.
      if (walls.some(([a, b], i) => i !== w.wall && segmentsCross(S, p, a, b))) continue;
      v += (cos * (w.width / N)) / (1 + (r / 1.2) ** 2);
      if (r < minR) minR = r;
    }
    v *= gain;
    level += v;
    if (v > mainV) { mainV = v; main = { window: w, bearing, distance: minR }; }
  }
  const sa = main ? sunAt(room, p, sun) : { hours: 0, from: null, to: null };
  return { level, direct: sa.hours >= 1, sunHours: sa.hours, sunFrom: sa.from, sunTo: sa.to, main };
}

export const LIGHT_LEVELS = [
  { key: 'ombre', min: 0, label: 'Ombre', short: 'Ombre' },
  { key: 'mi-ombre', min: 0.12, label: 'Mi-ombre', short: 'Mi-ombre' },
  { key: 'vive', min: 0.3, label: 'Lumière vive indirecte', short: 'Lumineux' },
  { key: 'soleil', min: 0.6, label: 'Très lumineux', short: 'Très lumineux' },
];

export function levelOf(value) {
  let out = LIGHT_LEVELS[0];
  for (const l of LIGHT_LEVELS) if (value >= l.min) out = l;
  return out;
}

export function describeSpot(room, p) {
  const info = lightAt(room, p);
  const { level, direct, main } = info;
  const lv = levelOf(level);
  let where = 'loin des fenêtres';
  if (main) {
    const d = main.distance;
    where = `à ${d < 1 ? `${Math.round(d * 100)} cm` : `${d.toFixed(1).replace('.', ',')} m`} d'une ${WINDOW_TYPES[main.window.type]?.label.toLowerCase() || 'fenêtre'} ${bearingLabel(main.bearing).toLowerCase()}`;
  }
  return { level, direct, lv, where, sun: sunText(info), sunHours: info.sunHours };
}

// « 2 h 30 de soleil direct, de 11 h à 13 h 30 » (pour le jour calculé).
export function sunText(info) {
  if (!info.sunHours || info.sunHours < 0.25) return 'pas de soleil direct';
  return `${fmtDuration(info.sunHours)} de soleil direct, de ${fmtHourRound(info.sunFrom)} à ${fmtHourRound(new Date(info.sunTo.getTime() + 20 * 60000))}`;
}

// --- Besoins des plantes ---------------------------------------------------

// Cible de lumière (même échelle que lightAt) et tolérance au soleil direct.
export const NEEDS = {
  soleil: { label: 'Plein soleil', target: 0.8, direct: 'aime' },
  vive: { label: 'Lumière vive, sans soleil brûlant', target: 0.45, direct: 'matin' },
  'mi-ombre': { label: 'Mi-ombre', target: 0.22, direct: 'non' },
  ombre: { label: 'Supporte l\'ombre', target: 0.13, direct: 'non' },
};

const GENUS_NEEDS = {
  soleil: [
    'aloe', 'echeveria', 'crassula', 'sedum', 'kalanchoe', 'opuntia', 'mammillaria', 'echinocactus', 'echinopsis',
    'cereus', 'euphorbia', 'agave', 'citrus', 'olea', 'lavandula', 'rosmarinus', 'salvia', 'pelargonium', 'hibiscus',
    'bougainvillea', 'jasminum', 'strelitzia', 'yucca', 'beaucarnea', 'cycas', 'portulacaria', 'ocimum', 'thymus',
    'capsicum', 'solanum', 'phoenix', 'graptopetalum', 'pachyphytum', 'sempervivum', 'gasteria', 'lithops',
    'adenium', 'pachypodium', 'nerium', 'punica', 'ficus carica', 'lantana', 'mandevilla', 'gardenia', 'cuphea',
  ],
  vive: [
    'ficus', 'monstera', 'pilea', 'hoya', 'haworthia', 'haworthiopsis', 'schefflera', 'heptapleurum', 'dracaena',
    'alocasia', 'anthurium', 'begonia', 'peperomia', 'dypsis', 'howea', 'musa', 'codiaeum', 'coffea',
    'phalaenopsis', 'orchis', 'dendrobium', 'oncidium', 'cattleya', 'tradescantia', 'ceropegia', 'senecio',
    'curio', 'chlorophytum', 'saintpaulia', 'streptocarpus', 'guzmania', 'vriesea', 'aechmea', 'tillandsia',
    'schlumbergera', 'oxalis', 'pachira', 'ravenea', 'livistona', 'platycerium', 'polyscias', 'cyperus',
    'philodendron', 'rhaphidophora', 'scindapsus', 'caladium', 'hypoestes', 'cissus', 'ctenanthe', 'radermachera',
    'rhapis', 'washingtonia', 'clivia', 'hippeastrum', 'euphorbia pulcherrima', 'jatropha', 'medinilla',
  ],
  'mi-ombre': [
    'epipremnum', 'syngonium', 'calathea', 'goeppertia', 'maranta', 'stromanthe', 'nephrolepis', 'asplenium',
    'adiantum', 'davallia', 'pteris', 'spathiphyllum', 'fittonia', 'dieffenbachia', 'rhipsalis', 'hedera',
    'fatsia', 'soleirolia', 'chamaedorea', 'sansevieria', 'dracaena trifasciata', 'aeschynanthus', 'columnea',
    'microsorum', 'phlebodium', 'nematanthus', 'pellaea', 'selaginella', 'helxine', 'ardisia',
  ],
  ombre: ['zamioculcas', 'aspidistra', 'aglaonema', 'rohdea', 'ophiopogon'],
};

// Renvoie { key, label, target, direct, source } pour une plante.
export function plantNeed(plant) {
  if (plant?.lightNeed && NEEDS[plant.lightNeed]) {
    return { key: plant.lightNeed, ...NEEDS[plant.lightNeed], source: 'choisi par vous' };
  }
  const sci = (plant?.scientificName || '').toLowerCase().trim();
  const fam = (plant?.family || '').toLowerCase();
  if (sci) {
    const two = sci.split(/\s+/).slice(0, 2).join(' ');
    const genus = sci.split(/\s+/)[0];
    for (const [key, list] of Object.entries(GENUS_NEEDS)) {
      if (list.includes(two)) return { key, ...NEEDS[key], source: `d'après l'espèce (${genus})` };
    }
    for (const [key, list] of Object.entries(GENUS_NEEDS)) {
      if (list.includes(genus)) return { key, ...NEEDS[key], source: `d'après l'espèce (${genus})` };
    }
  }
  if (fam === 'cactaceae') return { key: 'soleil', ...NEEDS.soleil, source: 'd\'après la famille (cactus)' };
  if (fam === 'crassulaceae') return { key: 'soleil', ...NEEDS.soleil, source: 'd\'après la famille (plante grasse)' };
  if (fam === 'marantaceae') return { key: 'mi-ombre', ...NEEDS['mi-ombre'], source: 'd\'après la famille' };
  if (fam === 'araceae') return { key: 'vive', ...NEEDS.vive, source: 'd\'après la famille' };
  if (/polypodiaceae|pteridaceae|aspleniaceae|nephrolepidaceae|dryopteridaceae/.test(fam)) {
    return { key: 'mi-ombre', ...NEEDS['mi-ombre'], source: 'd\'après la famille (fougère)' };
  }
  return { key: 'vive', ...NEEDS.vive, source: 'valeur par défaut, espèce inconnue', unknown: true };
}

// Ce que dit le dernier diagnostic sur la lumière : 'plus', 'moins' ou null.
// addressed = la plante a été déplacée depuis ce diagnostic (on garde alors
// sa nouvelle place comme référence au lieu de la repousser encore).
export function diagnosisLight(plant, placement) {
  const d = plant?.diagnoses?.[0];
  if (!d?.result) return null;
  const addressed = Boolean(placement?.movedAt && placement.movedAt > d.date);
  const ageDays = (Date.now() - new Date(d.date).getTime()) / 86400000;
  if (ageDays > 120) return null;
  const r = d.result;
  let dir = null;
  if (r.besoin_lumiere === 'plus' || r.besoin_lumiere === 'moins') dir = r.besoin_lumiere;
  else if (!r.besoin_lumiere) {
    const txt = `${r.lumiere || ''} ${(r.problemes || []).map((p) => `${p.nom} ${p.cause_probable}`).join(' ')}`.toLowerCase();
    if (/(manque de (lumi|clart)|plus de lumi|davantage de lumi|plus lumineu|lumi[eè]re insuffisante|étiol|etiol|rapproch)/.test(txt)) dir = 'plus';
    else if (/(trop de (soleil|lumi)|exc[eè]s de (soleil|lumi)|br[uû]l|coup de soleil|[ée]loign|à l'abri du soleil|moins de (soleil|lumi))/.test(txt)) dir = 'moins';
  }
  if (!dir) return null;
  return { dir, date: d.date, text: r.lumiere || '', addressed };
}

// --- Emplacement idéal -----------------------------------------------------

const POT_MARGIN = 0.25; // distance mini au mur (rayon d'un pot)
const PLANT_GAP = 0.5; // distance mini entre deux plantes

// Note un point pour une plante : plus c'est haut, mieux c'est.
// heatPen : pénalité due à un radiateur proche (voir heat.js).
function scoreFor(need, target, info, heatPen = 0) {
  let s = -heatPen - Math.abs(Math.log((info.level + 0.02) / (target + 0.02)));
  const h = info.sunHours || 0;
  if (need.direct === 'non' && h > 0.5) s -= 0.6 * Math.min(1, h / 3);
  if (need.direct === 'matin' && info.direct) {
    // Soleil du matin toléré, soleil chaud de l'après-midi à éviter.
    s -= info.sunTo && info.sunTo.getHours() >= 14 ? 0.35 : 0.1;
  }
  if (!info.direct && need.direct === 'aime') s -= 0.2;
  return s;
}

// Lumière cible : besoin de l'espèce, corrigé par le dernier diagnostic.
export function targetFor(room, plant, current, placement) {
  const need = plantNeed(plant);
  const diag = diagnosisLight(plant, placement);
  let target = need.target;
  let why = `Besoin : ${need.label.toLowerCase()}`;
  if (diag?.addressed && current) {
    target = diag.dir === 'plus' ? Math.max(need.target, current.level) : Math.min(need.target, current.level);
  } else if (diag) {
    const base = current ? Math.max(current.level, 0.05) : need.target;
    target = diag.dir === 'plus' ? Math.max(base * 1.7, base + 0.12) : Math.min(base * 0.55, base - 0.08);
    target = Math.max(0.06, Math.min(1.2, target));
    why = diag.dir === 'plus'
      ? 'Le dernier diagnostic conseille plus de lumière'
      : 'Le dernier diagnostic conseille moins de lumière ou de soleil direct';
  }
  return { need, diag, target, why };
}

// Cherche le meilleur endroit libre de la pièce pour une plante
// (lumière + éloignement des radiateurs selon la sensibilité de l'espèce).
export function suggestSpot(room, plant, { ignoreId } = {}) {
  const placed = (room.plants || []).filter((pl) => pl.plantId !== ignoreId);
  const mine = (room.plants || []).find((pl) => pl.plantId === (ignoreId || plant.id));
  const current = mine ? lightAt(room, [mine.x, mine.y]) : null;
  const { need, diag, target, why } = targetFor(room, plant, current, mine);
  const sens = heatSensitivity(plant);
  const hasRad = (room.radiators || []).length > 0;
  const penAt = (p) => (hasRad ? heatPenalty(sens, heatAt(room, p)) : 0);
  const xs = room.points.map((p) => p[0]); const ys = room.points.map((p) => p[1]);
  const step = 0.1;
  let best = null;
  for (let x = Math.min(...xs) + POT_MARGIN; x <= Math.max(...xs) - POT_MARGIN + 1e-6; x += step) {
    for (let y = Math.min(...ys) + POT_MARGIN; y <= Math.max(...ys) - POT_MARGIN + 1e-6; y += step) {
      const p = [x, y];
      if (!pointInPolygon(p, room.points) || distToWalls(p, room.points) < POT_MARGIN - 1e-6) continue;
      if (placed.some((pl) => Math.hypot(pl.x - x, pl.y - y) < PLANT_GAP)) continue;
      if (blocksFrenchWindow(room, p)) continue;
      const info = lightAt(room, p);
      const heatPen = penAt(p);
      const s = scoreFor(need, target, info, heatPen) - (mine ? Math.hypot(mine.x - x, mine.y - y) * 0.01 : 0);
      if (!best || s > best.score) best = { x: round(x), y: round(y), score: s, info, heatPen };
    }
  }
  if (!best) return null;
  const curPen = mine ? penAt([mine.x, mine.y]) : 0;
  const currentScore = current ? scoreFor(need, target, current, curPen) : null;
  // Le déplacement est-il surtout dû au radiateur ?
  const lightGain = current ? scoreFor(need, target, best.info) - scoreFor(need, target, current) : 0;
  const heatGain = curPen - best.heatPen;
  const heatDriven = hasRad && heatGain > 0.15 && heatGain >= lightGain;
  return {
    ...best, need, diag, target, current, sens, heatDriven,
    why: heatDriven && !diag ? 'Trop près d\'un radiateur pour cette plante' : why,
    gain: currentScore == null ? null : best.score - currentScore,
    spot: describeSpot(room, [best.x, best.y]),
  };
}

// Évalue la place actuelle : 'good' | 'warn' | 'bad'.
export function fitAt(room, plant, placement) {
  const p = [placement.x, placement.y];
  const info = lightAt(room, p);
  const need = plantNeed(plant);
  const diag = diagnosisLight(plant, placement);
  const heat = (room.radiators || []).length ? heatAt(room, p) : null;
  const heatPen = heat ? heatPenalty(heatSensitivity(plant), heat) : 0;
  const tooHot = heatPen > 0.3;
  if (diag && !diag.addressed) return { status: 'warn', info, need, diag, heat, heatPen, tooHot };
  const target = diag ? (diag.dir === 'plus' ? Math.max(need.target, info.level) : Math.min(need.target, info.level)) : need.target;
  const s = scoreFor(need, target, info, heatPen);
  return { status: s > -0.45 ? 'good' : s > -0.95 ? 'warn' : 'bad', info, need, diag, heat, heatPen, tooHot };
}

// Garde un passage libre devant les portes-fenêtres.
function blocksFrenchWindow(room, p) {
  return (room.windows || []).some((w) => {
    if (w.type !== 'french') return false;
    const [A, B] = windowEnds(room, w);
    const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    const n = outwardNormal(room.points, w.wall);
    const d = [p[0] - mid[0], p[1] - mid[1]];
    const depth = -(d[0] * n[0] + d[1] * n[1]);
    const side = Math.abs(d[0] * n[1] - d[1] * n[0]);
    return depth >= 0 && depth < 0.9 && side < Math.min(0.45, w.width / 3);
  });
}

const round = (v) => Math.round(v * 100) / 100;
