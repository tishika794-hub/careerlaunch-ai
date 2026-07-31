```javascript
// src/lib/interviewEngine.js

// Lightweight interview engine that uses OpenAI if an API key is provided via Vite env (VITE_OPENAI_KEY).
// Falls back to the local QUESTION_BANK for deterministic question selection.

import { QUESTION_BANK } from '../data/mockData';

const OPENAI_KEY = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_OPENAI_KEY : (typeof process !== 'undefined' ? process.env.VITE_OPENAI_KEY : null);

async function callOpenAIChat(messages = [], model = 'gpt-4o-mini', maxTokens = 800) {
  if (!OPENAI_KEY) throw new Error('OpenAI key not configured');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error: ${res.status} ${body}`);
  }

  const data = await res.json();
  return data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
}

export async function generateInterviewQuestions(parsedResume = {}, targetRoleKey = 'frontend', level = 'intermediate', yearsExp = 0) {
  // If OpenAI is available, craft a prompt that asks for 4-6 targeted questions based on resume skills and projects.
  const skills = (parsedResume.skills || []).slice(0, 40).join(', ');
  const projects = (parsedResume.projects || []).slice(0, 6).join('\n');

  if (OPENAI_KEY) {
    const system = `You are a concise technical interviewer. Generate 4-6 interview questions tailored to a candidate given their resume skills and projects. For each question, return JSON with keys: id, question, keywords (array), type (technical/behavioral/design), difficulty (beginner/intermediate/advanced). Do NOT hallucinate candidate details. Use only the skills and projects provided.`;
    const user = `Skills: ${skills}\nProjects:\n${projects}\nTarget role: ${targetRoleKey}\nLevel: ${level}\nYears experience: ${yearsExp}\nOutput JSON array.`;
    try {
      const content = await callOpenAIChat([{ role: 'system', content: system }, { role: 'user', content: user }], 'gpt-4o-mini', 800);
      // Try to parse JSON from content
      const jsonStart = content.indexOf('[');
      const jsonText = jsonStart !== -1 ? content.slice(jsonStart) : content;
      const parsed = JSON.parse(jsonText);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('OpenAI question generation failed, falling back to local bank', e);
      // fallback to local
    }
  }

  // Local deterministic fallback: pick questions from QUESTION_BANK based on targetRoleKey and level
  const pool = (QUESTION_BANK[targetRoleKey] && QUESTION_BANK[targetRoleKey][level]) || [];
  // choose up to 5
  return pool.slice(0, 5).map(q => ({ id: q.id, question: q.question, keywords: q.keywords || [], type: 'technical', difficulty: level }));
}

export async function evaluateAnswer(answerText = '', questionObj = {}, parsedResume = {}) {
  // Deterministic local evaluator first: calculates keyword matches, STAR elements, filler words, length.
  const localEval = (() => {
    const normalized = (answerText || '').toLowerCase();
    const words = normalized.match(/\b[a-z0-9'-]+\b/g) || [];
    const wordCount = words.length;

    const expected = (questionObj.keywords || []).map(k => k.toLowerCase());
    const matched = expected.filter(k => normalized.includes(k));

    const starIndicators = ['situation', 'task', 'action', 'result', 'because', 'led to', 'improved', 'for example', 'example'];
    const starCount = starIndicators.reduce((acc, ind) => acc + (normalized.includes(ind) ? 1 : 0), 0);

    const filler = ['um', 'uh', 'like', 'you know', 'basically', 'actually'];
    const fillerCount = filler.reduce((acc, f) => acc + ((normalized.match(new RegExp(`\\b${f}\\b`, 'g')) || []).length), 0);

    const technicalAccuracy = Math.min(10, 4 + Math.round((matched.length / Math.max(1, expected.length)) * 4));
    const communication = Math.min(10, 3 + Math.round(Math.min(6, wordCount / 30)) - (fillerCount > 2 ? 1 : 0));
    const completeness = Math.min(10, 2 + Math.round(Math.min(8, wordCount / 25)) + (starCount >= 2 ? 1 : 0));

    return {
      technicalAccuracy,
      communication,
      completeness,
      confidence: Math.min(10, 5 + Math.round(matched.length)),
      starDetected: starCount >= 2,
      keywordMatches: matched,
      fillerCount,
      wordCount,
      strengths: matched.slice(0, 5),
      weaknesses: expected.filter(k => !matched.includes(k)).slice(0, 5)
    };
  })();

  // If OpenAI is available, produce a richer evaluation referencing expected keywords and suggesting improvements.
  if (OPENAI_KEY) {
    const system = `You are a calm, explanatory technical interviewer evaluator. Provide a JSON object with keys: technicalAccuracy(0-10), communication(0-10), completeness(0-10), confidence(0-10), starEvaluation(true/false), strengths(array), weaknesses(array), improvementSuggestions(array of strings). Reference only the answer text and the provided expected keywords. Do not hallucinate facts not in the answer.`;
    const user = `Question: ${questionObj.question || questionObj}
Expected keywords: ${(questionObj.keywords || []).join(', ')}
Candidate answer: ${answerText}
Return strict JSON.`;
    try {
      const content = await callOpenAIChat([{ role: 'system', content: system }, { role: 'user', content: user }], 'gpt-4o-mini', 600);
      const jsonStart = content.indexOf('{');
      const jsonText = jsonStart !== -1 ? content.slice(jsonStart) : content;
      const parsed = JSON.parse(jsonText);
      // Ensure fields exist and fallback to localEval where missing
      return {
        technicalAccuracy: parsed.technicalAccuracy ?? localEval.technicalAccuracy,
        communication: parsed.communication ?? localEval.communication,
        completeness: parsed.completeness ?? localEval.completeness,
        confidence: parsed.confidence ?? localEval.confidence,
        starEvaluation: parsed.starEvaluation ?? localEval.starDetected,
        strengths: parsed.strengths ?? localEval.strengths,
        weaknesses: parsed.weaknesses ?? localEval.weaknesses,
        improvementSuggestions: parsed.improvementSuggestions ?? []
      };
    } catch (e) {
      console.warn('OpenAI evaluation failed, falling back to local evaluator', e);
    }
  }

  return {
    technicalAccuracy: localEval.technicalAccuracy,
    communication: localEval.communication,
    completeness: localEval.completeness,
    confidence: localEval.confidence,
    starEvaluation: localEval.starDetected,
    strengths: localEval.strengths,
    weaknesses: localEval.weaknesses,
    improvementSuggestions: []
  };
}
```
