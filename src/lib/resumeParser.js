// src/lib/resumeParser.js

/**
 * Lightweight resume parser that extracts sections by headings and returns structured content.
 * It uses simple regex heuristics to keep implementation dependency-free.
 */

export function parseResumeText(rawText = '') {
  const text = (rawText || '').replace(/\r\n/g, '\n');

  // Normalize common headings to help section splitting
  const headingVariants = [
    'skills', 'technical skills', 'experience', 'work experience', 'projects', 'education', 'certifications', 'certificates', 'tools', 'summary', 'professional summary', 'profile', 'objective', 'achievements'
  ];

  // Build regex to split by headings
  const headingRegex = new RegExp(`(^|\\n)\\s*(?:${headingVariants.map(h => h.replace(/[-\/\\^$*+?.()|[\]{}]/g,'\\$&')).join('|')})\\s*:?.*\\n`, 'ig');

  // Find all headings and their indexes
  const sections = {};
  const lines = text.split('\n');

  // Heuristic: scan lines for headings and capture subsequent block until next heading
  const lower = lines.map(l => l.toLowerCase());
  const headingIndexes = [];
  lower.forEach((l, idx) => {
    const clean = l.trim();
    // treat lines that are short and contain a heading word
    for (const hv of headingVariants) {
      const hvShort = hv.toLowerCase();
      // match lines that start with heading or equal heading
      if (clean.startsWith(hvShort) || clean === hvShort || clean.startsWith(hvShort + ':')) {
        headingIndexes.push({ idx, key: hvShort });
        break;
      }
    }
  });

  // If no headings found, fallback: try to find Skills: or Experience:
  if (headingIndexes.length === 0) {
    const fallback = [];
    lower.forEach((l, idx) => {
      if (/^skills?:/.test(l) || /^experience:/.test(l) || /^education:/.test(l)) fallback.push({ idx, key: l.split(':')[0] });
    });
    headingIndexes.push(...fallback);
  }

  // Build section text
  if (headingIndexes.length > 0) {
    for (let i = 0; i < headingIndexes.length; i++) {
      const start = headingIndexes[i].idx;
      const key = headingIndexes[i].key.replace(/\s+/g, ' ').trim();
      const end = (i + 1 < headingIndexes.length) ? headingIndexes[i + 1].idx : lines.length;
      const block = lines.slice(start + 1, end).join('\n').trim();
      sections[key] = (sections[key] || '') + '\n' + block;
    }
  }

  // Generic extraction helpers
  const extractSkillsFromBlock = (blk) => {
    if (!blk) return [];
    // split on commas, bullets or newlines
    const candidates = blk.split(/[,\n•\-\u2022]/).map(s => s.trim()).filter(Boolean);
    // keep tokens that look like tech names (contain +, #, dots or letters >1)
    return Array.from(new Set(candidates.map(s => s.replace(/\s+/g,' ').trim()).filter(s => s.length > 1))).slice(0, 200);
  };

  const extractProjectsFromBlock = (blk) => {
    if (!blk) return [];
    // Split into paragraphs
    const paras = blk.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    return paras.slice(0, 20);
  };

  // Try to populate common sections
  const skillsText = sections['skills'] || sections['technical skills'] || '';
  const projectsText = sections['projects'] || '';
  const experienceText = sections['experience'] || sections['work experience'] || '';
  const educationText = sections['education'] || '';
  const certText = sections['certifications'] || sections['certificates'] || '';
  const toolsText = sections['tools'] || '';
  const summaryText = sections['summary'] || sections['professional summary'] || sections['profile'] || '';

  const parsed = {
    raw: text,
    summary: summaryText.trim(),
    skills: extractSkillsFromBlock(skillsText),
    projects: extractProjectsFromBlock(projectsText),
    experience: experienceText.trim(),
    education: educationText.trim(),
    certifications: extractSkillsFromBlock(certText),
    tools: extractSkillsFromBlock(toolsText),
    otherText: ''
  };

  // If no explicit skills section, try to infer skills by scanning for common tech tokens across resume
  if (parsed.skills.length === 0) {
    // Regex for common tech tokens (letters, numbers, plus, dots, #)
    const techMatches = Array.from(new Set((text.match(/\b[A-Za-z+#.]{2,40}\b/g) || []).map(s => s.trim())));
    // Filter by reasonable candidates (capitalized or known techs)
    parsed.skills = techMatches.filter(tok => /[A-Za-z]/.test(tok)).slice(0, 100);
  }

  return parsed;
}
