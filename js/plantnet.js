// Identification d'espèce via l'API Pl@ntNet (https://my.plantnet.org).
// Gratuit jusqu'à 500 identifications par jour.

const ENDPOINT = 'https://my-api.plantnet.org/v2/identify/all';

export const ORGANS = [
  { value: 'auto', label: 'Auto' },
  { value: 'leaf', label: 'Feuille' },
  { value: 'flower', label: 'Fleur' },
  { value: 'fruit', label: 'Fruit' },
  { value: 'bark', label: 'Écorce' },
];

// Nettoie une clé collée ou recopiée (espaces, retours à la ligne, guillemets).
export function cleanKey(key) {
  return String(key || '').replace(/[\s"'«»“”]/g, '');
}

const ORIGIN_HINT = () => location.hostname || 'votre domaine';

async function readError(res) {
  let msg = '';
  try {
    const body = await res.clone().json();
    msg = body.message || body.error || '';
  } catch {
    msg = (await res.text().catch(() => '')).slice(0, 200);
  }
  return msg;
}

function explain(status, serverMsg) {
  const detail = serverMsg ? ` Message de Pl@ntNet : « ${serverMsg} ».` : '';
  if (status === 401) {
    return `Clé Pl@ntNet non reconnue (erreur 401). Le plus simple est de la copier-coller plutôt que de la recopier (attention aux confusions l / I / 1 et O / 0).${detail}`;
  }
  if (status === 403) {
    return `Pl@ntNet refuse les appels venant de ${ORIGIN_HINT()} (erreur 403). Sur my.plantnet.org, activez « expose my API key », mettez ${ORIGIN_HINT()} dans « Authorized domains », puis cliquez sur « Update key settings ». La prise en compte peut prendre quelques minutes.${detail}`;
  }
  if (status === 429) return `Quota Pl@ntNet du jour atteint (erreur 429). Réessayez demain.${detail}`;
  if (status === 413) return `Photo trop lourde pour Pl@ntNet (erreur 413).${detail}`;
  if (status === 400) return `Pl@ntNet n'a pas accepté la photo (erreur 400).${detail}`;
  return `Erreur Pl@ntNet (${status}).${detail}`;
}

function networkError() {
  return new Error(
    `Impossible de joindre Pl@ntNet depuis ${ORIGIN_HINT()}. Vérifiez la connexion. ` +
    'Si la connexion est bonne, le navigateur a probablement bloqué l\'appel : vérifiez sur my.plantnet.org ' +
    '« expose my API key », le domaine autorisé, et cliquez sur « Update key settings ».',
  );
}

export async function identifyPlant(photoBlob, organ, rawKey) {
  const apiKey = cleanKey(rawKey);
  if (!apiKey) {
    throw new Error('Ajoutez votre clé Pl@ntNet dans les Réglages.');
  }
  const params = new URLSearchParams({
    'api-key': apiKey,
    lang: 'fr',
    'include-related-images': 'true',
    'nb-results': '5',
  });
  const form = new FormData();
  form.append('images', photoBlob, 'plante.jpg');
  form.append('organs', organ || 'auto');

  let res;
  try {
    res = await fetch(`${ENDPOINT}?${params}`, { method: 'POST', body: form });
  } catch {
    throw networkError();
  }

  if (res.status === 404) return []; // aucune espèce trouvée
  if (!res.ok) throw new Error(explain(res.status, await readError(res)));

  const data = await res.json();
  return (data.results || []).map((r) => ({
    score: r.score,
    scientificName: r.species?.scientificNameWithoutAuthor || r.species?.scientificName || '',
    author: r.species?.scientificNameAuthorship || '',
    commonNames: r.species?.commonNames || [],
    family: r.species?.family?.scientificNameWithoutAuthor || '',
    genus: r.species?.genus?.scientificNameWithoutAuthor || '',
    image: r.images?.[0]?.url?.s || r.images?.[0]?.url?.m || '',
    remaining: data.remainingIdentificationRequests,
  }));
}

// Vérifie la clé sans consommer d'identification (liste des référentiels).
export async function testPlantnetKey(rawKey) {
  const apiKey = cleanKey(rawKey);
  if (!apiKey) return { ok: false, message: 'Aucune clé saisie.' };
  let res;
  try {
    res = await fetch(`https://my-api.plantnet.org/v2/projects?${new URLSearchParams({ 'api-key': apiKey, lang: 'fr' })}`);
  } catch {
    return { ok: false, message: networkError().message };
  }
  if (res.ok) return { ok: true, message: 'Clé Pl@ntNet valide et acceptée depuis cette adresse ✅' };
  return { ok: false, message: explain(res.status, await readError(res)) };
}
