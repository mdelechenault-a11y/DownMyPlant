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

export async function identifyPlant(photoBlob, organ, apiKey) {
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
    throw new Error(
      "Impossible de joindre Pl@ntNet. Vérifiez la connexion, et que l'adresse de l'app " +
      `(${location.origin}) figure dans les « domaines autorisés » de votre compte Pl@ntNet.`,
    );
  }

  if (res.status === 404) return []; // aucune espèce trouvée
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) {
      throw new Error('Clé Pl@ntNet refusée. Vérifiez-la dans les Réglages et les domaines autorisés de votre compte.');
    }
    if (res.status === 429) {
      throw new Error('Quota Pl@ntNet du jour atteint. Réessayez demain.');
    }
    throw new Error(`Erreur Pl@ntNet (${res.status}) ${detail.message || ''}`.trim());
  }

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
