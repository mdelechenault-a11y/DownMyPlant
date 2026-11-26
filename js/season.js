// Mode saison : le rythme d'arrosage et les conseils s'adaptent au mois de l'année.
// En hiver la plupart des plantes d'intérieur sont au repos (moins de lumière,
// croissance ralentie) : on espace les arrosages et on arrête l'engrais.
// En été, elles boivent davantage.

import { getSettings } from './settings.js';
import { plantNeed } from './light.js';

// Facteur appliqué à l'intervalle entre deux arrosages, mois par mois
// (hémisphère nord, janvier = 0). 1 = rythme de printemps.
const MONTH_FACTOR = [1.6, 1.5, 1.2, 1.0, 0.9, 0.8, 0.75, 0.8, 0.95, 1.15, 1.4, 1.6];

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export const SEASONS = {
  hiver: { label: 'Hiver', icon: 'snow', color: 'var(--water)' },
  printemps: { label: 'Printemps', icon: 'sprout', color: 'var(--ok)' },
  ete: { label: 'Été', icon: 'sun', color: 'var(--warn)' },
  automne: { label: 'Automne', icon: 'leaf', color: 'var(--primary)' },
};

export function seasonEnabled() {
  return getSettings().seasonMode !== false;
}

// Mois « vu par les plantes » : décalé de 6 mois dans l'hémisphère sud.
function plantMonth(date = new Date()) {
  const m = date.getMonth();
  return getSettings().hemisphere === 'south' ? (m + 6) % 12 : m;
}

export function seasonOf(date = new Date()) {
  const m = plantMonth(date);
  if (m === 11 || m <= 1) return 'hiver';
  if (m <= 4) return 'printemps';
  if (m <= 7) return 'ete';
  return 'automne';
}

// Plantes grasses et cactus : repos d'hiver beaucoup plus marqué.
export function isSucculent(plant) {
  const fam = (plant?.family || '').toLowerCase();
  if (fam === 'cactaceae' || fam === 'crassulaceae') return true;
  const genus = (plant?.scientificName || '').toLowerCase().split(/\s+/)[0];
  return ['aloe', 'echeveria', 'crassula', 'sedum', 'kalanchoe', 'haworthia', 'haworthiopsis', 'gasteria', 'lithops',
    'opuntia', 'mammillaria', 'echinocactus', 'echinopsis', 'cereus', 'agave', 'sempervivum', 'graptopetalum',
    'pachyphytum', 'portulacaria', 'adenium', 'pachypodium', 'senecio', 'curio', 'euphorbia'].includes(genus)
    && !/pulcherrima/.test(plant?.scientificName || '');
}

// Facteur d'espacement des arrosages pour une plante à une date donnée.
export function waterFactor(plant, date = new Date()) {
  if (!seasonEnabled()) return 1;
  const f = MONTH_FACTOR[plantMonth(date)];
  return isSucculent(plant) ? f ** 2 : f;
}

// Rythme par défaut quand on n'a pas encore d'historique (en jours, au printemps).
export function baseInterval(plant) {
  if (isSucculent(plant)) return 12;
  const need = plantNeed(plant).key;
  if (need === 'mi-ombre') return 5; // fougères, calathéas… aiment un substrat frais
  if (need === 'ombre') return 10; // zamioculcas, aspidistra : supportent la sécheresse
  return 7;
}

// Pas d'engrais pendant le repos d'hiver (et en fin d'automne).
export function fertilizeOk(date = new Date()) {
  if (!seasonEnabled()) return true;
  const m = plantMonth(date);
  return m >= 2 && m <= 8;
}

export function monthName(date = new Date()) {
  return MONTHS[date.getMonth()];
}

// Petit résumé de la saison pour une plante : titre + conseils.
export function seasonAdvice(plant, date = new Date()) {
  const s = seasonOf(date);
  const m = plantMonth(date);
  const succ = isSucculent(plant);
  const f = waterFactor(plant, date);
  const tips = [];
  let title;
  let text;
  if (s === 'hiver') {
    title = 'Repos d\'hiver';
    text = succ
      ? 'Elle dort : arrosez très peu, seulement quand le substrat est sec en profondeur.'
      : 'Elle pousse au ralenti : arrosez moins souvent, quand le dessus de la terre est sec.';
    tips.push('Pas d\'engrais avant le printemps.');
    tips.push('Éloignez-la des radiateurs et des courants d\'air froid.');
    tips.push('Rapprochez-la de la fenêtre : les jours sont courts.');
    if (!succ) tips.push('L\'air est sec avec le chauffage : un plateau de billes d\'argile humides l\'aide.');
  } else if (s === 'printemps') {
    title = 'Reprise de croissance';
    text = 'Elle se réveille : arrosez plus régulièrement, à mesure que les jours rallongent.';
    tips.push('C\'est le meilleur moment pour rempoter si les racines sortent du pot.');
    tips.push('Reprenez l\'engrais, environ toutes les 2 à 4 semaines.');
    tips.push('Tournez le pot de temps en temps pour une pousse bien droite.');
  } else if (s === 'ete') {
    title = 'Pleine saison';
    text = succ
      ? 'Elle profite de la chaleur : arrosez dès que la terre est sèche.'
      : 'Elle boit davantage : vérifiez la terre plus souvent, surtout par temps chaud.';
    tips.push('Engrais toutes les 2 à 3 semaines.');
    tips.push('Attention au soleil de l\'après-midi derrière une vitre : il peut brûler les feuilles.');
    tips.push('Avant de partir en vacances, regroupez les plantes loin du soleil direct.');
  } else {
    title = m >= 10 ? 'Vers le repos d\'hiver' : 'Fin de saison';
    text = m >= 10
      ? 'La croissance ralentit : espacez les arrosages petit à petit.'
      : 'Les jours raccourcissent : la plante boit un peu moins qu\'en été.';
    tips.push(m >= 9 ? 'Arrêtez l\'engrais jusqu\'au printemps.' : 'Dernier apport d\'engrais du mois, puis on arrête.');
    tips.push('Rentrez les plantes qui ont passé l\'été dehors avant les premières nuits sous 10 °C.');
    tips.push('Dépoussiérez les feuilles pour capter le peu de lumière.');
  }
  const pct = Math.round((f - 1) * 100);
  const rhythm = !seasonEnabled() ? null
    : f >= 1.5 ? `Arrosages ${f.toFixed(1).replace('.', ',')} fois plus espacés qu'au printemps.`
      : pct >= 10 ? `Arrosages espacés d'environ ${pct} % par rapport au printemps.`
        : pct <= -10 ? `Arrosages environ ${Math.abs(pct)} % plus rapprochés qu'au printemps.`
          : 'Rythme d\'arrosage normal.';
  return { season: s, ...SEASONS[s], title, text, tips, factor: f, rhythm, month: monthName(date) };
}

// Pour le diagnostic : une ligne de contexte.
export function seasonContext(date = new Date()) {
  const s = seasonOf(date);
  const hemi = getSettings().hemisphere === 'south' ? 'hémisphère sud' : 'hémisphère nord';
  return `Saison : ${SEASONS[s].label.toLowerCase()} (${monthName(date)}, ${hemi}). Tiens compte du repos végétatif ou de la pleine croissance dans tes conseils d'arrosage et d'engrais.`;
}
