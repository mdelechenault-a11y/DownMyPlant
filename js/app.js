import { listPlants, getPlant, savePlant, deletePlant, clearPlants, newId, requestPersistence } from './db.js';
import { getSettings, saveSettings } from './settings.js';
import { compressImage, blobUrl, blobToBase64, base64ToBlob } from './image.js';
import { identifyPlant, ORGANS } from './plantnet.js';
import { diagnosePlant } from './diagnose.js';

const view = document.getElementById('view');
const titleEl = document.getElementById('page-title');
const backBtn = document.getElementById('back-btn');
const toastEl = document.getElementById('toast');

// --- Utilitaires -----------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const todayIso = () => new Date().toISOString().slice(0, 10);

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function daysSince(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00`);
  return Math.round((Date.now() - d.getTime()) / 86400000);
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
        : `<span class="big" aria-hidden="true">📷</span><span>${esc(label)}</span>`}
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
  try {
    switch (route) {
      case 'identify': setTab('identify'); return renderIdentify();
      case 'add': setTab('identify'); return renderAdd();
      case 'settings': setTab('settings'); return renderSettings();
      case 'plant': setTab('plants'); return renderPlant(decodeURIComponent(param || ''));
      default: setTab('plants'); return renderPlants();
    }
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="error">${esc(err.message || err)}</div>`;
  }
}

window.addEventListener('hashchange', render);
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => go(`#/${t.dataset.route}`));
});

// --- Mes plantes -----------------------------------------------------------

async function renderPlants() {
  setHeader('Mes plantes');
  const plants = await listPlants();
  if (!plants.length) {
    view.innerHTML = `
      <div class="empty">
        <div class="big" aria-hidden="true">🌱</div>
        <p>Votre parc est vide.</p>
        <p class="small">Photographiez une plante pour la reconnaître et l'ajouter.</p>
      </div>
      <button class="btn" id="start">📷 Identifier une plante</button>
      ${keysNotice()}`;
    view.querySelector('#start').onclick = () => go('#/identify');
    return;
  }
  view.innerHTML = `
    <p class="muted">${plants.length} plante${plants.length > 1 ? 's' : ''}</p>
    <div class="plant-grid">
      ${plants.map((p) => {
        const last = p.diagnoses?.[0]?.result?.etat_general;
        return `
        <button class="plant-tile" data-id="${esc(p.id)}">
          ${p.photo ? `<img src="${blobUrl(p.photo)}" alt="">` : '<div class="ph">🪴</div>'}
          <div class="meta">
            <div class="name">${esc(p.nickname || p.commonName || p.scientificName || 'Sans nom')}</div>
            <div class="sp">${esc(p.scientificName || '')}</div>
            ${last ? `<div style="margin-top:4px">${etatBadge(last)}</div>` : ''}
          </div>
        </button>`;
      }).join('')}
    </div>
    <div style="margin-top:16px"><button class="btn" id="add">＋ Ajouter une plante</button></div>`;
  view.querySelectorAll('.plant-tile').forEach((el) => {
    el.onclick = () => go(`#/plant/${encodeURIComponent(el.dataset.id)}`);
  });
  view.querySelector('#add').onclick = () => go('#/identify');
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
      <button class="btn" id="run" ${!s.photo || s.loading ? 'disabled' : ''}>🔍 Reconnaître la plante</button>
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
  if (s.loading) return '<div class="loading"><span class="spinner"></span>Analyse en cours…</div>';
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
        <button class="btn ${i === 0 ? '' : 'secondary'}" data-pick="${i}" style="margin-top:10px">＋ Ajouter à mon parc</button>
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
      lastWatered: '',
      diagnoses: [],
    };
    await savePlant(plant);
    requestPersistence();
    addDraft = null;
    Object.assign(identifyState, { photo: null, results: null, error: '' });
    toast('Plante ajoutée à votre parc 🌿');
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
  return `<span class="badge ${cls}">${label}</span>`;
}

function diagHtml(entry) {
  const r = entry.result || {};
  return `
    <div class="diag-entry">
      <div class="row">
        <span class="muted small">${esc(fmtDate(entry.date))}</span>
        ${etatBadge(r.etat_general)}
      </div>
      ${entry.photo ? `<img class="hero" style="margin:8px 0;aspect-ratio:16/9" src="${blobUrl(entry.photo)}" alt="Photo du diagnostic">` : ''}
      <p style="margin-top:6px">${esc(r.resume)}</p>
      ${r.problemes?.length ? `
        <h3>Problèmes repérés</h3>
        <ul class="clean">${r.problemes.map((p) => `
          <li><strong>${esc(p.nom)}</strong> <span class="muted small">(gravité ${esc(p.gravite)})</span><br>
          <span class="small">${esc(p.signes)}. Cause probable : ${esc(p.cause_probable)}</span></li>`).join('')}
        </ul>` : ''}
      ${r.conseils?.length ? `<h3>Que faire</h3><ul class="clean">${r.conseils.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      <dl class="kv" style="margin-top:8px">
        ${r.arrosage ? `<dt>💧 Arrosage</dt><dd>${esc(r.arrosage)}</dd>` : ''}
        ${r.lumiere ? `<dt>☀️ Lumière</dt><dd>${esc(r.lumiere)}</dd>` : ''}
        ${r.a_surveiller ? `<dt>👀 À surveiller</dt><dd>${esc(r.a_surveiller)}</dd>` : ''}
      </dl>
    </div>`;
}

async function renderPlant(id) {
  const p = await getPlant(id);
  if (!p) { go('#/plants'); return; }
  const name = p.nickname || p.commonName || p.scientificName || 'Ma plante';
  setHeader(name, '#/plants');
  const ds = diagState[id] || (diagState[id] = { photo: null, note: '', loading: false, error: '' });
  const since = daysSince(p.lastWatered);

  view.innerHTML = `
    ${p.photo ? `<img class="hero" src="${blobUrl(p.photo)}" alt="${esc(name)}">` : ''}
    <div class="card" style="margin-top:12px">
      <h2>${esc(name)}</h2>
      ${p.scientificName ? `<p class="sci">${esc(p.scientificName)}${p.family ? ` <span class="muted small">· ${esc(p.family)}</span>` : ''}</p>` : ''}
      <dl class="kv">
        <dt>Ajoutée le</dt><dd>${esc(fmtDate(p.createdAt))}</dd>
        ${p.location ? `<dt>Emplacement</dt><dd>${esc(p.location)}</dd>` : ''}
        <dt>Arrosage</dt><dd>${p.lastWatered
          ? `${esc(fmtDate(p.lastWatered))} (${since === 0 ? "aujourd'hui" : `il y a ${since} j`})`
          : 'non noté'}</dd>
      </dl>
      <div class="btn-row">
        <button class="btn secondary" id="water">💧 Arrosée aujourd'hui</button>
      </div>
    </div>

    <div class="card">
      <h2>Diagnostic</h2>
      <p class="muted small">Photographiez la plante (ou la partie abîmée) pour obtenir un avis sur son état et des conseils. Coût : une fraction de centime.</p>
      ${photoPicker('diag-photo', ds.photo || null, 'Nouvelle photo pour le diagnostic')}
      <label for="diag-note">Ce que vous avez remarqué (facultatif)</label>
      <textarea id="diag-note" placeholder="Ex. : feuilles qui jaunissent depuis une semaine">${esc(ds.note)}</textarea>
      ${ds.error ? `<div class="error" style="margin-top:10px">${esc(ds.error)}</div>` : ''}
      ${ds.loading
        ? '<div class="loading"><span class="spinner"></span>Diagnostic en cours…</div>'
        : `<div class="btn-row"><button class="btn" id="diag-run" ${!(ds.photo || p.photo) ? 'disabled' : ''}>🩺 ${ds.photo ? 'Diagnostiquer' : 'Diagnostiquer avec la photo principale'}</button></div>`}
    </div>

    ${p.diagnoses?.length ? `<div class="card"><h2>Historique</h2>${p.diagnoses.map(diagHtml).join('')}</div>` : ''}

    <div class="card">
      <h2>Notes</h2>
      <label for="loc">Emplacement</label>
      <input type="text" id="loc" value="${esc(p.location)}">
      <label for="nick">Surnom</label>
      <input type="text" id="nick" value="${esc(p.nickname)}">
      <label for="pnotes">Notes</label>
      <textarea id="pnotes">${esc(p.notes)}</textarea>
      <div class="btn-row"><button class="btn secondary" id="save-notes">Enregistrer</button></div>
      <div class="btn-row">
        <label class="btn secondary" for="main-photo" style="margin:0">📷 Changer la photo</label>
        <input class="visually-hidden" type="file" id="main-photo" accept="image/*">
      </div>
    </div>

    <button class="btn danger" id="delete">Supprimer cette plante</button>`;

  view.querySelector('#water').onclick = async () => {
    p.lastWatered = todayIso();
    await savePlant(p);
    toast('Arrosage noté 💧');
    renderPlant(id);
  };
  view.querySelector('#diag-photo').onchange = async (e) => {
    ds.note = view.querySelector('#diag-note').value;
    const blob = await readPhotoInput(e.target).catch(() => null);
    if (blob) { ds.photo = blob; ds.error = ''; }
    renderPlant(id);
  };
  view.querySelector('#diag-note').oninput = (e) => { ds.note = e.target.value; };
  const runBtn = view.querySelector('#diag-run');
  if (runBtn) runBtn.onclick = () => runDiagnosis(p, ds);

  view.querySelector('#save-notes').onclick = async () => {
    p.location = view.querySelector('#loc').value.trim();
    p.nickname = view.querySelector('#nick').value.trim();
    p.notes = view.querySelector('#pnotes').value.trim();
    await savePlant(p);
    toast('Enregistré');
    renderPlant(id);
  };
  view.querySelector('#main-photo').onchange = async (e) => {
    const blob = await readPhotoInput(e.target).catch(() => null);
    if (blob) { p.photo = blob; await savePlant(p); renderPlant(id); }
  };
  view.querySelector('#delete').onclick = async () => {
    if (!confirm(`Supprimer « ${name} » de votre parc ?`)) return;
    await deletePlant(id);
    delete diagState[id];
    toast('Plante supprimée');
    go('#/plants');
  };
}

async function runDiagnosis(plant, ds) {
  ds.loading = true; ds.error = '';
  const onPage = () => location.hash === `#/plant/${encodeURIComponent(plant.id)}`;
  renderPlant(plant.id);
  try {
    const photo = ds.photo || plant.photo;
    const { result } = await diagnosePlant({
      photoBlob: photo,
      plant,
      userNote: ds.note.trim(),
      apiKey: getSettings().anthropicKey,
    });
    const fresh = (await getPlant(plant.id)) || plant;
    fresh.diagnoses = [
      { date: new Date().toISOString(), photo: ds.photo || null, note: ds.note.trim(), result },
      ...(fresh.diagnoses || []),
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

function renderSettings() {
  setHeader('Réglages');
  const s = getSettings();
  view.innerHTML = `
    <div class="card">
      <h2>Reconnaissance (Pl@ntNet)</h2>
      <p class="muted small">Gratuit, 500 identifications par jour. Créez un compte sur
        <a href="https://my.plantnet.org/" target="_blank" rel="noopener">my.plantnet.org</a>,
        copiez votre clé, et ajoutez <strong>${esc(location.hostname || 'votre domaine')}</strong>
        dans les « domaines autorisés ».</p>
      <label for="pn">Clé API Pl@ntNet</label>
      <input type="password" id="pn" value="${esc(s.plantnetKey)}" autocomplete="off" autocapitalize="off" spellcheck="false">
    </div>
    <div class="card">
      <h2>Diagnostic (Claude)</h2>
      <p class="muted small">Utilisé seulement quand vous lancez un diagnostic. Créez une clé sur
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>
        et ajoutez quelques euros de crédit : un diagnostic coûte moins d'un centime.</p>
      <label for="an">Clé API Anthropic</label>
      <input type="password" id="an" value="${esc(s.anthropicKey)}" autocomplete="off" autocapitalize="off" spellcheck="false">
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
    </div>`;

  view.querySelector('#save').onclick = () => {
    saveSettings({
      plantnetKey: view.querySelector('#pn').value.trim(),
      anthropicKey: view.querySelector('#an').value.trim(),
    });
    toast('Clés enregistrées');
  };
  view.querySelector('#export').onclick = exportBackup;
  view.querySelector('#import').onchange = (e) => importBackup(e.target);
  showStorage();
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
    });
  }
  const blob = new Blob([JSON.stringify({ app: 'DownMyPlant', version: 1, exportedAt: new Date().toISOString(), plants: out })], { type: 'application/json' });
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
    if (replace) await clearPlants();
    for (const p of data.plants) {
      await savePlant({
        ...p,
        id: replace ? p.id : newId(),
        photo: p.photo ? base64ToBlob(p.photo) : null,
        diagnoses: (p.diagnoses || []).map((d) => ({ ...d, photo: d.photo ? base64ToBlob(d.photo) : null })),
      });
    }
    toast(`${data.plants.length} plante(s) importée(s)`);
  } catch (err) {
    toast(`Import impossible : ${err.message}`);
  }
}

// --- Démarrage -------------------------------------------------------------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW', err));
  });
}

render();
