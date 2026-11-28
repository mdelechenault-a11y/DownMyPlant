// Module « Pièces » : plan des pièces de la maison, fenêtres, orientation,
// placement des plantes par glisser-déposer et suggestion d'emplacement idéal.

import { listRooms, getRoom, saveRoom, deleteRoom, listPlants, getPlant, savePlant, newId } from './db.js';
import { blobUrl } from './image.js';
import { icon, plantArt, luluSays } from './ui.js';
import {
  edges, pointInPolygon, nearestWall, wallLength, outwardNormal, windowEnds, windowBearing, bearingLabel,
  planVector, COMPASS, WINDOW_TYPES, lightAt, levelOf, describeSpot, plantNeed, NEEDS, suggestSpot, fitAt,
  getsDirectSun, setSunDay, currentSun, windowSun, sunNowAt,
} from './light.js';
import {
  RADIATOR_TYPES, RADIATOR_POWER, heatingSeason, radiusFor, heatText, heatTable, heatSensitivity, fmtDeg,
  ROOM_HUMIDITY,
} from './heat.js';
import {
  getPlace, referenceDay, fmtHourRound, fmtDuration, weather, weatherLabel,
} from './sun.js';

let ctx; // { view, setHeader, go, toast, esc }
const esc = (s) => ctx.esc(s);

export function initRooms(context) { ctx = context; }

// --- Utilitaires -----------------------------------------------------------

const snap = (v, s = 0.05) => Math.round(v / s) * s;
const r2 = (v) => Math.round(v * 100) / 100;
const fmtM = (v) => `${(Math.round(v * 10) / 10).toFixed(1).replace('.', ',')} m`;
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
const plantName = (p) => p?.nickname || p?.commonName || p?.scientificName || 'Plante';

const EXPOSURE_TEXT = {
  N: 'lumière douce, jamais de soleil direct',
  NE: 'un peu de soleil tôt le matin',
  E: 'soleil doux le matin',
  SE: 'soleil le matin et en fin de matinée',
  S: 'soleil une grande partie de la journée',
  SO: "soleil l'après-midi, chaud en été",
  O: "soleil en fin d'après-midi, chaud en été",
  NO: "un peu de soleil en fin de journée l'été",
};

const STATUS = {
  good: { cls: 'good', label: 'Bien placée' },
  warn: { cls: 'warn', label: 'À revoir' },
  bad: { cls: 'bad', label: 'Mal placée' },
};

export function rectPoints(w, l) { return [[0, 0], [w, 0], [w, l], [0, l]]; }
function lPoints(w, l) {
  const cw = r2(w * 0.55); const cl = r2(l * 0.55);
  return [[0, 0], [w, 0], [w, cl], [cw, cl], [cw, l], [0, l]];
}

function bounds(points) {
  const xs = points.map((p) => p[0]); const ys = points.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function area(points) {
  let a = 0;
  edges(points).forEach(([p, q]) => { a += p[0] * q[1] - q[0] * p[1]; });
  return Math.abs(a / 2);
}

function selfIntersects(points) {
  const es = edges(points);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < es.length; i++) {
    for (let j = i + 1; j < es.length; j++) {
      if (j === i + 1 || (i === 0 && j === es.length - 1)) continue;
      const [p1, p2] = es[i]; const [p3, p4] = es[j];
      const d1 = cross(p3, p4, p1); const d2 = cross(p3, p4, p2);
      const d3 = cross(p1, p2, p3); const d4 = cross(p1, p2, p4);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    }
  }
  return false;
}

// Rattache chaque fenêtre et chaque radiateur au mur le plus proche après un
// changement de forme. `centers` vient de windowCenters() (fenêtres puis radiateurs).
function reattachWindows(room, centers) {
  const attach = (w, c) => {
    const nw = nearestWall(c, room.points);
    const len = wallLength(room.points, nw.wall);
    const width = Math.min(w.width, Math.max(0.3, len - 0.1));
    return { ...w, wall: nw.wall, width, at: Math.max(width / 2, Math.min(len - width / 2, nw.t * len)) };
  };
  const nw = room.windows.length;
  room.windows = room.windows.map((w, i) => attach(w, centers[i]));
  room.radiators = (room.radiators || []).map((r, i) => attach(r, centers[nw + i]));
}

function windowCenters(room) {
  return [...room.windows, ...(room.radiators || [])].map((w) => {
    const [A, B] = windowEnds(room, w);
    return [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  });
}

function exposureText(bearing) {
  return EXPOSURE_TEXT[bearingLabel(bearing, true)];
}

// Lieu d'une plante dans la maison (utile au diagnostic et à la fiche).
export async function placementOf(plantId) {
  const rooms = await listRooms();
  for (const room of rooms) {
    const pl = (room.plants || []).find((x) => x.plantId === plantId);
    if (pl) {
      const spot = (room.windows || []).length ? describeSpot(room, [pl.x, pl.y]) : null;
      const ht = heatText(room, [pl.x, pl.y], null);
      const heat = ht ? `, ${ht.where} (${ht.season.on ? `chauffage allumé en ce moment, environ ${fmtDeg(ht.now)} et air plus sec` : 'chauffage éteint en ce moment'})` : '';
      return {
        room,
        text: (spot ? `${room.name}, ${spot.where} (${spot.lv.label.toLowerCase()}, ${spot.sun} aujourd'hui)` : room.name) + heat,
      };
    }
  }
  return null;
}

// Retire une plante supprimée de toutes les pièces.
export async function forgetPlant(plantId) {
  for (const room of await listRooms()) {
    if ((room.plants || []).some((x) => x.plantId === plantId)) {
      room.plants = room.plants.filter((x) => x.plantId !== plantId);
      await saveRoom(room);
    }
  }
}

// --- Mini-plan (liste des pièces) -----------------------------------------

function miniPlan(room) {
  const b = bounds(room.points);
  const pad = 0.3;
  const vb = `${b.x0 - pad} ${b.y0 - pad} ${b.x1 - b.x0 + pad * 2} ${b.y1 - b.y0 + pad * 2}`;
  const poly = room.points.map((p) => p.join(',')).join(' ');
  const wins = (room.windows || []).map((w) => {
    const [A, B] = windowEnds(room, w);
    return `<line x1="${A[0]}" y1="${A[1]}" x2="${B[0]}" y2="${B[1]}" class="mp-win"/>`;
  }).join('');
  const dots = (room.plants || []).map((p) => `<circle cx="${p.x}" cy="${p.y}" r="0.22" class="mp-plant"/>`).join('');
  return `<svg class="mini-plan" viewBox="${vb}" aria-hidden="true"><polygon points="${poly}" class="mp-room"/>${wins}${dots}</svg>`;
}

// --- Liste des pièces ------------------------------------------------------

const newRoomDraft = { open: false, name: '', shape: 'rect', w: 4, l: 3.5, up: 0 };

export async function renderRooms() {
  ctx.setHeader('Mes pièces');
  const [rooms, plants] = await Promise.all([listRooms(), listPlants()]);
  const byId = new Map(plants.map((p) => [p.id, p]));
  const placed = new Set(rooms.flatMap((r) => (r.plants || []).map((p) => p.plantId)));
  const d = newRoomDraft;

  const cards = rooms.map((room) => {
    const toFix = (room.plants || []).filter((pl) => {
      const p = byId.get(pl.plantId);
      return p && (room.windows || []).length && fitAt(room, p, pl).status !== 'good';
    }).length;
    const n = (room.plants || []).length; const nw = (room.windows || []).length;
    return `
      <button class="room-card" data-id="${esc(room.id)}">
        ${miniPlan(room)}
        <div class="room-meta">
          <div class="room-name">${esc(room.name)}</div>
          <div class="muted small">${n} plante${n > 1 ? 's' : ''} · ${nw} ouverture${nw > 1 ? 's' : ''} · ${fmtM(Math.sqrt(area(room.points)) ** 2).replace(' m', ' m²')}</div>
          ${!nw ? '<span class="badge warn">Ajoutez les fenêtres</span>'
            : toFix ? `<span class="badge warn">${toFix} plante${toFix > 1 ? 's' : ''} à revoir</span>`
              : n ? '<span class="badge good">Tout est bien placé</span>' : ''}
        </div>
      </button>`;
  }).join('');

  const unplaced = plants.filter((p) => !placed.has(p.id)).length;

  ctx.view.innerHTML = `
    ${rooms.length ? `<div class="room-list">${cards}</div>` : `
      ${luluSays('Dessinons ta maison !', 'Crée tes pièces, place les fenêtres et tes plantes : je calcule la lumière de chaque coin et je te montre la meilleure place pour chacune.')}`}
    ${rooms.length && unplaced ? `<p class="muted small" style="margin-top:12px">${unplaced} plante${unplaced > 1 ? 's' : ''} pas encore placée${unplaced > 1 ? 's' : ''} dans une pièce.</p>` : ''}
    ${d.open ? `
      <div class="card new-room">
        <h2>Nouvelle pièce</h2>
        <label for="nr-name">Nom</label>
        <input type="text" id="nr-name" value="${esc(d.name)}" placeholder="Ex. : Salon, Chambre, Cuisine">
        <label>Forme</label>
        <div class="chips" id="nr-shape">
          ${[['rect', 'Rectangle'], ['L', 'En L'], ['draw', 'Je la dessine']].map(([k, l]) => `<button class="chip ${d.shape === k ? 'active' : ''}" data-v="${k}">${l}</button>`).join('')}
        </div>
        ${d.shape !== 'draw' ? `
        <div class="dims">
          <div><label for="nr-w">Largeur (m)</label><input type="number" inputmode="decimal" step="0.1" min="1" max="30" id="nr-w" value="${d.w}"></div>
          <div><label for="nr-l">Longueur (m)</label><input type="number" inputmode="decimal" step="0.1" min="1" max="30" id="nr-l" value="${d.l}"></div>
        </div>` : '<p class="muted small" style="margin-top:8px">Vous toucherez le quadrillage pour poser chaque angle de la pièce.</p>'}
        <label>Le haut du plan regarde vers…</label>
        <div class="chips" id="nr-up">
          ${COMPASS.map((c) => `<button class="chip ${d.up === c.deg ? 'active' : ''}" data-v="${c.deg}">${c.label}</button>`).join('')}
        </div>
        <p class="muted small" style="margin-top:6px">Pas sûr ? Vous pourrez le mesurer avec la boussole du téléphone ensuite.</p>
        <div class="btn-row">
          <button class="btn secondary" id="nr-cancel">Annuler</button>
          <button class="btn" id="nr-create">Créer la pièce</button>
        </div>
      </div>` : `<div style="margin-top:16px"><button class="btn" id="nr-open">${icon('plus', 20)} Nouvelle pièce</button></div>`}`;

  ctx.view.querySelectorAll('.room-card').forEach((el) => {
    el.onclick = () => ctx.go(`#/room/${encodeURIComponent(el.dataset.id)}`);
  });
  const q = (s) => ctx.view.querySelector(s);
  const keep = () => {
    d.name = q('#nr-name')?.value ?? d.name;
    d.w = parseFloat(String(q('#nr-w')?.value ?? d.w).replace(',', '.')) || d.w;
    d.l = parseFloat(String(q('#nr-l')?.value ?? d.l).replace(',', '.')) || d.l;
  };
  if (q('#nr-open')) q('#nr-open').onclick = () => { d.open = true; d.name = rooms.length ? '' : 'Salon'; renderRooms(); };
  if (!d.open) return;
  q('#nr-cancel').onclick = () => { d.open = false; renderRooms(); };
  ctx.view.querySelectorAll('#nr-shape .chip').forEach((c) => { c.onclick = () => { keep(); d.shape = c.dataset.v; renderRooms(); }; });
  ctx.view.querySelectorAll('#nr-up .chip').forEach((c) => { c.onclick = () => { keep(); d.up = Number(c.dataset.v); renderRooms(); }; });
  q('#nr-create').onclick = async () => {
    keep();
    const w = Math.min(30, Math.max(1, d.w)); const l = Math.min(30, Math.max(1, d.l));
    const room = {
      id: newId(),
      name: d.name.trim() || `Pièce ${rooms.length + 1}`,
      createdAt: new Date().toISOString(),
      points: d.shape === 'L' ? lPoints(w, l) : rectPoints(w, l),
      upBearing: d.up,
      windows: [],
      plants: [],
    };
    await saveRoom(room);
    const startDrawing = d.shape === 'draw';
    Object.assign(d, { open: false, name: '', shape: 'rect' });
    pageState = freshState(room.id);
    if (startDrawing) { pageState.mode = 'shape'; pageState.drawing = []; } else pageState.mode = 'windows';
    pageState.justCreated = true;
    ctx.go(`#/room/${encodeURIComponent(room.id)}`);
  };
}

// --- Page d'une pièce ------------------------------------------------------

let pageState = null;

function freshState(roomId) {
  return {
    roomId, room: null, plants: new Map(), rooms: [], mode: 'plants', showLight: true,
    sel: null, // { kind: 'plant'|'window'|'rad'|'vertex', id }
    addRad: 'radiator', addPower: 'mid', showHeat: true,
    addType: 'window', drawing: null, suggestion: null, heat: null, heatKey: '', vb: null,
    sunDay: 'today', sunMin: null, // vue Soleil : jour (today|summer|winter) et heure (minutes)
  };
}

const MODES = [
  ['plants', 'leaf', 'Plantes'],
  ['shape', 'shape', 'Forme'],
  ['windows', 'window', 'Fenêtres'],
  ['heat', 'radiator', 'Chauffage'],
  ['sun', 'sun', 'Soleil'],
];

export async function renderRoom(id) {
  if (!pageState || pageState.roomId !== id) pageState = freshState(id);
  const st = pageState;
  // Un dessin en cours n'est gardé que juste après « Créer la pièce ».
  if (!st.justCreated) st.drawing = null;
  st.justCreated = false;
  const [room, plants, rooms] = await Promise.all([getRoom(id), listPlants(), listRooms()]);
  if (!room) { ctx.go('#/rooms'); return; }
  room.windows = room.windows || []; room.plants = room.plants || []; room.radiators = room.radiators || [];
  // Plantes supprimées entre-temps.
  const ids = new Set(plants.map((p) => p.id));
  if (room.plants.some((pl) => !ids.has(pl.plantId))) {
    room.plants = room.plants.filter((pl) => ids.has(pl.plantId));
    saveRoom(room);
  }
  st.room = room; st.rooms = rooms;
  st.plants = new Map(plants.map((p) => [p.id, p]));
  ctx.setHeader(room.name, '#/rooms');

  ctx.view.innerHTML = `
    <div class="room-page">
      <div class="seg" role="tablist">
        ${MODES.map(([k, ic, l]) => `<button class="seg-btn ${st.mode === k ? 'active' : ''}" data-mode="${k}" role="tab" aria-selected="${st.mode === k}">${icon(ic, 18)}<span>${l}</span></button>`).join('')}
      </div>
      <div class="plan-card">
        <svg id="plan" class="plan" xmlns="http://www.w3.org/2000/svg"></svg>
        <div class="plan-hint" id="plan-hint"></div>
      </div>
      <div id="room-panel"></div>
    </div>`;

  ctx.view.querySelectorAll('.seg-btn').forEach((b) => {
    b.onclick = () => {
      st.mode = b.dataset.mode; st.sel = null; st.suggestion = null; st.drawing = null;
      renderRoom(st.roomId);
    };
  });
  bindPlan();
  draw();
}

function save() { return saveRoom(pageState.room); }

// --- Dessin du plan --------------------------------------------------------

function computeViewBox() {
  const st = pageState;
  if (st.drawing) return { x: -0.5, y: -0.5, w: 11, h: 9 };
  const b = bounds(st.room.points);
  const pad = st.mode === 'sun' ? 1.45 : 0.75;
  return { x: b.x0 - pad, y: b.y0 - pad, w: b.x1 - b.x0 + pad * 2, h: b.y1 - b.y0 + pad * 2 };
}

function heatmap() {
  const st = pageState; const room = st.room;
  const key = JSON.stringify([room.points, room.windows, room.upBearing, currentSun().key]);
  if (st.heatKey === key) return st.heat;
  const b = bounds(room.points);
  const step = 0.2; const cells = [];
  for (let x = b.x0; x < b.x1; x += step) {
    for (let y = b.y0; y < b.y1; y += step) {
      const c = [x + step / 2, y + step / 2];
      if (!pointInPolygon(c, room.points)) continue;
      const { level, direct } = lightAt(room, c);
      const o = Math.max(0, Math.min(1, (level - 0.06) / 0.8));
      if (o < 0.03 && !direct) continue;
      cells.push(`<rect x="${r2(x)}" y="${r2(y)}" width="${step}" height="${step}" class="${direct ? 'heat-sun' : 'heat'}" fill-opacity="${(direct ? 0.4 + o * 0.3 : 0.08 + o * 0.75).toFixed(2)}"/>`);
    }
  }
  st.heat = cells.join(''); st.heatKey = key;
  return st.heat;
}

// panel = false : ne redessine que le plan (pendant un glisser depuis le bandeau,
// le bandeau ne doit pas être reconstruit sous le doigt).
function draw(panel = true) {
  const st = pageState;
  const svg = document.getElementById('plan');
  if (!svg) return;
  setSunDay(st.mode === 'sun' && st.sunDay !== 'today' ? referenceDay(st.sunDay) : null);
  if (!st.vb || !st.dragging) st.vb = computeViewBox();
  const vb = st.vb;
  svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  svg.innerHTML = st.drawing ? drawingSvg() : planSvg();
  const hint = document.getElementById('plan-hint');
  if (hint) hint.textContent = hintText();
  if (panel) renderPanel();
}

function hintText() {
  const st = pageState;
  if (st.drawing) return st.drawing.length < 3 ? 'Touchez le quadrillage pour poser les angles de la pièce.' : 'Touchez le premier point (ou « Terminer ») pour fermer la pièce.';
  switch (st.mode) {
    case 'shape': return 'Faites glisser les angles. Touchez un ＋ pour ajouter un angle.';
    case 'windows': return 'Touchez un mur pour ajouter une ouverture, puis faites-la glisser.';
    case 'heat': return 'Touchez un mur pour ajouter un radiateur, puis faites-le glisser.';
    case 'sun': return '';
    default: return st.room.plants.length ? 'Glissez une bulle pour la déplacer, touchez-la pour un conseil.' : '';
  }
}

function compassSvg(cx, cy, size) {
  const up = pageState.room.upBearing || 0;
  const [nx, ny] = planVector(0, up);
  const tip = [cx + nx * size * 0.8, cy + ny * size * 0.8];
  const tail = [cx - nx * size * 0.55, cy - ny * size * 0.55];
  const side = [-ny * size * 0.22, nx * size * 0.22];
  const lab = [cx + nx * size * 1.25, cy + ny * size * 1.25];
  return `<g class="compass">
    <circle cx="${cx}" cy="${cy}" r="${size}" class="compass-bg"/>
    <polygon points="${tip.join(',')} ${cx + side[0]},${cy + side[1]} ${tail.join(',')} ${cx - side[0]},${cy - side[1]}" class="compass-needle"/>
    <text x="${lab[0]}" y="${lab[1]}" class="compass-n" font-size="${size * 0.6}">N</text>
  </g>`;
}

function windowSvg(room, w, selected) {
  const [A, B] = windowEnds(room, w);
  const n = outwardNormal(room.points, w.wall);
  const inw = [-n[0], -n[1]];
  let extra = '';
  if (w.type === 'french') {
    const h = w.width / 2;
    const m = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    const sweep = (P, M) => {
      const Q = [P[0] + inw[0] * h, P[1] + inw[1] * h];
      const cr = (M[0] - P[0]) * inw[1] - (M[1] - P[1]) * inw[0];
      return `<line x1="${P[0]}" y1="${P[1]}" x2="${Q[0]}" y2="${Q[1]}" class="door-leaf"/>
        <path d="M ${Q[0]} ${Q[1]} A ${h} ${h} 0 0 ${cr > 0 ? 1 : 0} ${M[0]} ${M[1]}" class="door-arc"/>`;
    };
    extra = sweep(A, m) + sweep(B, m);
  }
  return `<g data-hit="win:${w.id}" class="win ${selected ? 'sel' : ''}">
    ${extra}
    <line x1="${A[0]}" y1="${A[1]}" x2="${B[0]}" y2="${B[1]}" class="win-glass"/>
    <line x1="${A[0]}" y1="${A[1]}" x2="${B[0]}" y2="${B[1]}" class="win-pane"/>
    <line x1="${A[0]}" y1="${A[1]}" x2="${B[0]}" y2="${B[1]}" class="hit-line"/>
  </g>`;
}

// Radiateur : bloc à ailettes posé contre le mur, côté pièce.
function radiatorSvg(room, r, selected) {
  const [A, B] = windowEnds(room, r);
  const n = outwardNormal(room.points, r.wall);
  const i = [-n[0], -n[1]];
  const at = (P, d) => [r2(P[0] + i[0] * d), r2(P[1] + i[1] * d)];
  const a1 = at(A, 0.08); const b1 = at(B, 0.08); const b2 = at(B, 0.22); const a2 = at(A, 0.22);
  const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const fins = [];
  const nf = Math.max(2, Math.round(len / 0.12));
  for (let k = 1; k < nf; k++) {
    const t = k / nf;
    const P = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
    const p1 = at(P, 0.1); const p2 = at(P, 0.2);
    fins.push(`<line x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}" class="rad-fin"/>`);
  }
  return `<g data-hit="rad:${r.id}" class="rad ${selected ? 'sel' : ''}">
    <polygon points="${[a1, b1, b2, a2].map((p) => p.join(',')).join(' ')}" class="rad-body"/>
    ${fins.join('')}
    <line x1="${at(A, 0.15)[0]}" y1="${at(A, 0.15)[1]}" x2="${at(B, 0.15)[0]}" y2="${at(B, 0.15)[1]}" class="hit-line"/>
  </g>`;
}

// Zones de chaleur autour des radiateurs : +1 °C, +3 °C, +5 °C.
// winter = true : effet en plein hiver (onglet Chauffage), sinon effet retenu
// pour le placement (saison de chauffe, jamais nul).
function heatZonesSvg(room, winter) {
  const k = winter ? 1 : heatingSeason().weight;
  const parts = [];
  [[1, 'hz1'], [3, 'hz2'], [5, 'hz3']].forEach(([deg, cls]) => {
    room.radiators.forEach((r) => {
      const rad = radiusFor(deg / k, r);
      if (rad <= 0.02) return;
      const [A, B] = windowEnds(room, r);
      parts.push(`<line x1="${r2(A[0])}" y1="${r2(A[1])}" x2="${r2(B[0])}" y2="${r2(B[1])}" stroke-width="${r2(rad * 2)}" class="hz ${cls}"/>`);
    });
  });
  return `<g clip-path="url(#roomclip)" class="heat-zones">${parts.join('')}</g>`;
}

function heatLegend(winter) {
  return `<div class="light-legend heat-legend">
    <span><i class="lg hz-l1"></i>+1 °C</span><span><i class="lg hz-l2"></i>+3 °C</span><span><i class="lg hz-l3"></i>+5 °C</span>
    <span class="muted">${winter ? 'en plein hiver' : 'près des radiateurs'}</span>
  </div>`;
}

function plantMarker(pl, plant, status, extraCls = '') {
  const r = 0.27;
  const img = plant?.photo
    ? `<image href="${blobUrl(plant.photo)}" x="${-r}" y="${-r}" width="${r * 2}" height="${r * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#pclip)"/>`
    : `<circle r="${r}" class="pm-ph"/>${plantArt(plant?.id || '', plant?.scientificName || '').replace('<svg class="plant-art"', `<svg class="plant-art" x="${-r * 0.85}" y="${-r * 0.9}" width="${r * 1.7}" height="${r * 1.7}"`)}`;
  return `<g data-hit="plant:${esc(pl.plantId)}" class="pm ${status || ''} ${extraCls}" transform="translate(${pl.x} ${pl.y})">
    <circle r="${r + 0.07}" class="pm-ring"/>
    ${img}
    <text class="pm-label" y="${r + 0.26}" font-size="0.17">${esc(plantName(plant).slice(0, 16))}</text>
  </g>`;
}

// Échantillon du soleil le plus proche de l'heure choisie dans la vue Soleil.
function sunSample() {
  const st = pageState; const sun = currentSun();
  if (!sun.samples.length) return null;
  if (st.sunMin == null) {
    const now = new Date();
    const m = now.getHours() * 60 + now.getMinutes();
    const first = sun.samples[0].t; const last = sun.samples[sun.samples.length - 1].t;
    const fm = first.getHours() * 60 + first.getMinutes(); const lm = last.getHours() * 60 + last.getMinutes();
    st.sunMin = st.sunDay === 'today' && m >= fm && m <= lm ? m : Math.round((fm + lm) / 2 / 10) * 10;
  }
  let best = sun.samples[0];
  for (const x of sun.samples) {
    const xm = x.t.getHours() * 60 + x.t.getMinutes();
    const bm = best.t.getHours() * 60 + best.t.getMinutes();
    if (Math.abs(xm - st.sunMin) < Math.abs(bm - st.sunMin)) best = x;
  }
  return best;
}

function sunCourseSvg() {
  const st = pageState; const room = st.room; const sun = currentSun();
  const b = bounds(room.points);
  const c = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  const rx = (b.x1 - b.x0) / 2 + 0.6; const ry = (b.y1 - b.y0) / 2 + 0.6;
  const at = (az) => { const v = planVector(az, room.upBearing || 0); return [c[0] + v[0] * rx, c[1] + v[1] * ry]; };
  const parts = [];
  // Tache de soleil à l'instant choisi.
  const s = sunSample();
  if (s && room.windows.length) {
    const step = 0.1; const cells = [];
    for (let x = b.x0; x < b.x1; x += step) {
      for (let y = b.y0; y < b.y1; y += step) {
        const p = [x + step / 2, y + step / 2];
        if (pointInPolygon(p, room.points) && sunNowAt(room, p, s)) cells.push(`<rect x="${r2(x)}" y="${r2(y)}" width="${step + 0.005}" height="${step + 0.005}"/>`);
      }
    }
    parts.push(`<g class="sun-patch" clip-path="url(#roomclip)" shape-rendering="crispEdges">${cells.join('')}</g>`);
  }
  // Arc : un point par heure, avec l'heure de lever, de midi et de coucher.
  const pts = sun.samples.filter((x, i) => i % 3 === 0);
  if (pts.length > 1) parts.push(`<polyline class="sun-path" points="${pts.map((x) => at(x.az).map(r2).join(',')).join(' ')}"/>`);
  if (sun.samples.length) {
    const first = sun.samples[0]; const last = sun.samples[sun.samples.length - 1];
    const noon = sun.samples.reduce((a, x) => (x.alt > a.alt ? x : a));
    [[first, 'lever'], [noon, 'midi'], [last, 'coucher']].forEach(([x, l]) => {
      const p = at(x.az);
      // Étiquette poussée vers l'extérieur de la pièce pour ne pas chevaucher le plan.
      const v = planVector(x.az, room.upBearing || 0);
      const lp = [p[0] + v[0] * 0.42, p[1] + v[1] * 0.3];
      parts.push(`<g class="sun-mark small"><circle cx="${r2(p[0])}" cy="${r2(p[1])}" r="0.09"/><text x="${r2(lp[0])}" y="${r2(lp[1])}" font-size="0.15"><tspan x="${r2(lp[0])}" dy="0">${l}</tspan><tspan x="${r2(lp[0])}" dy="0.18">${fmtHourRound(x.t)}</tspan></text></g>`);
    });
  }
  if (s) {
    const p = at(s.az);
    parts.push(`<g class="sun-now" transform="translate(${r2(p[0])} ${r2(p[1])})"><circle r="0.24"/><path transform="scale(0.03) translate(-12 -12)" d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></g>`);
  }
  return parts.join('');
}

function planSvg() {
  const st = pageState; const room = st.room; const vb = st.vb;
  const poly = room.points.map((p) => p.join(',')).join(' ');
  const showHeat = room.windows.length && st.showLight && (st.mode === 'plants' || st.mode === 'sun') && !st.dragging;
  const parts = [];
  parts.push(`<defs>
    <clipPath id="pclip" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath>
    <clipPath id="roomclip"><polygon points="${poly}"/></clipPath>
    <pattern id="grid" width="0.5" height="0.5" patternUnits="userSpaceOnUse"><path d="M 0.5 0 L 0 0 0 0.5" class="grid-line"/></pattern>
  </defs>`);
  parts.push(`<polygon points="${poly}" class="room-floor"/>`);
  parts.push(`<polygon points="${poly}" fill="url(#grid)" class="room-grid"/>`);
  if (showHeat) parts.push(`<g clip-path="url(#roomclip)" shape-rendering="crispEdges">${heatmap()}</g>`);
  const showRadHeat = room.radiators.length && !st.dragging
    && (st.mode === 'heat' || (st.mode === 'plants' && st.showHeat));
  if (showRadHeat) parts.push(heatZonesSvg(room, st.mode === 'heat'));
  parts.push(`<polygon points="${poly}" class="room-wall" data-hit="walls"/>`);

  // Radiateurs
  room.radiators.forEach((r) => parts.push(radiatorSvg(room, r, st.sel?.kind === 'rad' && st.sel.id === r.id)));

  // Fenêtres
  room.windows.forEach((w) => parts.push(windowSvg(room, w, st.sel?.kind === 'window' && st.sel.id === w.id)));

  // Étiquettes d'exposition des fenêtres
  if (st.mode === 'windows' || st.mode === 'sun' || st.mode === 'heat') {
    room.windows.forEach((w) => {
      const [A, B] = windowEnds(room, w);
      const n = outwardNormal(room.points, w.wall);
      const m = [(A[0] + B[0]) / 2 + n[0] * 0.34, (A[1] + B[1]) / 2 + n[1] * 0.34];
      const b = windowBearing(room, w);
      parts.push(`<text x="${m[0]}" y="${m[1]}" class="win-label ${getsDirectSun(b) ? 'sunny' : ''}" font-size="0.2">${bearingLabel(b, true)}</text>`);
    });
  }

  // Forme : longueurs, poignées
  if (st.mode === 'shape') {
    edges(room.points).forEach(([a, b], i) => {
      const n = outwardNormal(room.points, i);
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      parts.push(`<text x="${m[0] + n[0] * 0.32}" y="${m[1] + n[1] * 0.32}" class="len-label" font-size="0.2">${fmtM(wallLength(room.points, i))}</text>`);
      parts.push(`<g data-hit="add:${i}" class="add-handle" transform="translate(${m[0]} ${m[1]})"><circle r="0.3" class="hit"/><circle r="0.14"/><text font-size="0.22" y="0.01">+</text></g>`);
    });
    room.points.forEach((p, i) => {
      const sel = st.sel?.kind === 'vertex' && st.sel.id === i;
      parts.push(`<g data-hit="vertex:${i}" class="vertex ${sel ? 'sel' : ''}" transform="translate(${p[0]} ${p[1]})"><circle r="0.38" class="hit"/><circle r="0.16"/></g>`);
    });
  }

  // Soleil : course réelle du soleil autour de la pièce, et tache de soleil à l'heure choisie
  if (st.mode === 'sun') parts.push(sunCourseSvg());

  // Plantes
  if (st.mode === 'plants' || st.mode === 'sun' || st.mode === 'heat') {
    const sug = st.suggestion;
    if (sug && st.sel?.kind === 'plant') {
      const pl = room.plants.find((x) => x.plantId === st.sel.id);
      if (pl && Math.hypot(pl.x - sug.x, pl.y - sug.y) > 0.15) {
        parts.push(`<line x1="${pl.x}" y1="${pl.y}" x2="${sug.x}" y2="${sug.y}" class="sug-line"/>`);
      }
    }
    room.plants.forEach((pl) => {
      const plant = st.plants.get(pl.plantId);
      const status = room.windows.length ? fitAt(room, plant, pl).status : '';
      const sel = st.sel?.kind === 'plant' && st.sel.id === pl.plantId;
      parts.push(plantMarker(pl, plant, status, sel ? 'sel' : ''));
    });
    const selPl = st.sel?.kind === 'plant' ? room.plants.find((x) => x.plantId === st.sel.id) : null;
    if (sug && !(selPl && Math.hypot(selPl.x - sug.x, selPl.y - sug.y) < 0.2)) {
      parts.push(`<g class="sug-star" transform="translate(${sug.x} ${sug.y})"><circle r="0.36" class="sug-halo"/><path transform="scale(0.024) translate(-12 -12)" d="M12 3.8l2.4 5 5.4.7-4 3.7 1 5.4-4.8-2.6-4.8 2.6 1-5.4-4-3.7 5.4-.7z" class="sug-shape"/></g>`);
    }
    if (st.dropPreview) {
      parts.push(`<circle cx="${st.dropPreview[0]}" cy="${st.dropPreview[1]}" r="0.3" class="drop-preview ${st.dropPreview[2] ? '' : 'out'}"/>`);
    }
  }

  // Boussole
  const cs = Math.min(0.32, Math.max(0.2, vb.w * 0.05));
  parts.push(compassSvg(vb.x + vb.w - cs * 1.6, vb.y + cs * 1.6, cs));
  return parts.join('');
}

function drawingSvg() {
  const pts = pageState.drawing;
  const parts = [`<defs>
    <pattern id="grid" width="0.5" height="0.5" patternUnits="userSpaceOnUse"><path d="M 0.5 0 L 0 0 0 0.5" class="grid-line"/></pattern>
    <pattern id="grid1" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M 1 0 L 0 0 0 1" class="grid-line strong"/></pattern>
  </defs>
  <rect x="0" y="0" width="10" height="8" fill="url(#grid)"/>
  <rect x="0" y="0" width="10" height="8" fill="url(#grid1)" data-hit="canvas"/>`];
  for (let i = 0; i <= 10; i += 2) parts.push(`<text x="${i}" y="-0.15" class="axis" font-size="0.22">${i} m</text>`);
  if (pts.length) {
    parts.push(`<polyline points="${pts.map((p) => p.join(',')).join(' ')}" class="draw-line"/>`);
    pts.forEach((p, i) => parts.push(`<circle cx="${p[0]}" cy="${p[1]}" r="${i === 0 && pts.length >= 3 ? 0.2 : 0.12}" class="draw-pt ${i === 0 ? 'first' : ''}"/>`));
  }
  return parts.join('');
}

// --- Interactions sur le plan ----------------------------------------------

function toPlan(svg, clientX, clientY) {
  const m = svg.getScreenCTM();
  if (!m) return [0, 0];
  const pt = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
  return [pt.x, pt.y];
}

function bindPlan() {
  const svg = document.getElementById('plan');
  let drag = null;

  svg.addEventListener('pointerdown', (e) => {
    const st = pageState;
    const hitEl = e.target.closest('[data-hit]');
    const [kind, id] = (hitEl?.dataset.hit || '').split(':');
    const p = toPlan(svg, e.clientX, e.clientY);
    drag = { kind, id, start: [e.clientX, e.clientY], p0: p, moved: false };
    if (st.drawing) { drag.kind = 'draw'; return; }
    if (kind === 'plant' && st.mode === 'plants') {
      const pl = st.room.plants.find((x) => x.plantId === id);
      drag.orig = { x: pl.x, y: pl.y };
      drag.off = [pl.x - p[0], pl.y - p[1]];
    } else if (kind === 'win' && st.mode === 'windows') {
      const w = st.room.windows.find((x) => x.id === id);
      drag.off = w.at - nearestWallOn(w.wall, p).t * wallLength(st.room.points, w.wall);
    } else if (kind === 'rad' && st.mode === 'heat') {
      const r = st.room.radiators.find((x) => x.id === id);
      drag.off = r.at - nearestWallOn(r.wall, p).t * wallLength(st.room.points, r.wall);
    } else if (kind === 'vertex' && st.mode === 'shape') {
      drag.vi = Number(id);
      drag.off = [st.room.points[drag.vi][0] - p[0], st.room.points[drag.vi][1] - p[1]];
    }
    svg.setPointerCapture(e.pointerId);
  });

  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const st = pageState;
    if (!drag.moved && Math.hypot(e.clientX - drag.start[0], e.clientY - drag.start[1]) < 6) return;
    drag.moved = true;
    const p = toPlan(svg, e.clientX, e.clientY);
    if (drag.kind === 'plant' && st.mode === 'plants') {
      st.dragging = true;
      const pl = st.room.plants.find((x) => x.plantId === drag.id);
      pl.x = r2(p[0] + drag.off[0]); pl.y = r2(p[1] + drag.off[1]);
      const g = svg.querySelector(`[data-hit="plant:${CSS.escape(drag.id)}"]`);
      if (g) { g.setAttribute('transform', `translate(${pl.x} ${pl.y})`); g.classList.add('dragging'); }
    } else if (drag.kind === 'win' && st.mode === 'windows') {
      st.dragging = true;
      const w = st.room.windows.find((x) => x.id === drag.id);
      const nw = nearestWall(p, st.room.points);
      if (nw.d < 1.2) {
        const len = wallLength(st.room.points, nw.wall);
        if (nw.wall !== w.wall) { w.wall = nw.wall; drag.off = 0; w.width = Math.min(w.width, Math.max(0.3, len - 0.1)); }
        w.at = r2(Math.max(w.width / 2, Math.min(len - w.width / 2, snap(nw.t * len + drag.off))));
        st.sel = { kind: 'window', id: w.id };
        draw();
      }
    } else if (drag.kind === 'rad' && st.mode === 'heat') {
      st.dragging = true;
      const r = st.room.radiators.find((x) => x.id === drag.id);
      const nw = nearestWall(p, st.room.points);
      if (nw.d < 1.2) {
        const len = wallLength(st.room.points, nw.wall);
        if (nw.wall !== r.wall) { r.wall = nw.wall; drag.off = 0; r.width = Math.min(r.width, Math.max(0.3, len - 0.1)); }
        r.at = r2(Math.max(r.width / 2, Math.min(len - r.width / 2, snap(nw.t * len + drag.off))));
        st.sel = { kind: 'rad', id: r.id };
        draw();
      }
    } else if (drag.kind === 'vertex' && st.mode === 'shape') {
      st.dragging = true;
      const old = st.room.points[drag.vi];
      const next = [r2(snap(p[0] + drag.off[0], 0.1)), r2(snap(p[1] + drag.off[1], 0.1))];
      st.room.points[drag.vi] = next;
      if (selfIntersects(st.room.points) || area(st.room.points) < 1) st.room.points[drag.vi] = old;
      st.sel = { kind: 'vertex', id: drag.vi };
      draw();
    }
  });

  const end = async (e) => {
    if (!drag) return;
    const st = pageState; const d = drag; drag = null;
    const wasDragging = st.dragging; st.dragging = false;
    const p = toPlan(svg, e.clientX, e.clientY);
    if (d.kind === 'draw') { if (!d.moved) addDrawPoint(p); return; }
    if (!d.moved) { onTap(d.kind, d.id, p); return; }
    if (!wasDragging) return;
    if (d.kind === 'plant') {
      const pl = st.room.plants.find((x) => x.plantId === d.id);
      if (!pointInPolygon([pl.x, pl.y], st.room.points)) {
        Object.assign(pl, d.orig);
        ctx.toast('Posez la plante à l\'intérieur de la pièce');
      } else {
        pl.movedAt = new Date().toISOString();
      }
      st.sel = { kind: 'plant', id: d.id };
      st.suggestion = null;
      await save();
    } else if (d.kind === 'vertex') {
      clampPlantsInside();
      await save();
    } else {
      await save();
    }
    draw();
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', (e) => { if (drag) { drag.moved = false; drag.kind = ''; } end(e); });
}

function nearestWallOn(i, p) {
  const [a, b] = edges(pageState.room.points)[i];
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1;
  return { t: Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) };
}

function clampPlantsInside() {
  const room = pageState.room;
  room.plants.forEach((pl) => {
    if (pointInPolygon([pl.x, pl.y], room.points)) return;
    const b = bounds(room.points);
    pl.x = r2((b.x0 + b.x1) / 2); pl.y = r2((b.y0 + b.y1) / 2);
  });
}

async function onTap(kind, id, p) {
  const st = pageState; const room = st.room;
  if (st.mode === 'plants' || st.mode === 'sun') {
    if (kind === 'plant') {
      st.mode = 'plants';
      st.sel = { kind: 'plant', id };
      const plant = st.plants.get(id);
      st.suggestion = room.windows.length ? suggestSpot(room, plant, { ignoreId: id }) : null;
    } else { st.sel = null; st.suggestion = null; }
    rerenderSeg(); draw();
    return;
  }
  if (st.mode === 'shape') {
    if (kind === 'vertex') st.sel = { kind: 'vertex', id: Number(id) };
    else if (kind === 'add') {
      const i = Number(id);
      const centers = windowCenters(room);
      const [a, b] = edges(room.points)[i];
      room.points.splice(i + 1, 0, [r2((a[0] + b[0]) / 2), r2((a[1] + b[1]) / 2)]);
      reattachWindows(room, centers);
      st.sel = { kind: 'vertex', id: i + 1 };
      await save();
    } else st.sel = null;
    draw();
    return;
  }
  if (st.mode === 'heat') {
    if (kind === 'rad') { st.sel = { kind: 'rad', id }; draw(); return; }
    if (kind === 'plant') { st.sel = { kind: 'plant', id }; st.mode = 'plants'; st.suggestion = room.windows.length ? suggestSpot(room, st.plants.get(id), { ignoreId: id }) : null; rerenderSeg(); draw(); return; }
    const nw = nearestWall(p, room.points);
    if (nw.d > 0.45) { st.sel = null; draw(); return; }
    const len = wallLength(room.points, nw.wall);
    const type = st.addRad;
    const width = Math.min(RADIATOR_TYPES[type].width, Math.max(0.3, len - 0.1));
    const r = { id: newId(), wall: nw.wall, at: r2(Math.max(width / 2, Math.min(len - width / 2, snap(nw.t * len)))), width, type, power: st.addPower };
    room.radiators.push(r);
    st.sel = { kind: 'rad', id: r.id };
    await save();
    ctx.toast(`${RADIATOR_TYPES[type].label} ajouté`);
    draw();
    return;
  }
  if (st.mode === 'windows') {
    if (kind === 'win') { st.sel = { kind: 'window', id }; draw(); return; }
    const nw = nearestWall(p, room.points);
    if (nw.d > 0.45) { st.sel = null; draw(); return; }
    const len = wallLength(room.points, nw.wall);
    const type = st.addType;
    const width = Math.min(WINDOW_TYPES[type].width, Math.max(0.3, len - 0.1));
    const w = { id: newId(), wall: nw.wall, at: r2(Math.max(width / 2, Math.min(len - width / 2, snap(nw.t * len)))), width, type };
    room.windows.push(w);
    st.sel = { kind: 'window', id: w.id };
    await save();
    ctx.toast(`${WINDOW_TYPES[type].label} ajoutée · ${bearingLabel(windowBearing(room, w)).toLowerCase()}`);
    draw();
  }
}

function rerenderSeg() {
  document.querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === pageState.mode);
    b.setAttribute('aria-selected', b.dataset.mode === pageState.mode);
  });
}

function addDrawPoint(p) {
  const pts = pageState.drawing;
  const q = [r2(snap(Math.max(0, Math.min(10, p[0])), 0.25)), r2(snap(Math.max(0, Math.min(8, p[1])), 0.25))];
  if (pts.length >= 3 && Math.hypot(q[0] - pts[0][0], q[1] - pts[0][1]) < 0.4) { finishDrawing(); return; }
  const last = pts[pts.length - 1];
  if (last && last[0] === q[0] && last[1] === q[1]) return;
  pts.push(q);
  draw();
}

async function finishDrawing() {
  const st = pageState; const pts = st.drawing;
  if (pts.length < 3) { ctx.toast('Posez au moins 3 angles'); return; }
  if (selfIntersects(pts)) { ctx.toast('Les murs se croisent : retirez le dernier point'); return; }
  if (area(pts) < 1) { ctx.toast('Pièce trop petite'); return; }
  const b = bounds(pts);
  const room = st.room;
  const centers = windowCenters(room);
  room.points = pts.map((p) => [r2(p[0] - b.x0), r2(p[1] - b.y0)]);
  if (centers.length) reattachWindows(room, centers.map((c) => [c[0] - b.x0, c[1] - b.y0]));
  clampPlantsInside();
  st.drawing = null; st.sel = null; st.vb = null;
  await save();
  ctx.toast('Forme enregistrée');
  if (!room.windows.length) { st.mode = 'windows'; rerenderSeg(); }
  draw();
}

// --- Glisser une plante depuis la réserve ----------------------------------

function bindTray(panel) {
  panel.querySelectorAll('.tray-item').forEach((item) => {
    item.addEventListener('pointerdown', (e) => {
      const st = pageState;
      const plant = st.plants.get(item.dataset.id);
      if (!plant) return;
      item.setPointerCapture(e.pointerId);
      const start = [e.clientX, e.clientY];
      let ghost = null;
      const svg = document.getElementById('plan');
      const sug = st.room.windows.length ? suggestSpot(st.room, plant) : null;

      const move = (ev) => {
        if (!ghost && Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) < 6) return;
        if (!ghost) {
          ghost = item.cloneNode(true);
          ghost.classList.add('drag-ghost');
          document.body.appendChild(ghost);
          item.classList.add('picked');
          st.suggestion = sug; st.sel = null;
          draw(false);
        }
        ghost.style.transform = `translate(${ev.clientX - 35}px, ${ev.clientY - 75}px)`;
        const r = svg.getBoundingClientRect();
        const over = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
        const p = toPlan(svg, ev.clientX, ev.clientY - 46);
        st.dropPreview = over ? [p[0], p[1], pointInPolygon(p, st.room.points)] : null;
        const layer = svg.querySelector('.drop-preview');
        if (layer && st.dropPreview) {
          layer.setAttribute('cx', p[0]); layer.setAttribute('cy', p[1]);
          layer.classList.toggle('out', !st.dropPreview[2]);
        } else draw(false);
      };
      const up = async (ev) => {
        item.removeEventListener('pointermove', move);
        item.removeEventListener('pointerup', up);
        item.removeEventListener('pointercancel', up);
        const dropped = st.dropPreview; st.dropPreview = null;
        if (ghost) ghost.remove();
        item.classList.remove('picked');
        if (!ghost) { // simple toucher : placer à l'endroit idéal
          if (sug) await placePlant(plant, sug.x, sug.y, true);
          else {
            const b = bounds(st.room.points);
            await placePlant(plant, r2((b.x0 + b.x1) / 2), r2((b.y0 + b.y1) / 2), false);
          }
          return;
        }
        if (ev.type === 'pointerup' && dropped && dropped[2]) {
          await placePlant(plant, r2(dropped[0]), r2(dropped[1]), false);
        } else {
          st.suggestion = null;
          if (dropped) ctx.toast('Déposez la plante à l\'intérieur de la pièce');
          draw();
        }
      };
      item.addEventListener('pointermove', move);
      item.addEventListener('pointerup', up);
      item.addEventListener('pointercancel', up);
    });
  });
}

async function placePlant(plant, x, y, ideal) {
  const st = pageState;
  // Une plante n'est que dans une seule pièce : on la retire de l'ancienne.
  let from = null;
  for (const other of st.rooms) {
    if (other.id === st.room.id) continue;
    if ((other.plants || []).some((pl) => pl.plantId === plant.id)) {
      other.plants = other.plants.filter((pl) => pl.plantId !== plant.id);
      await saveRoom(other);
      from = other.name;
    }
  }
  st.room.plants = st.room.plants.filter((pl) => pl.plantId !== plant.id);
  st.room.plants.push({ plantId: plant.id, x, y });
  st.sel = { kind: 'plant', id: plant.id };
  st.suggestion = st.room.windows.length ? suggestSpot(st.room, plant, { ignoreId: plant.id }) : null;
  await save();
  ctx.toast(`${plantName(plant)} ${ideal ? 'placée au meilleur endroit' : 'placée'}${from ? ` (retirée de « ${from} »)` : ''}`);
  draw();
}

// --- Panneau sous le plan --------------------------------------------------

function renderPanel() {
  const panel = document.getElementById('room-panel');
  if (!panel) return;
  const st = pageState;
  if (st.drawing) panel.innerHTML = drawingPanel();
  else if (st.mode === 'shape') panel.innerHTML = shapePanel();
  else if (st.mode === 'windows') panel.innerHTML = windowsPanel();
  else if (st.mode === 'heat') panel.innerHTML = heatPanel();
  else if (st.mode === 'sun') panel.innerHTML = sunPanel();
  else panel.innerHTML = plantsPanel();
  bindPanel(panel);
}

function lightLegend() {
  return `<div class="light-legend">
    <span><i class="lg lg-0"></i>Ombre</span><span><i class="lg lg-1"></i>Mi-ombre</span>
    <span><i class="lg lg-2"></i>Lumineux</span><span><i class="lg lg-sun"></i>Soleil direct</span>
  </div>`;
}

function plantsPanel() {
  const st = pageState; const room = st.room;
  const noWin = !room.windows.length
    ? '<div class="notice">Ajoutez au moins une fenêtre (onglet <strong>Fenêtres</strong>) pour calculer la lumière et obtenir des conseils.</div>' : '';

  if (st.sel?.kind === 'plant') {
    const pl = room.plants.find((x) => x.plantId === st.sel.id);
    const plant = st.plants.get(st.sel.id);
    if (pl && plant) return selectedPlantPanel(pl, plant) + noWin;
  }

  const inRoom = room.plants.map((pl) => ({ pl, plant: st.plants.get(pl.plantId) })).filter((x) => x.plant);
  const otherRoomOf = new Map();
  st.rooms.forEach((r) => { if (r.id !== room.id) (r.plants || []).forEach((pl) => otherRoomOf.set(pl.plantId, r.name)); });
  const tray = [...st.plants.values()].filter((p) => !room.plants.some((pl) => pl.plantId === p.id))
    .sort((a, b) => (otherRoomOf.has(a.id) ? 1 : 0) - (otherRoomOf.has(b.id) ? 1 : 0));

  const rows = inRoom.map(({ pl, plant }) => {
    const fit = room.windows.length ? fitAt(room, plant, pl) : null;
    const lv = fit ? levelOf(fit.info.level) : null;
    return `<button class="pl-row" data-select="${esc(pl.plantId)}">
      ${plant.photo ? `<img src="${blobUrl(plant.photo)}" alt="">` : `<span class="ph">${plantArt(plant.id, plant.scientificName)}</span>`}
      <span class="pl-info"><strong>${esc(plantName(plant))}</strong>
        <span class="muted small">${fit ? `Ici : ${esc(lv.label.toLowerCase())}${fit.info.direct ? ' + soleil direct' : ''}<br>Besoin : ${esc(fit.need.label.toLowerCase())}` : ''}${fit?.tooHot ? `<br><span class="heat-note">${icon('radiator', 12)} trop près d'un radiateur</span>` : ''}</span></span>
      ${fit ? `<span class="badge ${STATUS[fit.status].cls}">${fit.diag && !fit.diag.addressed ? (fit.diag.dir === 'plus' ? 'Plus de lumière' : 'Moins de lumière') : STATUS[fit.status].label}</span>` : ''}
    </button>`;
  }).join('');

  const trayHtml = !st.plants.size
    ? '<p class="muted small tray-empty">Votre parc est vide. Ajoutez d\'abord des plantes depuis <a href="#/identify">Identifier</a>.</p>'
    : tray.length ? `<div class="tray-strip" aria-label="Plantes à placer">${tray.map((p) => `
          <div class="tray-item" data-id="${esc(p.id)}" role="button" aria-label="Placer ${esc(plantName(p))}">
            ${p.photo ? `<img src="${blobUrl(p.photo)}" alt="" draggable="false">` : `<span class="ph">${plantArt(p.id, p.scientificName)}</span>`}
            <span class="tray-name">${esc(plantName(p))}</span>
            ${otherRoomOf.has(p.id) ? `<span class="tray-where">${esc(otherRoomOf.get(p.id))}</span>` : ''}
          </div>`).join('')}</div>
        <p class="muted small tray-help">Glissez une plante vers le haut sur le plan, ou touchez-la pour la poser au meilleur endroit.</p>`
      : '<p class="muted small tray-empty">Toutes vos plantes sont dans cette pièce.</p>';

  return `
    ${trayHtml}
    ${noWin}
    ${room.windows.length ? `<div class="row light-toggle">
      ${lightLegend()}
      <label class="switch"><input type="checkbox" id="show-light" ${st.showLight ? 'checked' : ''}> Lumière</label>
    </div>` : ''}
    ${room.radiators.length ? `<div class="row light-toggle">
      ${heatLegend(false)}
      <label class="switch"><input type="checkbox" id="show-heat" ${st.showHeat ? 'checked' : ''}> Chaleur</label>
    </div>` : ''}
    ${inRoom.length ? `<div class="card"><h2>Dans cette pièce</h2><div class="pl-list">${rows}</div></div>` : ''}`;
}

function selectedPlantPanel(pl, plant) {
  const st = pageState; const room = st.room;
  const need = plantNeed(plant);
  const hasWin = room.windows.length > 0;
  const fit = hasWin ? fitAt(room, plant, pl) : null;
  const here = hasWin ? describeSpot(room, [pl.x, pl.y]) : null;
  const sug = st.suggestion;
  const ht = room.radiators.length ? heatText(room, [pl.x, pl.y], plant) : null;
  const sens = heatSensitivity(plant);
  const far = sug && Math.hypot(sug.x - pl.x, sug.y - pl.y) > 0.25;
  const better = far && (sug.gain == null || sug.gain > 0.08);

  let advice = '';
  if (sug) {
    advice = better
      ? `<div class="advice">
          <div class="advice-title">${icon('star', 18)} Emplacement idéal</div>
          <p>${esc(sug.why)}. Le mieux : <strong>${esc(sug.spot.lv.label.toLowerCase())}</strong>, ${esc(sug.spot.where)} (${esc(sug.spot.sun)} aujourd'hui)${esc(idealHeatText(room, sug, plant, ht))}.</p>
          <div class="btn-row"><button class="btn" id="move-ideal">Déplacer ici</button></div>
        </div>`
      : `<div class="advice ok"><div class="advice-title">${icon('check', 18)} Bon emplacement</div>
          <p>${sug.diag && !sug.diag.addressed ? `${esc(sug.why)}, mais c'est déjà l'un des meilleurs endroits de cette pièce. Essayez ${sug.diag.dir === 'plus' ? 'une pièce plus lumineuse' : 'une pièce moins exposée ou un voilage'}.` : sug.diag ? 'Déplacée depuis le dernier diagnostic : refaites-en un dans quelques semaines pour vérifier qu\'elle va mieux.' : 'Cette plante est déjà à l\'un des meilleurs endroits de la pièce.'}</p></div>`;
  }

  return `
    <div class="card sel-plant">
      <div class="sel-head">
        ${plant.photo ? `<img src="${blobUrl(plant.photo)}" alt="">` : `<span class="ph">${plantArt(plant.id, plant.scientificName)}</span>`}
        <div class="pl-info"><h2>${esc(plantName(plant))}</h2>
          ${plant.scientificName ? `<div class="sci small">${esc(plant.scientificName)}</div>` : ''}</div>
        ${fit ? `<span class="badge ${STATUS[fit.status].cls}">${STATUS[fit.status].label}</span>` : ''}
      </div>
      <dl class="kv">
        ${here ? `<dt>Ici</dt><dd>${esc(here.lv.label)}<br><span class="muted small">${esc(here.where)}</span><br><span class="muted small">${esc(cap(here.sun))} aujourd'hui</span></dd>` : ''}
        <dt>Besoin</dt><dd>${esc(need.label)}<br><span class="muted small">${esc(need.source)}</span></dd>
        ${ht ? `<dt>Chauffage</dt><dd>${esc(cap(ht.where))} : effet ${esc(ht.effect.label)}<br>
          <span class="muted small">${esc(cap(ht.winter))}. ${esc(ht.now)}.</span><br>
          <span class="muted small">Sensibilité ${esc(sens.label)} : ${esc(sens.why)}.</span>
          ${ht.penalty > 0.3 ? `<br><span class="small heat-note">${icon('radiator', 12)} ${esc(heatVerdict(ht))}</span>` : ''}</dd>` : ''}
        ${fit?.diag ? `<dt>Diagnostic</dt><dd>${fit.diag.addressed ? 'Demandait' : 'Demande'} ${fit.diag.dir === 'plus' ? 'plus' : 'moins'} de lumière${fit.diag.addressed ? ' · déjà déplacée' : ''}${fit.diag.text ? `<br><span class="muted small">« ${esc(fit.diag.text)} »</span>` : ''}</dd>` : ''}
      </dl>
      ${advice}
      <label for="need-sel">Besoin en lumière de cette plante</label>
      <select id="need-sel">
        <option value="">Automatique${plant.lightNeed ? '' : ` (${esc(need.label.toLowerCase())})`}</option>
        ${Object.entries(NEEDS).map(([k, n]) => `<option value="${k}" ${plant.lightNeed === k ? 'selected' : ''}>${esc(n.label)}</option>`).join('')}
      </select>
      <div class="btn-row">
        <button class="btn secondary" id="open-plant">Voir la fiche</button>
        <button class="btn danger" id="remove-plant">Retirer</button>
      </div>
      <button class="link-btn" id="desel">← Toutes les plantes de la pièce</button>
    </div>`;
}

// « , loin des radiateurs » / « , à 1,2 m d'un radiateur (+1 °C en hiver) ».
function idealHeatText(room, sug, plant, cur) {
  if (!room.radiators.length) return '';
  const h = heatText(room, [sug.x, sug.y], plant);
  if (!h) return sug.heatDriven || (cur && cur.penalty > 0.3) ? ', loin des radiateurs' : '';
  return `, ${h.short}`;
}

function heatVerdict(ht) {
  const p = ht.penalty;
  const when = ht.season.on ? '' : ' cet hiver';
  if (p > 1) return `Bien trop près pour elle${when} : éloignez-la d'au moins 1,5 m.`;
  if (p > 0.6) return `Trop près pour elle${when} : gagnez au moins 50 cm, ou posez une soucoupe de billes d'argile humides.`;
  return `Un peu trop près${when} : surveillez le bord des feuilles et la terre, qui sèchera plus vite.`;
}

function heatPanel() {
  const st = pageState; const room = st.room;
  const season = heatingSeason();
  const r = st.sel?.kind === 'rad' ? room.radiators.find((x) => x.id === st.sel.id) : null;
  const ref = r || { type: st.addRad, power: st.addPower, width: RADIATOR_TYPES[st.addRad].width };
  const table = heatTable(ref);
  const seasonText = season.on
    ? `Chauffage en marche en ${season.month} : effet compté à ${Math.round(season.factor * 100)} % du plein hiver.`
    : `Chauffage arrêté en ${season.month}. Pour choisir les emplacements, l'effet est quand même compté à ${Math.round(season.weight * 100)} % : vos plantes seront déjà bien placées quand il reprendra.`;

  const typeChips = (cur, id) => `<div class="chips" id="${id}">
    ${Object.entries(RADIATOR_TYPES).map(([k, t]) => `<button class="chip ${cur === k ? 'active' : ''}" data-v="${k}">${t.label}</button>`).join('')}</div>`;
  const powerChips = (cur, id) => `<div class="chips" id="${id}">
    ${Object.entries(RADIATOR_POWER).map(([k, t]) => `<button class="chip ${cur === k ? 'active' : ''}" data-v="${k}">${t.label}</button>`).join('')}</div>`;

  let selHtml = '';
  if (r) {
    const len = wallLength(room.points, r.wall);
    selHtml = `
      <div class="card">
        <h2>${esc(RADIATOR_TYPES[r.type]?.label || 'Radiateur')} · ${esc(RADIATOR_POWER[r.power]?.label.toLowerCase() || 'moyen')}</h2>
        <p class="muted small">${esc(cap(RADIATOR_TYPES[r.type]?.hint || ''))}. Faites-le glisser le long du mur pour le déplacer.</p>
        ${typeChips(r.type, 'rad-type')}
        <label>Puissance ressentie</label>
        ${powerChips(r.power, 'rad-power')}
        <label for="rad-w">Largeur : <span id="rad-w-val">${fmtM(r.width)}</span></label>
        <input type="range" id="rad-w" min="0.3" max="${r2(Math.max(0.4, Math.min(3, len - 0.05)))}" step="0.05" value="${r.width}">
        <div class="btn-row"><button class="btn danger" id="del-rad">Supprimer</button></div>
      </div>`;
  }

  const list = room.radiators.map((x) => `<button class="pl-row" data-rad="${esc(x.id)}">
      <span class="ph ico-ph">${icon('radiator', 22)}</span>
      <span class="pl-info"><strong>${esc(RADIATOR_TYPES[x.type]?.label || 'Radiateur')} ${esc(RADIATOR_POWER[x.power]?.label.toLowerCase() || '')}</strong>
      <span class="muted small">${fmtM(x.width)} · ${fmtDeg(heatTable(x)[0].dT)} à 20 cm en hiver</span></span>
    </button>`).join('');

  // Plantes de la pièce touchées par la chaleur.
  const touched = room.plants.map((pl) => {
    const plant = st.plants.get(pl.plantId);
    const ht = plant ? heatText(room, [pl.x, pl.y], plant) : null;
    return ht ? { pl, plant, ht } : null;
  }).filter(Boolean).sort((a, b) => b.ht.penalty - a.ht.penalty);
  const touchedHtml = touched.map(({ pl, plant, ht }) => {
    const cls = ht.penalty > 0.6 ? 'bad' : ht.penalty > 0.3 ? 'warn' : 'good';
    const lab = ht.penalty > 0.6 ? 'À éloigner' : ht.penalty > 0.3 ? 'Un peu près' : 'Ça va';
    return `<button class="pl-row" data-select="${esc(pl.plantId)}">
      ${plant.photo ? `<img src="${blobUrl(plant.photo)}" alt="">` : `<span class="ph">${plantArt(plant.id, plant.scientificName)}</span>`}
      <span class="pl-info"><strong>${esc(plantName(plant))}</strong>
        <span class="muted small">${esc(cap(ht.short))}<br>Sensibilité ${esc(ht.sens.label)}</span></span>
      <span class="badge ${cls}">${lab}</span>
    </button>`;
  }).join('');

  return `
    <div class="card">
      <h2>Ajouter un radiateur</h2>
      ${typeChips(st.addRad, 'add-rad')}
      <label>Puissance ressentie</label>
      ${powerChips(st.addPower, 'add-power')}
      <p class="muted small" style="margin-top:8px">Puis touchez le mur où il se trouve sur le plan (souvent sous une fenêtre).</p>
    </div>
    ${selHtml}
    <div class="card heat-card">
      <h2>Effet estimé</h2>
      <p class="small">${esc(seasonText)}</p>
      <table class="heat-table">
        <thead><tr><th>Distance</th><th>Chaleur</th><th>Humidité</th><th>Arrosage</th></tr></thead>
        <tbody>${table.map((t) => `<tr class="hz-row-${t.effect.key}"><td>${t.label}</td><td>${fmtDeg(t.dT)}</td><td>~${t.rh} %</td><td>${t.water >= 3 ? `+${t.water} %` : '='}</td></tr>`).join('')}</tbody>
      </table>
      <p class="muted small">En plein hiver, pour ${r ? 'ce radiateur' : `un ${esc(RADIATOR_TYPES[ref.type].label.toLowerCase())} ${esc(RADIATOR_POWER[ref.power].label.toLowerCase())}`}. Pièce à ~${ROOM_HUMIDITY} % d'humidité. « Arrosage » : combien plus souvent la terre sera sèche.</p>
      ${room.radiators.length ? heatLegend(true) : ''}
      <details class="heat-how"><summary>Comment c'est calculé</summary>
        <p class="small">Contre un radiateur moyen, l'air est environ 8 °C plus chaud que la pièce, et l'écart est divisé par 2,5 à peu près tous les 50 cm. Chaque degré gagné fait baisser l'humidité d'environ 6 % et sécher la terre 5 % plus vite. Le conseil d'emplacement retire des points selon la sensibilité de l'espèce : forte (calathéa, fougères, fittonia…), moyenne (la plupart des plantes vertes) ou faible (cactus, plantes grasses, sansevieria, zamioculcas). Une plante très sensible à 40 cm d'un radiateur en hiver perd autant qu'avec deux fois trop peu de lumière.</p>
      </details>
    </div>
    ${touched.length ? `<div class="card"><h2>Plantes près d'un radiateur</h2><div class="pl-list">${touchedHtml}</div></div>` : ''}
    ${room.radiators.length ? `<div class="card"><h2>Radiateurs</h2><div class="pl-list">${list}</div></div>` : ''}`;
}

function shapePanel() {
  const st = pageState; const room = st.room;
  const b = bounds(room.points);
  const vsel = st.sel?.kind === 'vertex';
  return `
    <div class="card">
      <h2>Forme de la pièce</h2>
      <p class="muted small">${room.points.length} murs · ${fmtM(b.x1 - b.x0)} × ${fmtM(b.y1 - b.y0)} · ${fmtM(area(room.points)).replace(' m', ' m²')}</p>
      ${vsel ? `<div class="btn-row"><button class="btn danger" id="del-vertex" ${room.points.length <= 3 ? 'disabled' : ''}>Supprimer cet angle</button></div>` : ''}
      <div class="dims">
        <div><label for="rw">Largeur (m)</label><input type="number" inputmode="decimal" step="0.1" min="1" id="rw" value="${r2(b.x1 - b.x0)}"></div>
        <div><label for="rl">Longueur (m)</label><input type="number" inputmode="decimal" step="0.1" min="1" id="rl" value="${r2(b.y1 - b.y0)}"></div>
      </div>
      <div class="btn-row">
        <button class="btn secondary" id="make-rect">Rectangle</button>
        <button class="btn secondary" id="make-l">En L</button>
      </div>
      <div class="btn-row"><button class="btn secondary" id="start-draw">${icon('note', 18)} Dessiner une nouvelle forme</button></div>
    </div>
    <div class="card">
      <h2>Pièce</h2>
      <label for="room-name">Nom</label>
      <input type="text" id="room-name" value="${esc(room.name)}">
      <div class="btn-row"><button class="btn secondary" id="rename">Renommer</button></div>
      <div class="btn-row"><button class="btn danger" id="del-room">Supprimer la pièce</button></div>
    </div>`;
}

function drawingPanel() {
  const n = pageState.drawing.length;
  return `
    <div class="card">
      <h2>Dessiner la pièce</h2>
      <p class="muted small">Chaque carreau fait 50 cm. Touchez les angles un par un en faisant le tour de la pièce, puis touchez le premier point pour fermer.</p>
      <div class="btn-row">
        <button class="btn secondary" id="draw-undo" ${n ? '' : 'disabled'}>Retirer le dernier</button>
        <button class="btn" id="draw-done" ${n >= 3 ? '' : 'disabled'}>Terminer</button>
      </div>
      <button class="link-btn" id="draw-cancel">Abandonner</button>
    </div>`;
}

function windowsPanel() {
  const st = pageState; const room = st.room;
  const w = st.sel?.kind === 'window' ? room.windows.find((x) => x.id === st.sel.id) : null;
  const list = room.windows.map((x) => {
    const b = windowBearing(room, x);
    return `<button class="pl-row" data-win="${esc(x.id)}">
      <span class="ph ico-ph">${icon(x.type === 'french' ? 'door' : 'window', 22)}</span>
      <span class="pl-info"><strong>${esc(WINDOW_TYPES[x.type].label)} ${esc(bearingLabel(b).toLowerCase())}</strong>
      <span class="muted small">${fmtM(x.width)} · ${esc(exposureText(b))}</span></span>
      ${getsDirectSun(b) ? `<span class="badge warn">${icon('sun', 14)} soleil</span>` : ''}
    </button>`;
  }).join('');
  let selHtml = '';
  if (w) {
    const len = wallLength(room.points, w.wall);
    selHtml = `
      <div class="card">
        <h2>${esc(WINDOW_TYPES[w.type].label)} · ${esc(bearingLabel(windowBearing(room, w)))}</h2>
        <p class="muted small">${esc(cap(exposureText(windowBearing(room, w))))}. Faites-la glisser le long du mur pour la déplacer.</p>
        <div class="chips" id="win-type">
          ${Object.entries(WINDOW_TYPES).map(([k, t]) => `<button class="chip ${w.type === k ? 'active' : ''}" data-v="${k}">${t.label}</button>`).join('')}
        </div>
        <label for="win-w">Largeur : <span id="win-w-val">${fmtM(w.width)}</span></label>
        <input type="range" id="win-w" min="0.3" max="${r2(Math.max(0.4, Math.min(4, len - 0.05)))}" step="0.05" value="${w.width}">
        <div class="btn-row"><button class="btn danger" id="del-win">Supprimer</button></div>
      </div>`;
  }
  return `
    <div class="card">
      <h2>Ajouter une ouverture</h2>
      <div class="chips" id="add-type">
        ${Object.entries(WINDOW_TYPES).map(([k, t]) => `<button class="chip ${st.addType === k ? 'active' : ''}" data-v="${k}">${icon(k === 'french' ? 'door' : 'window', 16)} ${t.label}</button>`).join('')}
      </div>
      <p class="muted small" style="margin-top:8px">Puis touchez le mur où elle se trouve sur le plan.</p>
    </div>
    ${selHtml}
    ${room.windows.length ? `<div class="card"><h2>Ouvertures</h2><div class="pl-list">${list}</div></div>` : ''}`;
}

const SUN_DAYS = [['today', 'Aujourd\'hui'], ['summer', '21 juin'], ['winter', '21 décembre']];

function sunPanel() {
  const st = pageState; const room = st.room;
  const up = room.upBearing || 0;
  const sun = currentSun();
  const place = getPlace();
  const s = sunSample();
  const dayLen = sun.samples.reduce((a, x) => a + x.hours, 0);
  const wins = room.windows.map((w) => {
    const b = windowBearing(room, w);
    const ws = windowSun(b, sun);
    const when = ws.hours >= 0.25 ? `soleil de ${fmtHourRound(ws.from)} à ${fmtHourRound(new Date(ws.to.getTime() + 20 * 60000))} (${fmtDuration(ws.hours)})` : 'pas de soleil direct';
    return `<li><strong>${esc(WINDOW_TYPES[w.type].label)} ${esc(bearingLabel(b).toLowerCase())}</strong> : ${esc(when)}</li>`;
  }).join('');
  const firstM = sun.samples.length ? sun.samples[0].t.getHours() * 60 + sun.samples[0].t.getMinutes() : 360;
  const lastS = sun.samples[sun.samples.length - 1];
  const lastM = lastS ? lastS.t.getHours() * 60 + lastS.t.getMinutes() : 1200;
  return `
    <div class="card sun-card">
      <div class="row"><h2>Course du soleil</h2>
        <span class="muted small">${icon('pin', 13)} ${esc(place.name || 'Ma position')}${place.isDefault ? ' (par défaut)' : ''}</span></div>
      ${place.isDefault ? '<p class="small notice-inline">Calcul fait pour Paris. Indiquez votre ville dans <a href="#/settings">Réglages → Ma ville</a> pour un soleil exact.</p>' : ''}
      <div class="chips" id="sun-day">
        ${SUN_DAYS.map(([k, l]) => `<button class="chip ${st.sunDay === k ? 'active' : ''}" data-v="${k}">${l}</button>`).join('')}
      </div>
      ${s ? `<label for="sun-time" class="sun-time-label"><span id="sun-time-val">${esc(fmtHourRound(s.t))}</span>
          <span class="muted small" id="sun-time-info">${esc(sunInfo(s))}</span></label>
        <input type="range" id="sun-time" min="${firstM}" max="${lastM}" step="10" value="${Math.min(lastM, Math.max(firstM, st.sunMin))}">
        <p class="muted small">Le jaune vif montre où le soleil tape à cette heure. Jour de ${esc(fmtDuration(dayLen))}, lever à ${esc(fmtHourRound(sun.sunrise))}, coucher à ${esc(fmtHourRound(sun.sunset))}.</p>` : '<p class="muted small">Le soleil ne se lève pas ce jour-là ici.</p>'}
      ${room.windows.length ? `<ul class="clean">${wins}</ul>${lightLegend()}` : '<div class="notice">Ajoutez les fenêtres pour voir l\'ensoleillement de la pièce.</div>'}
      <div id="weather" class="weather"></div>
    </div>
    <div class="card">
      <h2>Orientation</h2>
      <p class="muted small">Vers où regarde le mur du <strong>haut du plan</strong> ?</p>
      <div class="chips" id="up-chips">
        ${COMPASS.map((c) => `<button class="chip ${Math.round(up) === c.deg ? 'active' : ''}" data-v="${c.deg}">${c.label}</button>`).join('')}
      </div>
      <label for="up-range">Réglage fin : <span id="up-val">${Math.round(up)}° (${esc(bearingLabel(up))})</span></label>
      <input type="range" id="up-range" min="0" max="355" step="5" value="${Math.round(up)}">
      <div class="btn-row"><button class="btn secondary" id="use-compass">${icon('compass', 18)} Mesurer avec la boussole du téléphone</button></div>
      <p class="muted small" id="compass-help" hidden>Tenez le téléphone à plat, le haut de l'écran pointé vers le mur du haut du plan, puis patientez.</p>
    </div>`;
}

function sunInfo(s) {
  return `${Math.round(s.alt)}° au-dessus de l'horizon, plein ${bearingLabel(s.az).toLowerCase()}`;
}

// Météo des prochains jours (si en ligne).
async function showWeather() {
  const box = document.getElementById('weather');
  if (!box) return;
  try {
    const days = await weather();
    if (!document.getElementById('weather')) return;
    const names = ['Aujourd\'hui', 'Demain'];
    box.innerHTML = `<div class="weather-row">${days.map((d, i) => `<div class="wday">
      <strong>${i < 2 ? names[i] : cap(new Date(`${d.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long' }))}</strong>
      <span>${icon(d.sunHours >= 3 ? 'sun' : 'drop', 16)} ${esc(weatherLabel(d.code))}</span>
      <span class="muted small">${esc(fmtDuration(d.sunHours))} de soleil · ${Math.round(d.tmin)}° / ${Math.round(d.tmax)}°</span>
    </div>`).join('')}</div>
    ${days[0] && days[0].sunHours >= 5 && days[0].tmax >= 26 ? '<p class="small warn-text">Grand soleil et chaleur aujourd\'hui : éloignez de la vitre les plantes fragiles exposées l\'après-midi.</p>' : ''}`;
  } catch {
    box.innerHTML = '<p class="muted small">Météo indisponible hors connexion.</p>';
  }
}

async function setUp(deg) {
  pageState.room.upBearing = ((Math.round(deg) % 360) + 360) % 360;
  await save();
  draw();
}

function bindPanel(panel) {
  const st = pageState; const room = st.room;
  const q = (s) => panel.querySelector(s);
  const on = (s, fn) => { const el = q(s); if (el) el.onclick = fn; };

  // Plantes
  bindTray(panel);
  panel.querySelectorAll('[data-select]').forEach((b) => {
    b.onclick = () => onTap('plant', b.dataset.select, null);
  });
  const sl = q('#show-light');
  if (sl) sl.onchange = () => { st.showLight = sl.checked; draw(); };
  const sh = q('#show-heat');
  if (sh) sh.onchange = () => { st.showHeat = sh.checked; draw(); };
  on('#move-ideal', async () => {
    const pl = room.plants.find((x) => x.plantId === st.sel.id);
    const sug = st.suggestion;
    Object.assign(pl, { x: sug.x, y: sug.y, movedAt: new Date().toISOString() });
    await save();
    st.suggestion = suggestSpot(room, st.plants.get(pl.plantId), { ignoreId: pl.plantId });
    ctx.toast('Plante déplacée au meilleur endroit');
    draw();
  });
  on('#open-plant', () => ctx.go(`#/plant/${encodeURIComponent(st.sel.id)}`));
  on('#remove-plant', async () => {
    room.plants = room.plants.filter((x) => x.plantId !== st.sel.id);
    st.sel = null; st.suggestion = null;
    await save(); draw();
  });
  on('#desel', () => { st.sel = null; st.suggestion = null; draw(); });
  const ns = q('#need-sel');
  if (ns) ns.onchange = async () => {
    const plant = await getPlant(st.sel.id);
    if (ns.value) plant.lightNeed = ns.value; else delete plant.lightNeed;
    await savePlant(plant);
    st.plants.set(plant.id, plant);
    st.suggestion = suggestSpot(room, plant, { ignoreId: plant.id });
    draw();
  };

  // Forme
  on('#del-vertex', async () => {
    if (room.points.length <= 3) return;
    const centers = windowCenters(room);
    const pts = room.points.filter((_, i) => i !== st.sel.id);
    if (selfIntersects(pts) || area(pts) < 1) { ctx.toast('Impossible : les murs se croiseraient'); return; }
    room.points = pts;
    reattachWindows(room, centers);
    clampPlantsInside();
    st.sel = null;
    await save(); draw();
  });
  const dims = () => [
    Math.min(30, Math.max(1, parseFloat(String(q('#rw').value).replace(',', '.')) || 3)),
    Math.min(30, Math.max(1, parseFloat(String(q('#rl').value).replace(',', '.')) || 3)),
  ];
  const reshape = async (pts) => {
    const centers = windowCenters(room);
    room.points = pts;
    reattachWindows(room, centers);
    clampPlantsInside();
    st.sel = null; st.vb = null;
    await save(); draw();
  };
  on('#make-rect', () => reshape(rectPoints(...dims())));
  on('#make-l', () => reshape(lPoints(...dims())));
  on('#start-draw', () => { st.drawing = []; st.sel = null; draw(); });
  on('#rename', async () => {
    room.name = q('#room-name').value.trim() || room.name;
    await save();
    ctx.setHeader(room.name, '#/rooms');
    ctx.toast('Pièce renommée');
  });
  on('#del-room', async () => {
    if (!confirm(`Supprimer « ${room.name} » ? Les plantes restent dans votre parc.`)) return;
    await deleteRoom(room.id);
    pageState = null;
    ctx.toast('Pièce supprimée');
    ctx.go('#/rooms');
  });

  // Dessin
  on('#draw-undo', () => { st.drawing.pop(); draw(); });
  on('#draw-done', finishDrawing);
  on('#draw-cancel', () => { st.drawing = null; draw(); });

  // Fenêtres
  panel.querySelectorAll('#add-type .chip').forEach((c) => { c.onclick = () => { st.addType = c.dataset.v; renderPanel(); }; });
  panel.querySelectorAll('[data-win]').forEach((b) => { b.onclick = () => { st.sel = { kind: 'window', id: b.dataset.win }; draw(); }; });
  const selW = st.sel?.kind === 'window' ? room.windows.find((x) => x.id === st.sel.id) : null;
  if (selW) {
    panel.querySelectorAll('#win-type .chip').forEach((c) => {
      c.onclick = async () => {
        selW.type = c.dataset.v;
        const len = wallLength(room.points, selW.wall);
        if (selW.type === 'french' && selW.width < 1.2) selW.width = Math.min(WINDOW_TYPES.french.width, len - 0.1);
        selW.at = Math.max(selW.width / 2, Math.min(len - selW.width / 2, selW.at));
        await save(); draw();
      };
    });
    const ww = q('#win-w');
    ww.oninput = () => {
      const len = wallLength(room.points, selW.wall);
      selW.width = Number(ww.value);
      selW.at = Math.max(selW.width / 2, Math.min(len - selW.width / 2, selW.at));
      q('#win-w-val').textContent = fmtM(selW.width);
      const svg = document.getElementById('plan');
      const vb = st.vb;
      svg.innerHTML = planSvg(); // aperçu en direct, sans reconstruire le panneau
      st.vb = vb;
    };
    ww.onchange = async () => { await save(); draw(); };
    on('#del-win', async () => {
      room.windows = room.windows.filter((x) => x.id !== selW.id);
      st.sel = null;
      await save(); draw();
    });
  }

  // Chauffage
  panel.querySelectorAll('#add-rad .chip').forEach((c) => { c.onclick = () => { st.addRad = c.dataset.v; renderPanel(); }; });
  panel.querySelectorAll('#add-power .chip').forEach((c) => { c.onclick = () => { st.addPower = c.dataset.v; renderPanel(); }; });
  panel.querySelectorAll('[data-rad]').forEach((b) => { b.onclick = () => { st.sel = { kind: 'rad', id: b.dataset.rad }; draw(); }; });
  const selR = st.sel?.kind === 'rad' ? room.radiators.find((x) => x.id === st.sel.id) : null;
  if (selR) {
    panel.querySelectorAll('#rad-type .chip').forEach((c) => { c.onclick = async () => { selR.type = c.dataset.v; await save(); draw(); }; });
    panel.querySelectorAll('#rad-power .chip').forEach((c) => { c.onclick = async () => { selR.power = c.dataset.v; await save(); draw(); }; });
    const rw = q('#rad-w');
    rw.oninput = () => {
      const len = wallLength(room.points, selR.wall);
      selR.width = Number(rw.value);
      selR.at = Math.max(selR.width / 2, Math.min(len - selR.width / 2, selR.at));
      q('#rad-w-val').textContent = fmtM(selR.width);
      const vb = st.vb;
      document.getElementById('plan').innerHTML = planSvg();
      st.vb = vb;
    };
    rw.onchange = async () => { await save(); draw(); };
    on('#del-rad', async () => {
      room.radiators = room.radiators.filter((x) => x.id !== selR.id);
      st.sel = null;
      await save(); draw();
    });
  }

  // Soleil
  panel.querySelectorAll('#sun-day .chip').forEach((c) => {
    c.onclick = () => { st.sunDay = c.dataset.v; st.sunMin = null; st.heatKey = ''; draw(); };
  });
  const tr = q('#sun-time');
  if (tr) {
    tr.oninput = () => {
      st.sunMin = Number(tr.value);
      const s = sunSample();
      q('#sun-time-val').textContent = fmtHourRound(s.t);
      q('#sun-time-info').textContent = sunInfo(s);
      document.getElementById('plan').innerHTML = planSvg();
    };
  }
  if (q('#weather')) showWeather();
  panel.querySelectorAll('#up-chips .chip').forEach((c) => { c.onclick = () => setUp(Number(c.dataset.v)); });
  const ur = q('#up-range');
  if (ur) {
    ur.oninput = () => {
      room.upBearing = Number(ur.value);
      q('#up-val').textContent = `${ur.value}° (${bearingLabel(room.upBearing)})`;
      document.getElementById('plan').innerHTML = planSvg();
    };
    ur.onchange = () => setUp(Number(ur.value));
  }
  on('#use-compass', measureCompass);
}

// Boussole du téléphone (iPhone : autorisation demandée une fois).
async function measureCompass() {
  const help = document.getElementById('compass-help');
  if (help) help.hidden = false;
  try {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) throw new Error('Boussole non disponible sur cet appareil.');
    if (typeof DOE.requestPermission === 'function') {
      const res = await DOE.requestPermission();
      if (res !== 'granted') throw new Error('Accès à la boussole refusé.');
    }
    const heading = await new Promise((resolve, reject) => {
      const samples = [];
      const timer = setTimeout(() => { cleanup(); samples.length ? resolve(samples[samples.length - 1]) : reject(new Error('Pas de mesure de la boussole. Réessayez en bougeant un peu le téléphone.')); }, 2500);
      const handler = (e) => {
        let h = null;
        if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
        else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha;
        if (h != null) samples.push(h);
        if (samples.length >= 8) { cleanup(); resolve(samples[samples.length - 1]); }
      };
      const cleanup = () => {
        clearTimeout(timer);
        window.removeEventListener('deviceorientation', handler);
        window.removeEventListener('deviceorientationabsolute', handler);
      };
      window.addEventListener('deviceorientation', handler);
      window.addEventListener('deviceorientationabsolute', handler);
    });
    await setUp(snap(heading, 5));
    ctx.toast(`Haut du plan orienté vers ${bearingLabel(heading).toLowerCase()} (${Math.round(heading)}°)`);
  } catch (err) {
    ctx.toast(err.message);
  }
}

