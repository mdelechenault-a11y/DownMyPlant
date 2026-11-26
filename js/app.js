import {
  listPlants, getPlant, savePlant, deletePlant, clearPlants, newId, requestPersistence, listRooms, saveRoom, clearRooms,
} from './db.js';
import { initRooms, renderRooms, renderRoom, placementOf, forgetPlant } from './rooms.js';
import { getSettings, saveSettings } from './settings.js';
import { compressImage, blobUrl, blobToBase64, base64ToBlob } from './image.js';
import { identifyPlant, testPlantnetKey, cleanKey, ORGANS } from './plantnet.js';
import { diagnosePlant, testAnthropicKey } from './diagnose.js';
import { APP_VERSION } from './version.js';
import { setSunDay } from './light.js';
import { getPlace, setPlace, searchCity, locateMe } from './sun.js';
import { seasonAdvice, seasonOf, SEASONS, fertilizeOk, seasonEnabled } from './season.js';
import { icon, iconBadge, plantArt, lulu, luluSays, TYPE_COLORS } from './ui.js';
import {
  EVENT_TYPES, normalizePlant, addEvent, removeEntry, daysSince, waterStats, timeline, historySummary, todayIso,
  photoHistory, referencePhoto, daysSinceLastPhoto,
} from './journal.js';

const view = document.getElementById('view');
const titleEl = document.getElementById('page-title');
const backBtn = document.getElementById('back-btn');
const toastEl = document.getElementById('toast');

// --- Utilitaires -----------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

const TYPE_ICONS = { water: 'drop', fertilize: 'sprout', repot: 'pot', note: 'note', photo: 'camera' };

// Photo de la plante, ou une illustration (différente pour chaque plante).
function plantVisual(p, cls = '') {
  return p.photo
    ? `<img class="${cls}" src="${blobUrl(p.photo)}" alt="">`
    : `<div class="ph art-bg ${cls}">${plantArt(p.id || p.scientificName || '', p.scientificName)}</div>`;
}

// Soif : plus de jours que le rythme conseillé en ce moment (saison comprise).
// Sans historique, on laisse un jour de marge au rythme par défaut.
function isThirsty(ws) {
  return !!(ws.last && ws.days != null && ws.days > ws.expected + (ws.learned ? 0 : 1));
}

function waterPill(ws) {
  if (!ws.last) return `<span class="pill none">${icon('drop', 13)}pas encore noté</span>`;
  if (isThirsty(ws)) return `<span class="pill thirsty">${icon('drop', 13)}Soif ? ${esc(agoText(ws.days))}</span>`;
  return `<span class="pill">${icon('drop', 13)}${ws.days <= 0 ? 'Arrosée !' : esc(agoText(ws.days))}</span>`;
}

function agoText(days) {
  if (days == null) return '';
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  return `il y a ${days} j`;
}

// Met à niveau (et réenregistre) les plantes créées par une version précédente.
function upgrade(p) {
  const needsSave = !Array.isArray(p.events) || 'lastWatered' in p || (p.diagnoses || []).some((d) => !d.id);
  normalizePlant(p);
  if (needsSave) savePlant(p).catch(() => {});
  return p;
}

async function loadPlant(id) {
  const p = await getPlant(id);
  return p ? upgrade(p) : null;
}

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
}

function setHeader(title, backTo) {
  titleEl.textContent = title;
  backBtn.hidden = !backTo;
  backBtn.onclick = backTo ? () => go(backTo) : null;
  document.title = title === 'Mes plantes' ? 'DownMyPlant' : `${title} · DownMyPlant`;
}

function setTab(route) {
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.route === route);
  });
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

// Sélecteur de photo : sur iPhone, propose « Prendre une photo » ou la photothèque.
function photoPicker(id, currentBlob, label = 'Prendre ou choisir une photo') {
  return `
    <label class="photo-picker" for="${id}">
      ${currentBlob
        ? `<img src="${blobUrl(currentBlob)}" alt="Photo sélectionnée">`
        : `<span class="big">${icon('camera', 28)}</span><span>${esc(label)}</span>`}
    </label>
    <input class="visually-hidden" type="file" id="${id}" accept="image/*">`;
}

async function readPhotoInput(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return null;
  return compressImage(file);
}

// --- État des parcours en cours --------------------------------------------

const identifyState = { photo: null, organ: 'auto', results: null, error: '', loading: false, remaining: null };
let addDraft = null; // { photo, scientificName, commonName, family }
const diagState = {}; // par id de plante : { photo, note, loading, error }

// --- Routeur ---------------------------------------------------------------

async function render() {
  const hash = location.hash || '#/plants';
  const [, route, param] = hash.split('/');
  window.scrollTo(0, 0);
  setSunDay(null); // la vue Soleil peut avoir choisi un autre jour
  try {
    switch (route) {
      case 'identify': setTab('identify'); return renderIdentify();
      case 'add': setTab('identify'); return renderAdd();
      case 'settings': setTab('settings'); return renderSettings();
      case 'rooms': setTab('rooms'); return renderRooms();
      case 'room': setTab('rooms'); return renderRoom(decodeURIComponent(param || ''));
      case 'plant': setTab('plants'); return renderPlant(decodeURIComponent(param || ''));
      default: setTab('plants'); return renderPlants();
    }
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="error">${esc(err.message || err)}</div>`;
  }
}

initRooms({ view, setHeader, go, toast, esc });
window.addEventListener('hashchange', render);
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => go(`#/${t.dataset.route}`));
});

// --- Mes plantes -----------------------------------------------------------

async function renderPlants() {
  setHeader('Mes plantes');
  const plants = (await listPlants()).map(upgrade);
  if (!plants.length) {
    view.innerHTML = `
      <div class="empty">
        ${lulu(130)}
        <div class="title">Coucou, moi c'est Lulu !</div>
        <p>Ton jardin est encore vide.</p>
        <p class="small">Prends une plante en photo : je t'aide à la reconnaître et à en prendre soin.</p>
      </div>
      <button class="btn" id="start">${icon('camera', 20)} Identifier une plante</button>
      ${keysNotice()}`;
    view.querySelector('#start').onclick = () => go('#/identify');
    return;
  }
  const thirsty = plants.filter((p) => isThirsty(waterStats(p))).length;
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  view.innerHTML = `
    <div class="list-head">
      <div class="muted"><strong>${plants.length} plante${plants.length > 1 ? 's' : ''}</strong> · ${esc(today)}</div>
      <button class="fab" id="add" aria-label="Ajouter une plante">${icon('plus', 22)}</button>
    </div>
    ${thirsty
      ? luluSays('Coucou !', `${thirsty} plante${thirsty > 1 ? 's ont' : ' a'} peut-être soif aujourd'hui. On s'en occupe ?`)
      : luluSays('Coucou !', `Tout le monde a l'air bien hydraté. ${esc(seasonHello())}`)}
    <div class="plant-grid">
      ${plants.map((p) => {
        const last = p.diagnoses?.[0]?.result?.etat_general;
        const ws = waterStats(p);
        return `
        <button class="plant-tile" data-id="${esc(p.id)}">
          ${plantVisual(p)}
          <div class="meta">
            <div class="name">${esc(p.nickname || p.commonName || p.scientificName || 'Sans nom')}</div>
            <div class="sp">${esc(p.scientificName || '')}</div>
            ${waterPill(ws)}
            ${last && last !== 'bon' ? `<div style="margin-top:5px">${etatBadge(last)}</div>` : ''}
          </div>
        </button>`;
      }).join('')}
    </div>`;
  view.querySelectorAll('.plant-tile').forEach((el) => {
    el.onclick = () => go(`#/plant/${encodeURIComponent(el.dataset.id)}`);
  });
  view.querySelector('#add').onclick = () => go('#/identify');
}

// Petit mot de saison de Lulu sur l'accueil.
function seasonHello() {
  if (!seasonEnabled()) return 'Belle journée au jardin !';
  return {
    hiver: 'C\'est l\'hiver : tes plantes se reposent, j\'ai espacé leurs arrosages.',
    printemps: 'C\'est le printemps : tout se réveille, on arrose un peu plus souvent.',
    ete: 'C\'est l\'été : tes plantes boivent plus, je surveille !',
    automne: 'Les jours raccourcissent : j\'espace doucement les arrosages.',
  }[seasonOf()];
}

function keysNotice() {
  const s = getSettings();
  if (s.plantnetKey) return '';
  return `<div class="notice" style="margin-top:16px">
    Première utilisation : ajoutez votre clé Pl@ntNet (gratuite) dans
    <a href="#/settings">Réglages</a> pour activer la reconnaissance.</div>`;
}

// --- Identifier ------------------------------------------------------------

function renderIdentify() {
  setHeader('Identifier');
  const s = identifyState;
  view.innerHTML = `
    <div class="stack">
      ${photoPicker('id-photo', s.photo)}
      <div>
        <label>Partie photographiée</label>
        <div class="chips" id="organs">
          ${ORGANS.map((o) => `<button class="chip ${o.value === s.organ ? 'active' : ''}" data-v="${o.value}">${o.label}</button>`).join('')}
        </div>
      </div>
      <button class="btn" id="run" ${!s.photo || s.loading ? 'disabled' : ''}>${icon('search', 20)} Reconnaître la plante</button>
      <div id="out">${identifyResultsHtml()}</div>
      ${keysNotice()}
    </div>`;

  view.querySelector('#id-photo').onchange = async (e) => {
    try {
      s.photo = await readPhotoInput(e.target);
      s.results = null; s.error = '';
    } catch (err) { s.error = err.message; }
    renderIdentify();
  };
  view.querySelectorAll('#organs .chip').forEach((c) => {
    c.onclick = () => { s.organ = c.dataset.v; renderIdentify(); };
  });
  view.querySelector('#run').onclick = runIdentify;
  view.querySelectorAll('[data-pick]').forEach((b) => {
    b.onclick = () => {
      const r = s.results[Number(b.dataset.pick)];
      addDraft = {
        photo: s.photo,
        scientificName: r.scientificName,
        commonName: r.commonNames[0] || '',
        family: r.family,
      };
      go('#/add');
    };
  });
  const manual = view.querySelector('#manual');
  if (manual) manual.onclick = () => {
    addDraft = { photo: s.photo, scientificName: '', commonName: '', family: '' };
    go('#/add');
  };
}

function identifyResultsHtml() {
  const s = identifyState;
  if (s.loading) return '<div class="loading"><span class="spinner"></span>Lulu cherche de quelle plante il s\'agit…</div>';
  if (s.error) return `<div class="error">${esc(s.error)}</div>`;
  if (!s.results) return '';
  const manualBtn = '<button class="btn secondary" id="manual" style="margin-top:8px">Ajouter sans identification</button>';
  if (!s.results.length) {
    return `<div class="card"><p>Aucune espèce reconnue. Essayez une photo plus nette, d'une feuille ou d'une fleur seule.</p>${manualBtn}</div>`;
  }
  return `
    <h3>Résultats</h3>
    ${s.results.map((r, i) => `
      <div class="card">
        <div class="result">
          ${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
          <div class="info">
            <div><strong>${esc(r.commonNames[0] || r.scientificName)}</strong></div>
            <div class="sci small">${esc(r.scientificName)}</div>
            ${r.family ? `<div class="muted small">Famille : ${esc(r.family)}</div>` : ''}
          </div>
          <span class="score">${Math.round(r.score * 100)} %</span>
        </div>
        <button class="btn ${i === 0 ? '' : 'secondary'}" data-pick="${i}" style="margin-top:10px">${icon('plus', 18)} Ajouter à mon parc</button>
      </div>`).join('')}
    ${manualBtn}
    ${s.remaining != null ? `<p class="muted small" style="margin-top:8px">Identifications Pl@ntNet restantes aujourd'hui : ${esc(s.remaining)}</p>` : ''}`;
}

async function runIdentify() {
  const s = identifyState;
  s.loading = true; s.error = ''; s.results = null;
  renderIdentify();
  try {
    s.results = await identifyPlant(s.photo, s.organ, getSettings().plantnetKey);
    s.remaining = s.results[0]?.remaining ?? null;
  } catch (err) {
    s.error = err.message;
  } finally {
    s.loading = false;
    if ((location.hash || '').startsWith('#/identify')) renderIdentify();
  }
}

// --- Ajouter une plante ----------------------------------------------------

function renderAdd() {
  if (!addDraft) { go('#/identify'); return; }
  setHeader('Nouvelle plante', '#/identify');
  const d = addDraft;
  view.innerHTML = `
    <form id="add-form" class="stack">
      ${photoPicker('add-photo', d.photo)}
      <div>
        <label for="nickname">Nom (surnom)</label>
        <input type="text" id="nickname" value="${esc(d.nickname ?? d.commonName)}" placeholder="Ex. : Le ficus du salon">
        <label for="sci">Espèce</label>
        <input type="text" id="sci" value="${esc(d.scientificName)}" placeholder="Nom scientifique">
        <label for="common">Nom commun</label>
        <input type="text" id="common" value="${esc(d.commonName)}">
        <label for="location">Emplacement</label>
        <input type="text" id="location" placeholder="Ex. : salon, près de la fenêtre est">
        <label for="notes">Notes</label>
        <textarea id="notes" placeholder="Date d'achat, rempotage, remarques…"></textarea>
      </div>
      <button class="btn" type="submit">Enregistrer dans mon parc</button>
    </form>`;

  view.querySelector('#add-photo').onchange = async (e) => {
    const blob = await readPhotoInput(e.target).catch(() => null);
    if (blob) { d.photo = blob; snapshotAddForm(); renderAdd(); }
  };
  view.querySelector('#add-form').onsubmit = async (e) => {
    e.preventDefault();
    snapshotAddForm();
    const plant = {
      id: newId(),
      nickname: d.nickname.trim(),
      scientificName: d.scientificName.trim(),
      commonName: d.commonName.trim(),
      family: d.family || '',
      location: d.location.trim(),
      notes: d.notes.trim(),
      photo: d.photo || null,
      createdAt: new Date().toISOString(),
      events: [],
      diagnoses: [],
    };
    await savePlant(plant);
    requestPersistence();
    addDraft = null;
    Object.assign(identifyState, { photo: null, results: null, error: '' });
    toast('Bienvenue dans le jardin 🌿');
    go(`#/plant/${encodeURIComponent(plant.id)}`);
  };
}

function snapshotAddForm() {
  const v = (id) => view.querySelector(`#${id}`)?.value ?? '';
  Object.assign(addDraft, {
    nickname: v('nickname'), scientificName: v('sci'), commonName: v('common'),
    location: v('location'), notes: v('notes'),
  });
}

// --- Fiche plante ----------------------------------------------------------

function etatBadge(etat) {
  const map = {
    bon: ['good', 'En forme'],
    moyen: ['warn', 'À surveiller'],
    mauvais: ['bad', 'En difficulté'],
    indetermine: ['warn', 'Indéterminé'],
  };
  const [cls, label] = map[etat] || map.indetermine;
  return `<span class="badge ${cls}">${icon('heart', 13)}${label}</span>`;
}

const EVOLUTION = {
  mieux: ['good', 'Va mieux'],
  stable: ['warn', 'Stable'],
  moins_bien: ['bad', 'Moins bien'],
};

function evolutionBadge(r) {
  const e = EVOLUTION[r?.evolution];
  return e ? `<span class="badge ${e[0]}">${icon('image', 13)}${e[1]}</span>` : '';
}

function diagDetailsHtml(entry) {
  const r = entry.result || {};
  return `
      ${r.evolution_detail && EVOLUTION[r.evolution] ? `<p class="small evo-detail">${icon('image', 15)} ${esc(r.evolution_detail)}</p>` : ''}
      ${entry.photo ? `<img class="hero" style="margin:8px 0;aspect-ratio:16/9" src="${blobUrl(entry.photo)}" alt="Photo du diagnostic">` : ''}
      ${entry.note ? `<p class="muted small">Remarque : ${esc(entry.note)}</p>` : ''}
      ${r.problemes?.length ? `
        <h3>Problèmes repérés</h3>
        ${r.problemes.map((p) => `
          <div class="prob">
            <div class="prob-head"><strong>${esc(p.nom)}</strong><span class="badge ${gravClass(p.gravite)}">gravité ${esc(p.gravite)}</span></div>
            <div class="small muted">${esc(p.signes)}. Cause probable : ${esc(p.cause_probable)}</div>
          </div>`).join('')}` : ''}
      ${r.conseils?.length ? `<h3>Que faire ?</h3><ul class="todo">${r.conseils.map((c) => `<li><span class="ck">${icon('check', 13)}</span><span>${esc(c)}</span></li>`).join('')}</ul>` : ''}
      <dl class="kv" style="margin-top:10px">
        ${r.arrosage ? `<dt>${icon('drop', 15)} Arrosage</dt><dd>${esc(r.arrosage)}</dd>` : ''}
        ${r.lumiere ? `<dt>${icon('sun', 15)} Lumière</dt><dd>${esc(r.lumiere)}</dd>` : ''}
        ${r.a_surveiller ? `<dt>${icon('eye', 15)} À surveiller</dt><dd>${esc(r.a_surveiller)}</dd>` : ''}
      </dl>`;
}

function gravClass(g) {
  const v = String(g || '').toLowerCase();
  if (v.startsWith('élev') || v.startsWith('elev') || v.startsWith('fort')) return 'bad';
  if (v.startsWith('moy')) return 'warn';
  return 'good';
}

function tlDot(type) {
  const name = type === 'diagnosis' ? 'heart' : (TYPE_ICONS[type] || 'note');
  return `<span class="tl-dot" style="--c:${TYPE_COLORS[type] || TYPE_COLORS.note}" aria-hidden="true">${icon(name, 16)}</span>`;
}

function timelineItemHtml(item, open) {
  const del = `<button class="link-btn" data-del="${esc(item.id)}" aria-label="Supprimer cette entrée">Supprimer</button>`;
  if (item.kind === 'diagnosis') {
    const r = item.result || {};
    return `
      <li class="tl-item">
        ${tlDot('diagnosis')}
        <div class="tl-body">
          <div class="row"><strong>Diagnostic</strong><span class="muted small">${esc(fmtDate(item.date))}</span></div>
          <div class="badge-row">${etatBadge(r.etat_general)}${evolutionBadge(r)}</div>
          <p class="small">${esc(r.resume)}</p>
          <details ${open ? 'open' : ''}><summary class="small">Détails et conseils</summary>${diagDetailsHtml(item)}</details>
          ${del}
        </div>
      </li>`;
  }
  const t = EVENT_TYPES[item.type] || EVENT_TYPES.note;
  return `
    <li class="tl-item">
      ${tlDot(item.type)}
      <div class="tl-body">
        <div class="row"><strong>${t.label}</strong><span class="muted small">${esc(fmtDate(item.date))}</span></div>
        ${item.text ? `<p class="small" style="margin-top:4px">${esc(item.text)}</p>` : ''}
        ${item.photo ? `<img class="tl-photo" src="${blobUrl(item.photo)}" alt="Photo du ${esc(fmtDate(item.date))}">` : ''}
        ${del}
      </div>
    </li>`;
}

function fmtShort(iso) {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: sameYear ? 'long' : 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

// --- Suivi photo -------------------------------------------------------------

const photoState = {}; // par plante : { before (id de la photo « avant »), playing }
let playTimer = null;

function photoCardHtml(p, ps) {
  const all = photoHistory(p);
  const since = daysSinceLastPhoto(p);
  const nudge = since == null || since >= 30;
  const add = `<label class="btn secondary" for="track-photo" style="margin:0">${icon('camera', 19)} Nouvelle photo</label>
    <input class="visually-hidden" type="file" id="track-photo" accept="image/*">`;
  if (all.length < 2) {
    return `<div class="card">
      <h2>Suivi photo</h2>
      <p class="muted small">Prenez une photo de temps en temps, sous le même angle : vous verrez votre plante grandir, et le diagnostic dira si elle va mieux.</p>
      <div class="btn-row">${add}</div>
    </div>`;
  }
  const after = all[all.length - 1];
  const before = all.find((x) => x.id === ps.before && x !== after) || all[0];
  const span = daysSince(before.date) - daysSince(after.date);
  return `<div class="card photo-card">
    <div class="row"><h2>Suivi photo</h2><span class="muted small">${all.length} photos</span></div>
    ${nudge ? `<p class="small nudge">${icon('sparkle', 15)} ${since == null ? '' : `Dernière photo il y a ${since} jours. `}Une nouvelle photo ce mois-ci ?</p>` : ''}
    <div class="compare" id="compare" style="--pos:50%">
      <img src="${blobUrl(after.blob)}" alt="Photo du ${esc(fmtDate(after.date))}">
      <img class="compare-before" src="${blobUrl(before.blob)}" alt="Photo du ${esc(fmtDate(before.date))}">
      <span class="compare-line"></span>
      <span class="compare-tag left">${esc(fmtShort(before.date))}</span>
      <span class="compare-tag right">${esc(fmtShort(after.date))}</span>
      <input type="range" id="compare-range" min="0" max="100" value="50" aria-label="Comparer avant et après">
    </div>
    <p class="muted small compare-help">Glissez pour comparer${span > 0 ? ` : ${span} jours d'écart` : ''}. Touchez une vignette pour changer la photo « avant ».</p>
    <div class="frise" id="frise">
      ${all.map((x) => `<button class="frise-item ${x === before ? 'before' : ''} ${x === after ? 'after' : ''}" data-ph="${esc(x.id)}" ${x === after ? 'disabled' : ''}>
        <img src="${blobUrl(x.blob)}" alt="">
        <span>${esc(fmtShort(x.date))}</span>
        ${x.source === 'diagnosis' && x.etat ? `<i class="dot ${({ bon: 'good', moyen: 'warn', mauvais: 'bad' })[x.etat] || 'warn'}"></i>` : ''}
      </button>`).join('')}
    </div>
    <div class="btn-row">
      <button class="btn secondary" id="play-photos">${icon('eye', 19)} Animer</button>
      ${add}
    </div>
  </div>`;
}

// Diaporama plein écran des photos, de la plus ancienne à la plus récente.
function playPhotos(all) {
  clearInterval(playTimer);
  const ov = document.createElement('div');
  ov.className = 'timelapse';
  ov.innerHTML = `<img alt=""><div class="tl-caption"></div><div class="tl-progress"><i></i></div><button class="icon-btn tl-close" aria-label="Fermer">${icon('close', 20)}</button>`;
  document.body.appendChild(ov);
  const img = ov.querySelector('img'); const cap = ov.querySelector('.tl-caption'); const bar = ov.querySelector('.tl-progress i');
  let i = 0;
  const show = () => {
    const x = all[i];
    img.src = blobUrl(x.blob);
    cap.textContent = fmtDate(x.date);
    bar.style.width = `${((i + 1) / all.length) * 100}%`;
  };
  const close = () => { clearInterval(playTimer); ov.remove(); };
  show();
  playTimer = setInterval(() => {
    i += 1;
    if (i >= all.length) { clearInterval(playTimer); return; }
    show();
  }, 900);
  ov.onclick = close;
}

function bindPhotoCard(p, ps) {
  const input = view.querySelector('#track-photo');
  if (input) {
    input.onchange = async (e) => {
      const blob = await readPhotoInput(e.target).catch(() => null);
      if (!blob) return;
      const fresh = await loadPlant(p.id);
      addEvent(fresh, { type: 'photo', photo: blob });
      await savePlant(fresh);
      toast('Photo ajoutée au suivi');
      renderPlant(p.id);
    };
  }
  const cmp = view.querySelector('#compare');
  const range = view.querySelector('#compare-range');
  if (cmp && range) range.oninput = () => cmp.style.setProperty('--pos', `${range.value}%`);
  view.querySelectorAll('#frise .frise-item').forEach((b) => {
    b.onclick = () => { ps.before = b.dataset.ph; renderPlant(p.id); };
  });
  const play = view.querySelector('#play-photos');
  if (play) play.onclick = () => playPhotos(photoHistory(p));
  const frise = view.querySelector('#frise');
  if (frise) frise.scrollLeft = frise.scrollWidth;
}

// Rythme d'arrosage conseillé en ce moment, et d'où il vient.
function rhythmText(p, ws) {
  const season = seasonEnabled() ? ` en ${SEASONS[seasonOf()].label.toLowerCase()}` : '';
  const every = `tous les ${ws.expected} jour${ws.expected > 1 ? 's' : ''}`;
  if (ws.learned) {
    return `Conseillé${season} : ${every}${ws.avg !== ws.expected ? ` (votre moyenne : ${ws.avg} j)` : ''}`;
  }
  return `Conseillé${season} : environ ${every}. Notez les arrosages pour affiner.`;
}

// Brouillon du formulaire « Ajouter au journal », par plante.
const entryState = {};

async function renderPlant(id) {
  const p = await loadPlant(id);
  if (!p) { go('#/plants'); return; }
  const name = p.nickname || p.commonName || p.scientificName || 'Ma plante';
  setHeader(name, '#/plants');
  titleEl.textContent = 'Ma plante';
  const ds = diagState[id] || (diagState[id] = { photo: null, note: '', loading: false, error: '' });
  const es = entryState[id] || (entryState[id] = { open: false, type: 'note', date: todayIso(), text: '', photo: null });
  const ws = waterStats(p);
  const items = timeline(p);
  const firstDiag = items.find((i) => i.kind === 'diagnosis');

  showRoomChip(p.id);
  const late = isThirsty(ws);
  const waterRatio = ws.last ? Math.min(1, Math.max(0.04, ws.days / ws.expected)) : 0;
  const sa = seasonAdvice(p);
  const ps = photoState[id] || (photoState[id] = { before: null, playing: false });
  const ref = referencePhoto(p);
  view.innerHTML = `
    <div class="plant-head">
      <div class="thumb art-bg">${p.photo ? `<img src="${blobUrl(p.photo)}" alt="${esc(name)}">` : plantArt(p.id || p.scientificName || '', p.scientificName)}</div>
      <div style="min-width:0">
        <h2>${esc(name)}</h2>
        ${p.scientificName ? `<p class="sci">${esc(p.scientificName)}${p.family ? ` · ${esc(p.family)}` : ''}</p>` : ''}
        ${p.location ? `<div class="chips"><span class="chip static">${icon('pin', 13)}${esc(p.location)}</span></div>` : ''}
      </div>
    </div>
    <div class="card">
      <div class="water-box">
        ${iconBadge('drop', late ? 'var(--warn)' : 'var(--water)')}
        <div>
          <div class="water-main">${ws.last ? `Arrosée ${esc(agoText(ws.days))}` : 'Aucun arrosage noté'}</div>
          <div class="muted small">${rhythmText(p, ws)}${late ? ' · <span class="late">arrosage peut-être dû</span>' : ''}</div>
        </div>
      </div>
      ${ws.last ? `<div class="water-bar ${late ? 'late' : ''}"><i style="width:${Math.round(waterRatio * 100)}%"></i></div>` : ''}
    </div>
    ${seasonEnabled() ? `<details class="card season-card">
      <summary>
        ${iconBadge(sa.icon, sa.color)}
        <div><div class="season-kicker">${esc(sa.label)} · ${esc(sa.month)}</div><div class="season-title">${esc(sa.title)}</div></div>
        <span class="season-more">Conseils</span>
      </summary>
      <p class="small">${esc(sa.text)}</p>
      <ul class="todo">${sa.tips.map((t) => `<li><span class="ck">${icon('check', 13)}</span><span>${esc(t)}</span></li>`).join('')}</ul>
      ${sa.rhythm ? `<p class="muted small">${esc(sa.rhythm)}</p>` : ''}
    </details>` : ''}
    <div class="quick-row">
      <button class="quick" data-quick="water">${iconBadge('drop', 'var(--water)')}Arrosée</button>
      <button class="quick" data-quick="fertilize">${iconBadge('sprout', 'var(--ok)')}Engrais</button>
      <button class="quick" data-quick="repot">${iconBadge('pot', 'var(--warn)')}Rempotée</button>
      <button class="quick ${es.open ? 'on' : ''}" id="open-entry">${iconBadge('note', 'var(--primary)')}Note / photo</button>
    </div>
      ${es.open ? `
      <div class="card entry-form">
        <h2>Ajouter au journal</h2>
        <label>Type</label>
        <div class="chips" id="entry-types">
          ${Object.entries(EVENT_TYPES).map(([k, t]) => `<button class="chip ${k === es.type ? 'active' : ''}" data-t="${k}">${icon(TYPE_ICONS[k] || 'note', 15)}${t.label}</button>`).join('')}
        </div>
        <label for="entry-date">Date</label>
        <input type="date" id="entry-date" value="${esc(es.date)}" max="${todayIso()}">
        <label for="entry-text">Texte</label>
        <textarea id="entry-text" placeholder="Ex. : nouvelle feuille, déplacée près de la fenêtre…">${esc(es.text)}</textarea>
        <label>Photo (facultatif)</label>
        ${photoPicker('entry-photo', es.photo, 'Ajouter une photo')}
        <div class="btn-row">
          <button class="btn secondary" id="entry-cancel">Annuler</button>
          <button class="btn" id="entry-save">Ajouter</button>
        </div>
      </div>` : ''}

    ${photoCardHtml(p, ps)}

    <div class="card">
      <h2>Diagnostic</h2>
      ${luluSays('Un souci ?', ref
        ? `Montre-moi la plante : je la compare avec la photo du ${esc(fmtShort(ref.date))} pour te dire si elle va mieux.`
        : 'Montre-moi la plante (ou la partie abîmée) : je regarde son état et je te donne des conseils.', 56)}
      <p class="muted small">Le journal (arrosages, notes) est pris en compte. Coût : une fraction de centime.</p>
      ${photoPicker('diag-photo', ds.photo || null, 'Nouvelle photo pour le diagnostic')}
      <label for="diag-note">Ce que vous avez remarqué (facultatif)</label>
      <textarea id="diag-note" placeholder="Ex. : feuilles qui jaunissent depuis une semaine">${esc(ds.note)}</textarea>
      ${ds.error ? `<div class="error" style="margin-top:10px">${esc(ds.error)}</div>` : ''}
      ${ds.loading
        ? '<div class="loading"><span class="spinner"></span>Lulu examine ta plante…</div>'
        : `<div class="btn-row"><button class="btn" id="diag-run" ${!(ds.photo || p.photo) ? 'disabled' : ''}>${icon('heart', 19)} ${ds.photo ? 'Diagnostiquer' : 'Diagnostiquer avec la photo principale'}</button></div>`}
    </div>

    <div class="card">
      <h2>Journal</h2>
      ${items.length
        ? `<ul class="timeline">${items.map((i) => timelineItemHtml(i, i === firstDiag)).join('')}</ul>`
        : '<p class="muted small">Rien pour l\'instant. Notez un arrosage, un engrais ou une observation avec les boutons du haut.</p>'}
    </div>

    <div class="card">
      <h2>Infos</h2>
      <p class="muted small">Ajoutée le ${esc(fmtDate(p.createdAt))}</p>
      <label for="loc">Emplacement</label>
      <input type="text" id="loc" value="${esc(p.location)}">
      <label for="nick">Surnom</label>
      <input type="text" id="nick" value="${esc(p.nickname)}">
      <label for="pnotes">Notes générales</label>
      <textarea id="pnotes">${esc(p.notes)}</textarea>
      <div class="btn-row"><button class="btn secondary" id="save-notes">Enregistrer</button></div>
      <div class="btn-row">
        <label class="btn secondary" for="main-photo" style="margin:0">${icon('camera', 19)} Changer la photo principale</label>
        <input class="visually-hidden" type="file" id="main-photo" accept="image/*">
      </div>
    </div>

    <button class="btn danger" id="delete">Supprimer cette plante</button>`;

  const $ = (sel) => view.querySelector(sel);
  bindPhotoCard(p, ps);

  view.querySelectorAll('[data-quick]').forEach((b) => {
    b.onclick = async () => {
      const type = b.dataset.quick;
      const fresh = await loadPlant(id);
      if (type === 'water' && fresh.events.some((e) => e.type === 'water' && e.date === todayIso())
        && !confirm("Un arrosage est déjà noté aujourd'hui. En ajouter un autre ?")) return;
      if (type === 'fertilize' && !fertilizeOk()
        && !confirm('C\'est la période de repos : l\'engrais n\'est pas conseillé avant le printemps. Le noter quand même ?')) return;
      addEvent(fresh, { type });
      await savePlant(fresh);
      toast(`${EVENT_TYPES[type].icon} ${EVENT_TYPES[type].label} noté`);
      renderPlant(id);
    };
  });
  $('#open-entry').onclick = () => { es.open = !es.open; renderPlant(id); };
  if (es.open) {
    const snap = () => { es.date = $('#entry-date').value || todayIso(); es.text = $('#entry-text').value; };
    view.querySelectorAll('#entry-types .chip').forEach((c) => {
      c.onclick = () => { snap(); es.type = c.dataset.t; renderPlant(id); };
    });
    $('#entry-photo').onchange = async (e) => {
      snap();
      const blob = await readPhotoInput(e.target).catch(() => null);
      if (blob) { es.photo = blob; if (es.type === 'note' && !es.text) es.type = 'photo'; }
      renderPlant(id);
    };
    $('#entry-cancel').onclick = () => { entryState[id] = null; delete entryState[id]; renderPlant(id); };
    $('#entry-save').onclick = async () => {
      snap();
      if (!es.text.trim() && !es.photo && (es.type === 'note' || es.type === 'photo')) {
        toast('Ajoutez un texte ou une photo');
        return;
      }
      const fresh = await loadPlant(id);
      addEvent(fresh, { type: es.type, date: es.date, text: es.text.trim(), photo: es.photo });
      await savePlant(fresh);
      delete entryState[id];
      toast('Ajouté au journal');
      renderPlant(id);
    };
  }

  view.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Supprimer cette entrée du journal ?')) return;
      const fresh = await loadPlant(id);
      removeEntry(fresh, b.dataset.del);
      await savePlant(fresh);
      renderPlant(id);
    };
  });

  $('#diag-photo').onchange = async (e) => {
    ds.note = $('#diag-note').value;
    const blob = await readPhotoInput(e.target).catch(() => null);
    if (blob) { ds.photo = blob; ds.error = ''; }
    renderPlant(id);
  };
  $('#diag-note').oninput = (e) => { ds.note = e.target.value; };
  const runBtn = $('#diag-run');
  if (runBtn) runBtn.onclick = () => runDiagnosis(p, ds);

  $('#save-notes').onclick = async () => {
    const fresh = await loadPlant(id);
    fresh.location = $('#loc').value.trim();
    fresh.nickname = $('#nick').value.trim();
    fresh.notes = $('#pnotes').value.trim();
    await savePlant(fresh);
    toast('Enregistré');
    renderPlant(id);
  };
  $('#main-photo').onchange = async (e) => {
    const blob = await readPhotoInput(e.target).catch(() => null);
    if (blob) {
      const fresh = await loadPlant(id);
      // L'ancienne photo principale reste dans le suivi photo.
      if (fresh.photo) {
        addEvent(fresh, { type: 'photo', date: (fresh.photoAt || fresh.createdAt || todayIso()).slice(0, 10), text: 'Ancienne photo principale', photo: fresh.photo });
      }
      fresh.photo = blob;
      fresh.photoAt = todayIso();
      await savePlant(fresh);
      renderPlant(id);
    }
  };
  $('#delete').onclick = async () => {
    if (!confirm(`Supprimer « ${name} » de votre parc ?`)) return;
    await deletePlant(id);
    await forgetPlant(id);
    delete diagState[id];
    delete entryState[id];
    toast('Plante supprimée');
    go('#/plants');
  };
}

// Pièce où se trouve la plante (module Pièces), affichée sous son nom.
async function showRoomChip(plantId) {
  const place = await placementOf(plantId).catch(() => null);
  const head = view.querySelector('.plant-head > div:last-child');
  if (!place || !head || location.hash !== `#/plant/${encodeURIComponent(plantId)}`) return;
  let chips = head.querySelector('.chips');
  if (!chips) { chips = document.createElement('div'); chips.className = 'chips'; head.appendChild(chips); }
  const a = document.createElement('a');
  a.className = 'chip';
  a.href = `#/room/${encodeURIComponent(place.room.id)}`;
  a.innerHTML = `${icon('home', 13)}${esc(place.room.name)}`;
  chips.appendChild(a);
}

async function runDiagnosis(plant, ds) {
  ds.loading = true; ds.error = '';
  const onPage = () => location.hash === `#/plant/${encodeURIComponent(plant.id)}`;
  renderPlant(plant.id);
  try {
    const photo = ds.photo || plant.photo;
    // La place sur le plan (pièce, fenêtre, lumière) aide le diagnostic.
    const place = await placementOf(plant.id).catch(() => null);
    const { result } = await diagnosePlant({
      photoBlob: photo,
      plant: place ? { ...plant, location: [place.text, plant.location].filter(Boolean).join(' — ') } : plant,
      history: historySummary(plant),
      userNote: ds.note.trim(),
      apiKey: getSettings().anthropicKey,
      previous: referencePhoto(plant),
    });
    const fresh = (await loadPlant(plant.id)) || plant;
    fresh.diagnoses = [
      { id: newId(), date: new Date().toISOString(), photo: ds.photo || null, note: ds.note.trim(), result },
      ...fresh.diagnoses,
    ];
    await savePlant(fresh);
    ds.photo = null; ds.note = '';
    toast('Diagnostic prêt');
  } catch (err) {
    ds.error = err.message;
  } finally {
    ds.loading = false;
    if (onPage()) renderPlant(plant.id);
  }
}

// --- Réglages --------------------------------------------------------------

const THEMES = [['light', 'Clair'], ['dark', 'Sombre'], ['auto', 'Automatique']];

// Applique le thème : clair par défaut, sombre, ou automatique (suit le réglage de l'iPhone).
function applyTheme(theme) {
  const t = THEMES.some(([k]) => k === theme) ? theme : 'light';
  document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1f1a19' : '#fbf6ee');
}
applyTheme(getSettings().theme);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(getSettings().theme));

function renderSettings() {
  setHeader('Réglages');
  const s = getSettings();
  const theme = s.theme || 'light';
  view.innerHTML = `
    <div class="card">
      <h2>Apparence</h2>
      <div class="chips" id="theme">
        ${THEMES.map(([k, label]) => `<button class="chip ${k === theme ? 'active' : ''}" data-theme="${k}">${label}</button>`).join('')}
      </div>
      <p class="muted small" style="margin-top:8px">« Automatique » suit le mode clair ou sombre de l'iPhone.</p>
    </div>
    <div class="card">
      <h2>Ma ville</h2>
      <p class="muted small">Sert à calculer la vraie course du soleil dans vos pièces (heures de soleil par fenêtre, selon la saison) et à afficher la météo. La recherche passe par Open-Meteo, gratuit et sans compte.</p>
      <p class="small" id="place-now">${icon('pin', 14)} <strong>${esc(getPlace().name || 'Ma position')}</strong>${getPlace().isDefault ? ' (par défaut)' : ''}</p>
      <div class="search-row">
        <input type="text" id="city" placeholder="Ex. : Lyon" autocomplete="off">
        <button class="btn secondary" id="city-search">${icon('search', 18)}</button>
      </div>
      <div class="chips" id="city-results" style="margin-top:8px"></div>
      <div class="btn-row"><button class="btn secondary" id="locate">${icon('compass', 18)} Utiliser ma position</button></div>
    </div>
    <div class="card">
      <h2>Saisons</h2>
      <p class="muted small">Le rythme d'arrosage conseillé et les conseils s'adaptent au mois : arrosages espacés en hiver, plus fréquents en été.</p>
      <div class="chips" id="season-mode">
        <button class="chip ${s.seasonMode !== false ? 'active' : ''}" data-v="on">Activé</button>
        <button class="chip ${s.seasonMode === false ? 'active' : ''}" data-v="off">Désactivé</button>
      </div>
      <label>Hémisphère</label>
      <div class="chips" id="hemisphere">
        <button class="chip ${s.hemisphere !== 'south' ? 'active' : ''}" data-v="north">Nord (France, Europe…)</button>
        <button class="chip ${s.hemisphere === 'south' ? 'active' : ''}" data-v="south">Sud</button>
      </div>
    </div>
    <div class="card">
      <h2>Reconnaissance (Pl@ntNet)</h2>
      <p class="muted small">Gratuit, 500 identifications par jour. Créez un compte sur
        <a href="https://my.plantnet.org/" target="_blank" rel="noopener">my.plantnet.org</a>,
        copiez votre clé, et ajoutez <strong>${esc(location.hostname || 'votre domaine')}</strong>
        dans les « domaines autorisés ».</p>
      <label for="pn">Clé API Pl@ntNet</label>
      <input type="password" id="pn" value="${esc(s.plantnetKey)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
      <p class="muted small" id="pn-info" style="margin-top:6px">${keyInfo(s.plantnetKey)}</p>
      <div class="btn-row"><button class="btn secondary" id="pn-test">Tester la clé Pl@ntNet</button></div>
      <div id="pn-result" style="margin-top:8px"></div>
    </div>
    <div class="card">
      <h2>Diagnostic (Claude)</h2>
      <p class="muted small">Utilisé seulement quand vous lancez un diagnostic. Créez une clé sur
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>
        et ajoutez quelques euros de crédit : un diagnostic coûte moins d'un centime.</p>
      <label for="an">Clé API Anthropic</label>
      <input type="password" id="an" value="${esc(s.anthropicKey)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
      <p class="muted small" id="an-info" style="margin-top:6px">${keyInfo(s.anthropicKey, 7)}</p>
      <div class="btn-row"><button class="btn secondary" id="an-test">Tester la clé Anthropic</button></div>
      <div id="an-result" style="margin-top:8px"></div>
    </div>
    <button class="btn" id="save">Enregistrer les clés</button>
    <p class="muted small" style="margin-top:8px">Les clés restent sur cet appareil et ne sont envoyées qu'à Pl@ntNet et Anthropic.</p>

    <div class="card" style="margin-top:16px">
      <h2>Sauvegarde</h2>
      <p class="muted small">Exportez votre parc (photos comprises) dans un fichier, pour le garder ou le transférer sur un autre appareil.</p>
      <div class="btn-row">
        <button class="btn secondary" id="export">Exporter</button>
        <label class="btn secondary" for="import" style="margin:0">Importer</label>
        <input class="visually-hidden" type="file" id="import" accept="application/json,.json">
      </div>
      <p class="muted small" id="storage" style="margin-top:8px"></p>
    </div>

    <div class="card">
      <h2>Application</h2>
      <dl class="kv">
        <dt>Version</dt><dd><strong>${esc(APP_VERSION)}</strong></dd>
        <dt>Hors connexion</dt><dd id="sw-version">…</dd>
        <dt>En ligne</dt><dd id="online-version">…</dd>
      </dl>
      <div class="btn-row"><button class="btn secondary" id="check-update">Rechercher une mise à jour</button></div>
      <div class="btn-row"><button class="btn secondary" id="force-update">Forcer la mise à jour</button></div>
      <p class="muted small" style="margin-top:8px">« Forcer » vide le cache de l'app et la recharge. Vos plantes et vos clés ne sont pas effacées.</p>
    </div>`;

  const saveKeys = () => saveSettings({
    plantnetKey: cleanKey(view.querySelector('#pn').value),
    anthropicKey: cleanKey(view.querySelector('#an').value),
  });
  view.querySelector('#save').onclick = () => {
    const saved = saveKeys();
    view.querySelector('#pn-info').innerHTML = keyInfo(saved.plantnetKey);
    view.querySelector('#an-info').innerHTML = keyInfo(saved.anthropicKey, 7);
    toast('Clés enregistrées');
  };
  view.querySelector('#pn').oninput = (e) => {
    view.querySelector('#pn-info').innerHTML = keyInfo(cleanKey(e.target.value));
  };
  view.querySelector('#an').oninput = (e) => {
    view.querySelector('#an-info').innerHTML = keyInfo(cleanKey(e.target.value), 7);
  };
  view.querySelector('#an-test').onclick = async (e) => {
    const btn = e.currentTarget;
    const out = view.querySelector('#an-result');
    const saved = saveKeys();
    btn.disabled = true;
    out.innerHTML = '<div class="loading"><span class="spinner"></span>Test en cours…</div>';
    const r = await testAnthropicKey(saved.anthropicKey);
    out.innerHTML = `<div class="${r.ok ? 'success' : 'error'}">${esc(r.message)}</div>`;
    btn.disabled = false;
  };
  view.querySelector('#pn-test').onclick = async (e) => {
    const btn = e.currentTarget;
    const out = view.querySelector('#pn-result');
    const saved = saveKeys();
    btn.disabled = true;
    out.innerHTML = '<div class="loading"><span class="spinner"></span>Test en cours…</div>';
    const r = await testPlantnetKey(saved.plantnetKey);
    out.innerHTML = `<div class="${r.ok ? 'success' : 'error'}">${esc(r.message)}</div>`;
    btn.disabled = false;
  };
  view.querySelectorAll('#theme .chip').forEach((c) => {
    c.onclick = () => {
      saveSettings({ theme: c.dataset.theme });
      applyTheme(c.dataset.theme);
      view.querySelectorAll('#theme .chip').forEach((x) => x.classList.toggle('active', x === c));
    };
  });
  const placeNow = () => {
    const pl = getPlace();
    view.querySelector('#place-now').innerHTML = `${icon('pin', 14)} <strong>${esc(pl.name || 'Ma position')}</strong>${pl.isDefault ? ' (par défaut)' : ''}`;
  };
  const runSearch = async () => {
    const q = view.querySelector('#city').value.trim();
    const out = view.querySelector('#city-results');
    if (!q) return;
    out.innerHTML = '<span class="muted small">Recherche…</span>';
    try {
      const list = await searchCity(q);
      if (!list.length) { out.innerHTML = '<span class="muted small">Aucune ville trouvée.</span>'; return; }
      out.innerHTML = list.map((c, i) => `<button class="chip" data-i="${i}">${esc(c.name)}<span class="muted small">&nbsp;${esc(c.detail)}</span></button>`).join('');
      out.querySelectorAll('.chip').forEach((b) => {
        b.onclick = () => { setPlace(list[Number(b.dataset.i)]); out.innerHTML = ''; placeNow(); toast('Ville enregistrée'); };
      });
    } catch (err) {
      out.innerHTML = `<span class="muted small">${esc(err.message || 'Recherche impossible hors connexion.')}</span>`;
    }
  };
  view.querySelector('#city-search').onclick = runSearch;
  view.querySelector('#city').onkeydown = (e) => { if (e.key === 'Enter') runSearch(); };
  view.querySelector('#locate').onclick = async () => {
    try {
      const pos = await locateMe();
      setPlace({ ...pos, name: 'Ma position' });
      placeNow();
      toast('Position enregistrée');
    } catch (err) { toast(err.message); }
  };
  view.querySelectorAll('#season-mode .chip').forEach((c) => {
    c.onclick = () => {
      saveSettings({ seasonMode: c.dataset.v === 'on' });
      const placeNow = () => {
    const pl = getPlace();
    view.querySelector('#place-now').innerHTML = `${icon('pin', 14)} <strong>${esc(pl.name || 'Ma position')}</strong>${pl.isDefault ? ' (par défaut)' : ''}`;
  };
  const runSearch = async () => {
    const q = view.querySelector('#city').value.trim();
    const out = view.querySelector('#city-results');
    if (!q) return;
    out.innerHTML = '<span class="muted small">Recherche…</span>';
    try {
      const list = await searchCity(q);
      if (!list.length) { out.innerHTML = '<span class="muted small">Aucune ville trouvée.</span>'; return; }
      out.innerHTML = list.map((c, i) => `<button class="chip" data-i="${i}">${esc(c.name)}<span class="muted small">&nbsp;${esc(c.detail)}</span></button>`).join('');
      out.querySelectorAll('.chip').forEach((b) => {
        b.onclick = () => { setPlace(list[Number(b.dataset.i)]); out.innerHTML = ''; placeNow(); toast('Ville enregistrée'); };
      });
    } catch (err) {
      out.innerHTML = `<span class="muted small">${esc(err.message || 'Recherche impossible hors connexion.')}</span>`;
    }
  };
  view.querySelector('#city-search').onclick = runSearch;
  view.querySelector('#city').onkeydown = (e) => { if (e.key === 'Enter') runSearch(); };
  view.querySelector('#locate').onclick = async () => {
    try {
      const pos = await locateMe();
      setPlace({ ...pos, name: 'Ma position' });
      placeNow();
      toast('Position enregistrée');
    } catch (err) { toast(err.message); }
  };
  view.querySelectorAll('#season-mode .chip').forEach((x) => x.classList.toggle('active', x === c));
    };
  });
  view.querySelectorAll('#hemisphere .chip').forEach((c) => {
    c.onclick = () => {
      saveSettings({ hemisphere: c.dataset.v });
      view.querySelectorAll('#hemisphere .chip').forEach((x) => x.classList.toggle('active', x === c));
    };
  });
  view.querySelector('#export').onclick = exportBackup;
  view.querySelector('#check-update').onclick = checkForUpdate;
  view.querySelector('#force-update').onclick = forceUpdate;
  showVersions();
  view.querySelector('#import').onchange = (e) => importBackup(e.target);
  showStorage();
}

// Aide à vérifier une clé sans l'afficher en entier.
function keyInfo(key, head = 4) {
  if (!key) return 'Aucune clé enregistrée.';
  return `Clé de ${key.length} caractères, commence par <strong>${esc(key.slice(0, head))}</strong> et finit par <strong>${esc(key.slice(-4))}</strong>.`;
}

async function showStorage() {
  const el = view.querySelector('#storage');
  if (!el || !navigator.storage?.estimate) return;
  try {
    const { usage } = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    el.textContent = `Espace utilisé : ${(usage / 1048576).toFixed(1)} Mo${persisted ? ' · stockage persistant' : ''}`;
  } catch { /* ignoré */ }
}

async function exportBackup() {
  const plants = await listPlants();
  const out = [];
  for (const p of plants) {
    out.push({
      ...p,
      photo: p.photo ? await blobToBase64(p.photo) : null,
      diagnoses: await Promise.all((p.diagnoses || []).map(async (d) => ({
        ...d, photo: d.photo ? await blobToBase64(d.photo) : null,
      }))),
      events: await Promise.all((p.events || []).map(async (e) => ({
        ...e, photo: e.photo ? await blobToBase64(e.photo) : null,
      }))),
    });
  }
  const rooms = await listRooms();
  const blob = new Blob([JSON.stringify({ app: 'DownMyPlant', version: 3, exportedAt: new Date().toISOString(), plants: out, rooms })], { type: 'application/json' });
  const file = new File([blob], `downmyplant-${todayIso()}.json`, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Sauvegarde DownMyPlant' }); return; } catch { /* repli */ }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function importBackup(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.plants)) throw new Error('Fichier non reconnu.');
    const replace = confirm('Remplacer votre parc actuel par cette sauvegarde ?\n(Annuler = ajouter les plantes à celles existantes)');
    if (replace) { await clearPlants(); await clearRooms(); }
    const ids = new Map();
    for (const p of data.plants) {
      ids.set(p.id, replace ? p.id : newId());
      await savePlant({
        ...p,
        id: ids.get(p.id),
        photo: p.photo ? base64ToBlob(p.photo) : null,
        diagnoses: (p.diagnoses || []).map((d) => ({ ...d, photo: d.photo ? base64ToBlob(d.photo) : null })),
        events: (p.events || []).map((e) => ({ ...e, photo: e.photo ? base64ToBlob(e.photo) : null })),
      });
    }
    for (const r of Array.isArray(data.rooms) ? data.rooms : []) {
      await saveRoom({
        ...r,
        id: replace ? r.id : newId(),
        plants: (r.plants || []).filter((pl) => ids.has(pl.plantId)).map((pl) => ({ ...pl, plantId: ids.get(pl.plantId) })),
      });
    }
    toast(`${data.plants.length} plante(s) importée(s)`);
  } catch (err) {
    toast(`Import impossible : ${err.message}`);
  }
}

// --- Version et mises à jour ----------------------------------------------

async function swVersion() {
  const ctrl = navigator.serviceWorker?.controller;
  if (!ctrl) return null;
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 1500);
    ch.port1.onmessage = (e) => { clearTimeout(timer); resolve(e.data); };
    ctrl.postMessage('get-version', [ch.port2]);
  });
}

async function onlineVersion() {
  try {
    const res = await fetch(`js/version.js?t=${Date.now()}`, { cache: 'no-store' });
    const m = (await res.text()).match(/APP_VERSION\s*=\s*'([^']+)'/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function showVersions() {
  const [sw, online] = await Promise.all([swVersion(), onlineVersion()]);
  const swEl = view.querySelector('#sw-version');
  const onEl = view.querySelector('#online-version');
  if (swEl) swEl.textContent = sw || 'non installé';
  if (onEl) {
    onEl.innerHTML = online
      ? `${esc(online)}${online !== APP_VERSION ? ' · <span class="late">mise à jour disponible</span>' : ' · à jour ✅'}`
      : 'indisponible (hors connexion ?)';
  }
  return online;
}

async function checkForUpdate() {
  toast('Recherche…');
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg) await reg.update().catch(() => {});
  const online = await showVersions();
  if (online && online !== APP_VERSION) {
    toast(`Version ${online} trouvée, rechargement…`);
    setTimeout(() => location.reload(), 800);
  } else if (online) {
    toast('Vous avez la dernière version');
  }
}

async function forceUpdate() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) || [];
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch { /* ignoré */ }
  location.replace(`${location.pathname}?v=${Date.now()}${location.hash}`);
}

// --- Démarrage -------------------------------------------------------------

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  // Quand une nouvelle version prend la main, on recharge une fois pour l'afficher.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        // Vérifie les mises à jour à chaque retour dans l'app.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch((err) => console.warn('SW', err));
  });
}

render();
