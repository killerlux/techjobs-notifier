#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fetchAmazonLondonNewGrad, fetchMicrosoftLondonNewGrad } from './connectors.mjs';

const root = process.cwd();
const dataDir = path.join(root, 'data');
const companiesPath = path.join(dataDir, 'companies.json');
const exampleCompaniesPath = path.join(dataDir, 'companies.example.json');
const outJsonPath = path.join(dataDir, 'eu_roles.json');
const outReadmePath = path.join(root, 'README.md');

const EU_KEYWORDS = [
  'london', 'city of london', 'greater london', 'london, uk', 'london, united kingdom', 'gb-london'
];

const NEW_GRAD_KEYWORDS = [
  'new grad', 'new graduate', 'graduate', 'entry level', 'junior', 'early career',
  'jeune diplômé', 'recent graduate', 'grad role', 'graduate program', 'bac+5'
];

/** Only show jobs posted in the last N days (or unknown date). */
const MAX_DAYS = 3;

function includesAny(text, words) {
  const t = (text || '').toLowerCase();
  return words.some(w => t.includes(w));
}

function isEU(loc) {
  return includesAny(loc, EU_KEYWORDS);
}

function isNewGrad(title, desc) {
  return includesAny(title, NEW_GRAD_KEYWORDS) || includesAny(desc, NEW_GRAD_KEYWORDS);
}

/** Parse ISO string or Unix ms; return ms since epoch or NaN. */
function parseDate(s) {
  if (s == null || s === '') return NaN;
  if (typeof s === 'number' && Number.isFinite(s)) return s < 1e10 ? s * 1000 : s; // Unix s or ms
  const n = Date.parse(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Return "0d", "1d", "2d", "3d", ... from a date string; "" if unknown. */
function daysAgo(dateStr) {
  const ms = parseDate(dateStr);
  if (Number.isNaN(ms)) return '';
  const days = Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000));
  if (days < 0) return '0d';
  return `${days}d`;
}

/** True if job has no posted date or was posted within the last MAX_DAYS days. */
function isWithinLastDays(job) {
  const d = job.daysAgo ?? job.postedAt;
  if (d === undefined || d === '' || d === '-') return true;
  const match = String(d).match(/^(\d+)d$/);
  if (!match) return true;
  return parseInt(match[1], 10) <= MAX_DAYS;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'tracker-eu/1.0' } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function fetchGreenhouse(slug) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
  const data = await fetchJson(url);
  const jobs = (data.jobs || []).map(j => ({
    id: String(j.id),
    title: j.title,
    location: j.location?.name || '',
    url: j.absolute_url,
    description: '',
    company: slug,
    source: 'greenhouse',
    postedAt: j.updated_at || j.created_at || null
  }));
  return jobs;
}

async function fetchLever(slug) {
  const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;
  const data = await fetchJson(url);
  return data.map(j => ({
    id: j.id || j._id || j.slug || '',
    title: j.text || j.title,
    location: (j.categories?.location) || '',
    url: j.hostedUrl || j.applyUrl || '',
    description: j.descriptionPlain || j.description || '',
    company: slug,
    source: 'lever',
    postedAt: j.createdAt || j.updatedAt || null
  }));
}

async function fetchAshby(slug) {
  const url = `https://jobs.ashbyhq.com/api/external/jobs?organizationSlug=${slug}`;
  const data = await fetchJson(url);
  const jobs = (data.jobs || []).map(j => ({
    id: j.id || j.jobId || '',
    title: j.title,
    location: j.location?.text || j.location?.name || '',
    url: j.jobUrl || j.applyUrl || '',
    description: j.descriptionPlain || j.description || '',
    company: slug,
    source: 'ashby',
    postedAt: j.publishedAt || j.updatedAt || j.createdAt || null
  }));
  return jobs;
}

async function fetchWorkable(slug) {
  const url = `https://apply.workable.com/api/v3/accounts/${slug}/jobs?limit=200`;
  const data = await fetchJson(url);
  const jobs = (data.results || []).map(j => ({
    id: j.shortcode || j.id || '',
    title: j.title,
    location: j.location?.city ? `${j.location.city}, ${j.location.country}` : (j.location?.country || ''),
    url: `https://apply.workable.com/${slug}/j/${j.shortcode}/`,
    description: '',
    company: slug,
    source: 'workable',
    postedAt: j.publishedDate || j.updatedAt || null
  }));
  return jobs;
}

async function fetchSmartRecruiters(slug) {
  const base = `https://api.smartrecruiters.com/v1/companies/${slug}/postings`;
  const data = await fetchJson(`${base}?limit=200`);
  const items = data?.content || data?.results || data?.data || [];
  return items.map(j => ({
    id: j.id || j.uuid || '',
    title: j.name || j.title || '',
    location: j.location?.city ? `${j.location.city}, ${j.location.country}` : (j.location?.country || ''),
    url: j.applyUrl || j.ref || `https://jobs.smartrecruiters.com/${slug}/${j.id}`,
    description: '',
    company: slug,
    source: 'smartrecruiters',
    postedAt: j.releasedDate || j.updatedAt || null
  }));
}

const fetchers = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
  workable: fetchWorkable,
  smartrecruiters: fetchSmartRecruiters,
};

async function loadCompanies() {
  if (!existsSync(companiesPath)) {
    // If no companies.json, use example and instruct the user
    const ex = JSON.parse(await readFile(exampleCompaniesPath, 'utf8'));
    return { companies: ex, usedExample: true };
  }
  const companies = JSON.parse(await readFile(companiesPath, 'utf8'));
  return { companies, usedExample: false };
}

function normalizeJob(j) {
  const postedAt = j.postedAt || null;
  return {
    id: j.id,
    title: j.title,
    location: j.location || '',
    url: j.url,
    company: j.company,
    source: j.source,
    postedAt: postedAt || undefined,
    daysAgo: daysAgo(postedAt) || undefined
  };
}

async function main() {
  await mkdir(dataDir, { recursive: true });
  const { companies, usedExample } = await loadCompanies();

  let results = [];
  for (const c of companies) {
    const type = c.ats?.type;
    const slug = c.ats?.slug;
    const fetcher = fetchers[type];
    if (!fetcher || !slug) {
      continue;
    }
    try {
      const jobs = await fetcher(slug);
      const euNewGrad = jobs
        .filter(j => isEU(j.location) && isNewGrad(j.title, j.description))
        .map(j => normalizeJob({ ...j, company: c.name }));
      for (const job of euNewGrad) results.push(job);
    } catch (err) {
      // Non-fatal: continue with others
      console.error(`Fetcher failed for ${c.name} (${type}:${slug}):`, err.message);
    }
  }

  // Special portals (direct company sites)
  try {
    const special = [];
    const a = await fetchAmazonLondonNewGrad();
    for (const j of a) special.push(j);
    try {
      const m = await fetchMicrosoftLondonNewGrad();
      for (const j of m) special.push(j);
    } catch {}
    if (special.length) {
      const enriched = special
        .filter(j => isNewGrad(j.title, j.description) && isEU(j.location))
        .map(normalizeJob);
      const existingIds = new Set(results.map(r => r.id + r.url));
      const toAdd = enriched.filter(e => !existingIds.has(e.id + e.url));
      for (const job of toAdd) results.push(job);
    }
  } catch (e) {
    console.error('Special portals failed:', e.message);
  }

  // Only keep jobs from the last MAX_DAYS days (or unknown date)
  results = results.filter(isWithinLastDays);

  const payload = {
    generatedAt: new Date().toISOString(),
    count: results.length,
    results
  };
  await writeFile(outJsonPath, JSON.stringify(payload, null, 2) + "\n");

  const tableRow = r => `| ${r.company} | ${r.title} | ${r.location} | ${r.daysAgo ?? '-'} | [Apply](${r.url}) |`;
  const rows = results
    .sort((a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title))
    .map(tableRow)
    .join('\n');
  const md = `# EU New Grad Roles (auto-generated)\n\n- Updated: ${payload.generatedAt}\n- London new-grad roles from the last ${MAX_DAYS} days (or unknown date)\n- Source: data/companies.json\n\n| Company | Role | Location | Posted | Link |\n|---|---|---|---|---|\n${rows}\n`;
  await writeFile(outReadmePath, md);

  if (usedExample && !existsSync(companiesPath)) {
    console.log('\nNo data/companies.json found. Using example list.');
    console.log('Create data/companies.json with entries like the example to control sources.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
