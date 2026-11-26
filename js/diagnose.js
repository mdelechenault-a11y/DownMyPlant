// Diagnostic visuel à la demande via Claude (petit modèle vision, peu coûteux).
// Le SDK officiel est embarqué dans vendor/ (aucune étape de build nécessaire).

import { Anthropic } from '../vendor/anthropic-sdk.js';
import { blobToBase64 } from './image.js';

export const DIAG_MODEL = 'claude-haiku-5-5';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['etat_general', 'resume', 'problemes', 'conseils', 'arrosage', 'lumiere', 'besoin_lumiere', 'a_surveiller', 'evolution', 'evolution_detail'],
  properties: {
    etat_general: { type: 'string', enum: ['bon', 'moyen', 'mauvais', 'indetermine'] },
    resume: { type: 'string', description: 'Une ou deux phrases sur l’état visible de la plante.' },
    problemes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nom', 'signes', 'cause_probable', 'gravite'],
        properties: {
          nom: { type: 'string' },
          signes: { type: 'string', description: 'Ce qui est visible sur la photo.' },
          cause_probable: { type: 'string' },
          gravite: { type: 'string', enum: ['faible', 'moyenne', 'forte'] },
        },
      },
    },
    conseils: { type: 'array', items: { type: 'string' }, description: 'Actions concrètes, par ordre de priorité.' },
    arrosage: { type: 'string', description: 'Recommandation d’arrosage adaptée.' },
    lumiere: { type: 'string', description: 'Recommandation d’exposition.' },
    besoin_lumiere: {
      type: 'string',
      enum: ['plus', 'moins', 'ok', 'indetermine'],
      description: 'La plante a-t-elle besoin de plus de lumière, de moins de lumière (ou de soleil direct), ou est-elle bien exposée ? Sert à lui suggérer une meilleure place dans la pièce.',
    },
    a_surveiller: { type: 'string', description: 'Ce qu’il faut observer dans les prochains jours.' },
    evolution: {
      type: 'string',
      enum: ['mieux', 'stable', 'moins_bien', 'premiere', 'indetermine'],
      description: 'Comparaison avec la photo précédente si elle est fournie : la plante va-t-elle mieux, pareil ou moins bien ? "premiere" s’il n’y a pas de photo précédente.',
    },
    evolution_detail: { type: 'string', description: 'Ce qui a changé entre les deux photos (une ou deux phrases), ou chaîne vide.' },
  },
};

const SYSTEM = `Tu es un jardinier expert qui aide un particulier à entretenir ses plantes.
On te montre une photo d'une plante de sa collection. Examine ce qui est réellement visible :
couleur et texture des feuilles, taches, jaunissement, brunissement des pointes, flétrissement,
étiolement, parasites (cochenilles, araignées rouges, pucerons, thrips, aleurodes), moisissures,
état du substrat et du pot si visibles.
Déduis les causes probables (manque ou excès d'eau, manque ou excès de lumière, carence,
parasites, maladie, rempotage nécessaire, froid...) et donne des conseils concrets et simples.
Si la photo ne permet pas de juger, dis-le et mets etat_general à "indetermine".
N'invente pas de symptômes absents de la photo. Réponds en français, phrases courtes.
Si on te montre aussi une photo précédente de la même plante, compare-les (nouvelles feuilles,
taches qui s'étendent ou non, couleur, port, volume) et dis si elle va mieux, pareil ou moins bien.
Tiens compte du cadrage et de la lumière qui peuvent différer entre les deux photos.`;

// Client navigateur. La clé part dans l'en-tête classique x-api-key ; le SDK
// ajoute lui-même anthropic-dangerous-direct-browser-access: true (requis pour
// qu'Anthropic accepte un appel direct depuis une page web).
function makeClient(apiKey) {
  return new Anthropic({
    apiKey: null,
    defaultHeaders: { 'x-api-key': apiKey },
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
  });
}

// previous : { blob, date, diagnosis } — photo plus ancienne pour juger l'évolution (facultatif).
export async function diagnosePlant({ photoBlob, plant, history, userNote, apiKey, previous }) {
  if (!apiKey) {
    throw new Error('Ajoutez votre clé Anthropic dans les Réglages pour utiliser le diagnostic.');
  }

  const client = makeClient(apiKey);
  const data = await blobToBase64(photoBlob);
  const prevBlocks = [];
  if (previous?.blob && previous.blob !== photoBlob) {
    const d = previous.diagnosis?.result?.resume ? ` Diagnostic de l'époque : ${previous.diagnosis.result.resume}` : '';
    prevBlocks.push(
      { type: 'text', text: `Photo précédente de la même plante, du ${previous.date}.${d}` },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await blobToBase64(previous.blob) } },
    );
  }

  const context = [
    plant?.scientificName && `Espèce identifiée : ${plant.scientificName}${plant.commonName ? ` (${plant.commonName})` : ''}.`,
    plant?.location && `Emplacement : ${plant.location}.`,
    history && `Journal d'entretien :\n${history}`,
    plant?.notes && `Notes du propriétaire : ${plant.notes}`,
    userNote && `Ce que le propriétaire a remarqué : ${userNote}`,
  ].filter(Boolean).join('\n');

  let response;
  try {
    response = await client.messages.create({
      model: DIAG_MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: SCHEMA },
      },
      messages: [{
        role: 'user',
        content: [
          ...prevBlocks,
          ...(prevBlocks.length ? [{ type: 'text', text: 'Photo actuelle :' }] : []),
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
          { type: 'text', text: `${context || 'Aucune information supplémentaire.'}\n\nQuel est l'état de cette plante et que faut-il faire ?${prevBlocks.length ? ' Va-t-elle mieux que sur la photo précédente ?' : ' (Pas de photo précédente : evolution = "premiere".)'}` },
        ],
      }],
    });
  } catch (err) {
    throw new Error(friendlyError(err));
  }

  if (response.stop_reason === 'refusal') {
    throw new Error("Le diagnostic n'a pas pu être fait pour cette photo. Essayez avec une autre photo.");
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Réponse incomplète. Réessayez.');
  }

  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error('Réponse illisible. Réessayez.');
  }
  return { result, usage: response.usage, model: response.model };
}

function friendlyError(err) {
  const status = err?.status;
  const apiMsg = err?.error?.error?.message || '';
  const detail = apiMsg ? ` Message d'Anthropic : « ${apiMsg} ».` : '';
  if (err instanceof Anthropic.AuthenticationError || status === 401) {
    return `Clé Anthropic non reconnue (erreur 401). Copiez-collez la clé complète (elle commence par sk-ant-) depuis console.anthropic.com → API Keys.${detail}`;
  }
  if (err instanceof Anthropic.PermissionDeniedError || status === 403) {
    return `Accès refusé par Anthropic (erreur 403). La clé n'a peut-être pas accès à ce modèle, ou l'organisation est restreinte.${detail}`;
  }
  if (err instanceof Anthropic.NotFoundError || status === 404) {
    return `Modèle introuvable (erreur 404) : ${DIAG_MODEL}.${detail}`;
  }
  if (err instanceof Anthropic.RateLimitError || status === 429) {
    return `Trop de demandes pour le moment (erreur 429). Réessayez dans une minute.${detail}`;
  }
  if (err instanceof Anthropic.BadRequestError || status === 400) {
    if (/credit|balance|billing/i.test(apiMsg)) {
      return `Crédit Anthropic insuffisant (erreur 400). Ajoutez du crédit dans console.anthropic.com → Billing. Comptez quelques minutes avant que le crédit soit actif.${detail}`;
    }
    return `Requête refusée (erreur 400).${detail}`;
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Impossible de joindre Anthropic. Vérifiez la connexion. Si elle est bonne, le navigateur a bloqué l'appel.";
  }
  if (err instanceof Anthropic.APIError) return `Erreur du service Anthropic (${status ?? '?'}).${detail}`;
  return err?.message || 'Erreur inconnue.';
}

// Vérifie la clé et l'accès au modèle sans rien facturer.
// (Le crédit, lui, n'est vérifié qu'au premier diagnostic.)
export async function testAnthropicKey(apiKey) {
  if (!apiKey) return { ok: false, message: 'Aucune clé saisie.' };
  if (!apiKey.startsWith('sk-ant-')) {
    return { ok: false, message: 'Cette clé ne commence pas par « sk-ant- ». Ce n\'est sans doute pas une clé API Anthropic (créez-la dans console.anthropic.com → API Keys).' };
  }
  try {
    await makeClient(apiKey).models.retrieve(DIAG_MODEL);
    return { ok: true, message: `Clé Anthropic valide, modèle ${DIAG_MODEL} accessible ✅ (le crédit sera vérifié au premier diagnostic).` };
  } catch (err) {
    return { ok: false, message: friendlyError(err) };
  }
}
