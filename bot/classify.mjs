// Guess which project a free-text note is about, from keywords (REGLES-COMMUNES §I).
export const PROJECTS = {
  hoc: { label: 'HOC', repo: 'house-of-crochet', words: ['hoc', 'assimina', 'crochet', 'braids', 'tresse', 'tresses', 'salon', 'coiffure', 'calendly', 'netlify', 'supabase'] },
  leadgen: { label: 'LeadGen', repo: 'leadgen-renov', words: ['leadgen', 'ouz', 'pompe', 'pac', 'lead', 'leads', 'installateur', 'installateurs', 'rge', 'renov', 'devis', 'meta', 'n8n', 'cloudflare'] },
  zaff: { label: 'Zaff', repo: 'les-zaff', words: ['zaff', 'vendix', 'render', 'neon', 'payhip', 'yupoo', 'vinted', 'streetwear', 'guangzhou', 'vetement', 'vetements'] },
  lingfi: { label: 'Lingfi', repo: 'Boutique', words: ['lingfi', 'boutique', 'tenant', 'marchand', 'hetzner', 'storagebox'] },
  cockpit: { label: 'Cockpit', repo: 'cockpit', words: ['cockpit', 'impot', 'impots', 'urssaf', 'tva', 'maison', 'maisons', 'loyer', 'loyers', 'credit', 'credits', 'banque', 'astaffort', 'monnerie', 'bedarieux', 'serveur', 'hostinger', 'tailscale', 'salaire', 'abonnement', 'abonnements', 'patrimoine', 'bot'] },
};

export const normalize = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function classify(text) {
  const tokens = new Set(normalize(text).split(/[^a-z0-9]+/).filter(Boolean));
  const scores = {};
  for (const [key, p] of Object.entries(PROJECTS)) scores[key] = p.words.filter((w) => tokens.has(w)).length;
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  const project = best[1] > 0 && best[1] > (second ? second[1] : 0) ? best[0] : null;
  return { project, scores };
}
