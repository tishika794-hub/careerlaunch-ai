// src/lib/atsScorer.js

import { TARGET_ROLES } from '../data/mockData';

/**
 * Deterministic ATS scorer using weighted criteria.
 * Weights (as requested):
 * - Skills Match: 35%
 * - Experience Relevance: 20%
 * - Education: 10%
 * - Resume Structure: 10%
 * - Keyword Coverage: 15%
 * - Projects: 10%
 *
 * The scorer accepts the parsed resume (from resumeParser) and matched results (from skillMatcher)
 * and returns a structured analysis object containing subscores, evidence, and tips.
 */

function clamp(n, a = 0, b = 100) {
  return Math.max(a, Math.min(b, Math.round(n)));
}

export function generateATSReport(parsed, skillMatchResult = {}, targetRoleKey = 'frontend') {
  const role = TARGET_ROLES[targetRoleKey] || TARGET_ROLES['frontend'];
  const totalWords = (parsed.raw || '').split(/\s+/).filter(Boolean).length;

  // 1. Resume Structure (10%) - based on detected headings presence
  const sectionCheck = {
    contact: /(email|phone|github|linkedin|contact|location|address)/i.test(parsed.raw),
    summary: !!(parsed.summary && parsed.summary.trim().length > 10),
    experience: !!(parsed.experience && parsed.experience.trim().length > 20),
    education: !!(parsed.education && parsed.education.trim().length > 5),
    skills: Array.isArray(parsed.skills) && parsed.skills.length > 0
  };

  const detectedSectionsCount = Object.values(sectionCheck).filter(Boolean).length;
  const resumeStructureScore = clamp((detectedSectionsCount / 5) * 100);

  // 2. Skills Match (35%) - based on matched skills & keyword coverage
  const matchedSkills = (skillMatchResult.matchedSkills || []).map(s => s.name);
  // compute skill coverage vs role benchmark keywords intersection
  const roleKeywords = role.keywords || [];
  const matchedKeywordsSet = new Set((skillMatchResult.matchedKeywords || []).map(k => k.toLowerCase()));
  const matchedKeywords = Array.from(matchedKeywordsSet);
  const missingKeywords = (skillMatchResult.missingKeywords || []).map(k => k);

  // Skills subscore: proportion of roleKeywords matched weighted by presence of canonical matchedSkills
  const skillCoverageRatio = roleKeywords.length ? (matchedKeywords.length / roleKeywords.length) : 0;
  const skillsScore = clamp(skillCoverageRatio * 100);

  // 3. Experience Relevance (20%) - presence of experience section + mentions of role keywords in experience
  let experienceRelevanceScore = 0;
  if (sectionCheck.experience) {
    // count occurrences of role keywords inside experience text
    const expText = (parsed.experience || '').toLowerCase();
    let matches = 0;
    roleKeywords.forEach(kw => {
      try {
        const re = new RegExp(`\\b${kw.replace(/[-\\/\\^$*+?.()|[\]{}]/g,'\\$&')}\\b`, 'i');
        if (re.test(expText)) matches++;
      } catch (e) {
        // ignore
      }
    });
    const ratio = roleKeywords.length ? (matches / Math.min(roleKeywords.length, 10)) : 0;
    experienceRelevanceScore = clamp(60 + ratio * 40); // baseline 60 if experience exists
  } else {
    experienceRelevanceScore = 30; // low if no experience section
  }

  // 4. Education (10%) - check presence and match common education terms
  let educationScore = 0;
  if (sectionCheck.education) {
    const edu = (parsed.education || '').toLowerCase();
    if (/bachelor|bsc|bs|b\.sc|bachelor of|master|msc|ba|degree/i.test(edu)) educationScore = 95;
    else educationScore = 70;
  } else {
    educationScore = 40;
  }
  educationScore = clamp(educationScore);

  // 5. Keyword Coverage (15%) - checks duplicates across skills, projects, experience
  let keywordCoverageScore = 0;
  if (roleKeywords.length > 0) {
    // merge text sources
    const merged = ((parsed.skills || []).join(' ') + ' ' + (parsed.projects || []).join(' ') + ' ' + (parsed.experience || '')).toLowerCase();
    let count = 0;
    roleKeywords.forEach(kw => {
      try {
        const re = new RegExp(`\\b${kw.replace(/[-\\/\\^$*+?.()|[\]{}]/g,'\\$&')}\\b`, 'i');
        if (re.test(merged)) count++;
      } catch (e) {}
    });
    keywordCoverageScore = clamp((count / roleKeywords.length) * 100);
  }

  // 6. Projects (10%) - presence and relevance (do project descriptions include role keywords?)
  let projectsScore = 0;
  const projects = parsed.projects || [];
  if (projects.length === 0) projectsScore = 20;
  else {
    let relevantCount = 0;
    projects.forEach(p => {
      const pText = p.toLowerCase();
      for (const kw of roleKeywords.slice(0, 12)) {
        try {
          const re = new RegExp(`\\b${kw.replace(/[-\\/\\^$*+?.()|[\]{}]/g,'\\$&')}\\b`, 'i');
          if (re.test(pText)) { relevantCount++; break; }
        } catch (e) {}
      }
    });
    const relevanceRatio = Math.min(1, relevantCount / projects.length);
    projectsScore = clamp(40 + relevanceRatio * 60); // baseline 40 if projects exist
  }

  // Action verbs (reuse simple heuristics similar to previous engine)
  const ACTION_VERBS = [
    'built', 'developed', 'created', 'designed', 'architected', 'led', 'spearheaded', 
    'managed', 'engineered', 'implemented', 'optimized', 'reduced', 'increased', 
    'achieved', 'conducted', 'collaborated', 'integrated', 'delivered', 'formulated',
    'automated', 'championed', 'deployed', 'orchestrated', 'streamlined', 'pioneered'
  ];
  const matchedActionVerbs = ACTION_VERBS.filter(v => new RegExp(`\\b${v}\\b`, 'i').test(parsed.raw));

  // Combine weighted overall score
  const overallScore = clamp(
    skillsScore * 0.35 +
    experienceRelevanceScore * 0.20 +
    educationScore * 0.10 +
    resumeStructureScore * 0.10 +
    keywordCoverageScore * 0.15 +
    projectsScore * 0.10
  );

  // Build tips & explanations
  const tips = [];
  if (sectionCheck.summary === false) tips.push('Add a short Professional Summary summarizing your role focus and top skills.');
  if (sectionCheck.contact === false) tips.push('Include contact info (email, phone, LinkedIn/GitHub) at the top.');
  if (matchedSkills.length === 0 && (parsed.skills || []).length === 0) tips.push('List your top technical skills in a dedicated Skills section.');
  if (missingKeywords.length > 0) {
    const topMissing = missingKeywords.slice(0, 6).join(', ');
    tips.push(`The following role-relevant skills were not detected in Skills/Experience/Projects: ${topMissing}. Add them where relevant with evidence.`);
  }
  if (matchedActionVerbs.length < 4) tips.push('Use more action verbs in your experience bullets (e.g., Architected, Implemented, Optimized).');

  // Return a structure matching previous UI expectations
  return {
    overallScore,
    keywordMatchScore: Math.round(keywordCoverageScore),
    formattingScore: Math.round(resumeStructureScore),
    actionVerbScore: Math.round(matchedActionVerbs.length >= 8 ? 100 : (matchedActionVerbs.length / 8) * 100),
    wordCountScore: clamp(totalWords > 1000 ? 80 : (totalWords < 150 ? 40 : totalWords < 250 ? 70 : 100)),
    totalWords,
    sectionCheck,
    matchedKeywords,
    missingKeywords,
    matchedActionVerbs,
    tips,
    matchedSkills: skillMatchResult.matchedSkills || [],
    targetRoleTitle: role.title
  };
}
