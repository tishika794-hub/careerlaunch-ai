// src/lib/skillMatcher.js

/**
 * Skill matcher with canonicalization + fuzzy matching heuristics.
 * - Uses a canonical map to unify aliases.
 * - Performs fuzzy checks using substring/token overlap heuristics.
 * - Works entirely locally (no external API required).
 */

const CANONICAL_MAP = {
  'js': 'JavaScript',
  'javascript': 'JavaScript',
  'reactjs': 'React',
  'react': 'React',
  'node': 'Node.js',
  'nodejs': 'Node.js',
  'expressjs': 'Express',
  'express': 'Express',
  'tensorflow': 'TensorFlow',
  'c++': 'CPP',
  'cpp': 'CPP',
  'mongo': 'MongoDB',
  'mongodb': 'MongoDB',
  'postgres': 'PostgreSQL',
  'postgresql': 'PostgreSQL',
  'aws': 'AWS',
  'gcp': 'GCP',
  'html': 'HTML',
  'css': 'CSS',
  'typescript': 'TypeScript',
  'py': 'Python',
  'python': 'Python',
  'pytorch': 'PyTorch'
};

function normalizeToken(s = '') {
  return String(s || '').replace(/[^a-z0-9+#+.]/gi, ' ').toLowerCase().trim();
}

function canonicalize(token) {
  const key = normalizeToken(token).replace(/\s+/g, '');
  return CANONICAL_MAP[key] || token;
}

function tokenOverlapScore(a = '', b = '') {
  if (!a || !b) return 0;
  const sa = normalizeToken(a).split(/\s+/).filter(Boolean);
  const sb = normalizeToken(b).split(/\s+/).filter(Boolean);
  if (sa.length === 0 || sb.length === 0) return 0;
  const common = sa.filter(x => sb.includes(x));
  return common.length / Math.max(sa.length, sb.length);
}

export function matchSkillsFromParsed(parsed, roleKeywords = []) {
  // parsed.skills is an array of raw candidates
  const found = [];
  const evidence = [];
  const resumeText = (parsed.raw || '').toLowerCase();

  const normalizedCandidates = (parsed.skills || []).map(s => ({ raw: s, norm: normalizeToken(s) }));

  // Build a set of unique canonical skills found in resume
  const canonicalFound = new Map(); // canonical -> { originals:[], score, evidence }

  normalizedCandidates.forEach(c => {
    const canon = canonicalize(c.raw);
    const prev = canonicalFound.get(canon) || { originals: [], score: 0, evidence: [] };
    prev.originals.push(c.raw);
    // compute a presence score: exact token in resume -> 1, includes -> 0.8
    const exactRegex = new RegExp(`\\b${c.norm.replace(/[-\\/\\^$*+?.()|[\]{}]/g,'\\$&')}\\b`, 'i');
    let score = 0.7;
    if (exactRegex.test(parsed.raw)) score = 0.95;
    else if (resumeText.includes(c.norm)) score = 0.8;
    prev.score = Math.max(prev.score, score);
    prev.evidence.push({ snippet: findSnippet(parsed.raw, c.raw), foundAs: c.raw, score });
    canonicalFound.set(canon, prev);
  });

  // Also scan raw text for roleKeywords and include them if present
  (roleKeywords || []).forEach(kw => {
    const normKw = normalizeToken(kw);
    const exactRegex = new RegExp(`\\b${normKw.replace(/[-\\/\\^$*+?.()|[\]{}]/g,'\\$&')}\\b`, 'i');
    if (exactRegex.test(parsed.raw)) {
      const canon = canonicalize(kw);
      const prev = canonicalFound.get(canon) || { originals: [], score: 0, evidence: [] };
      prev.originals.push(kw);
      prev.score = Math.max(prev.score, 0.9);
      prev.evidence.push({ snippet: findSnippet(parsed.raw, kw), foundAs: kw, score: 0.9 });
      canonicalFound.set(canon, prev);
    }
  });

  // Build matched list
  for (const [canon, meta] of canonicalFound.entries()) {
    found.push({ name: canon, originals: Array.from(new Set(meta.originals)), score: Math.round(meta.score * 100), evidence: meta.evidence });
  }

  // Determine missing skills from roleKeywords: those not in canonicalFound (semantic matching via overlap)
  const missing = [];
  const matchedKeywords = [];
  (roleKeywords || []).forEach(kw => {
    const canonKw = canonicalize(kw);
    // if exact in found, mark matched
    if (found.some(f => f.name.toLowerCase() === canonKw.toLowerCase())) {
      matchedKeywords.push(kw);
      return;
    }
    // otherwise try fuzzy overlap with resume text
    const overlap = tokenOverlapScore(kw, parsed.raw) || tokenOverlapScore(kw, parsed.skills.join(' '));
    if (overlap >= 0.45) {
      matchedKeywords.push(kw);
    } else {
      missing.push(kw);
    }
  });

  return {
    matchedSkills: found.sort((a, b) => b.score - a.score),
    matchedKeywords,
    missingKeywords: missing
  };
}

function findSnippet(fullText = '', term = '') {
  if (!fullText || !term) return '';
  const idx = fullText.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return '';
  const start = Math.max(0, idx - 60);
  const end = Math.min(fullText.length, idx + term.length + 60);
  return fullText.substring(start, end).replace(/\n{2,}/g, '\n');
}
