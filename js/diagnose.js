// Diagnostic visuel à la demande via Claude (petit modèle vision, peu coûteux).
// Le SDK officiel est embarqué dans vendor/ (aucune étape de build nécessaire).

import { Anthropic } from '../vendor/anthropic-sdk.js';
import { blobToBase64 } from './image.js';

export const DIAG_MODEL = 'claude-haiku-5-5';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['etat_general', 'resume', 'problemes', 'conseils', 'arrosage', 'lumiere', 'a_surveiller'],
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
    a_surveiller: { type: 'string', description: 'Ce qu’il faut observer dans les prochains jours.' },
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
N'invente pas de symptômes absents de la photo. Réponds en français, phrases courtes.`;

export async function diagnosePlant({ photoBlob, plant, history, userNote, apiKey }) {
  if (!apiKey) {
    throw new Error('Ajoutez votre clé Anthropic dans les Réglages pour utiliser le diagnostic.');
  }

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const data = await blobToBase64(photoBlob);

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
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
          { type: 'text', text: `${context || 'Aucune information supplémentaire.'}\n\nQuel est l'état de cette plante et que faut-il faire ?` },
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
  if (err instanceof Anthropic.AuthenticationError) return 'Clé Anthropic invalide. Vérifiez-la dans les Réglages.';
  if (err instanceof Anthropic.PermissionDeniedError) return "Votre clé Anthropic n'a pas accès à ce modèle.";
  if (err instanceof Anthropic.RateLimitError) return 'Trop de demandes pour le moment. Réessayez dans une minute.';
  if (err instanceof Anthropic.BadRequestError) {
    const msg = err.error?.error?.message || err.message || '';
    if (/credit|balance|billing/i.test(msg)) return "Crédit Anthropic insuffisant. Ajoutez du crédit sur console.anthropic.com.";
    return `Requête refusée : ${msg}`;
  }
  if (err instanceof Anthropic.APIConnectionError) return 'Pas de connexion au service de diagnostic.';
  if (err instanceof Anthropic.APIError) return `Erreur du service (${err.status ?? '?'}). Réessayez plus tard.`;
  return err?.message || 'Erreur inconnue.';
}
