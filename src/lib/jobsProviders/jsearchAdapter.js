// src/lib/jobsProviders/jsearchAdapter.js

import axios from 'axios';

const RAPIDAPI_KEY = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_RAPIDAPI_KEY : (typeof process !== 'undefined' ? process.env.VITE_RAPIDAPI_KEY : null);

export async function searchInternshipsBySkills(skills = [], role = 'frontend', location = '') {
  // Uses the JSearch API via RapidAPI (https://rapidapi.com) if RAPIDAPI_KEY is provided.
  if (!RAPIDAPI_KEY) {
    throw new Error('RAPIDAPI_KEY not set');
  }

  const query = skills.slice(0, 8).join(' OR ');
  const url = 'https://jsearch.p.rapidapi.com/search';
  const params = {
    query: `${role} intern ${query}`,
    // page_size: 20
  };

  const headers = {
    'X-RapidAPI-Key': RAPIDAPI_KEY,
    'X-RapidAPI-Host': 'jsearch.p.rapidapi.com'
  };

  const res = await axios.get(url, { headers, params });
  // Map response to common internship shape
  // The exact schema varies; do best-effort extraction
  if (res.data && res.data.data) {
    return res.data.data.map(item => ({
      id: item.job_id || item.id || item._id || Math.random().toString(36).slice(2, 9),
      title: item.job_title || item.title || 'Internship',
      company: item.employer_name || item.company_name || item.company || 'Company',
      location: item.job_city || item.city || item.location || 'Remote',
      stipend: item.salary || item.salary_estimate || 'Not disclosed',
      duration: item.duration || 'Not specified',
      roleCategory: role,
      skills: item.tags || item.job_highlights || [],
      postedDate: item.job_posted_at || item.posted_at || 'Unknown',
      description: (item.job_description || item.description || '').slice(0, 800),
      applyUrl: item.job_apply_link || item.url || item.job_href || item.redirect_url || item.apply_link || item.apply_url
    }));
  }

  return [];
}
