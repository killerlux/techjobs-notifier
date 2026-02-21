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
const outReadmePath = path.join(root, 'README_EU.md');

const EU_KEYWORDS = [
  'london', 'city of london', 'greater london', 'london, uk', 'london, united kingdom', 'gb-london'
];

const NEW_GRAD_KEYWORDS = [
  'new grad', 'new graduate', 'graduate', 'entry level', 'junior', 'early career',
  'jeune diplômé', 'recent graduate', 'grad role', 'graduate program', 'bac+5'
];

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
    source: 'greenhouse'
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
    source: 'lever'
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
    source: 'ashby'
  }));
  return jobs;
}

async function fetchWorkable(slug) {
  // Workable public API
  const url = `https://apply.workable.com/api/v3/accounts/${slug}/jobs?limit=200`;
  const data = await fetchJson(url);
  const jobs = (data.results || []).map(j => ({
    id: j.shortcode || j.id || '',
    title: j.title,
    location: j.location?.city ? `${j.location.city}, ${j.location.country}` : (j.location?.country || ''),
    url: `https://apply.workable.com/${slug}/j/${j.shortcode}/`,
    description: '',
    company: slug,
    source: 'workable'
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
    source: 'smartrecruiters'
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
  return {
    id: j.id,
    title: j.title,
    location: j.location || '',
    url: j.url,
    company: j.company,
    source: j.source
  };
}

async function main() {
  await mkdir(dataDir, { recursive: true });
  const { companies, usedExample } = await loadCompanies();

  const results = [];
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

  const payload = {
    generatedAt: new Date().toISOString(),
    count: results.length,
    results
  };
  await writeFile(outJsonPath, JSON.stringify(payload, null, 2) + "\n");

  // Generate simple README_EU.md
  const rows = results
    .sort((a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title))
    .map(r => `| ${r.company} | ${r.title} | ${r.location} | [Apply](${r.url}) |`)
    .join('\n');
  const md = `# EU New Grad Roles (auto-generated)\n\n- Updated: ${payload.generatedAt}\n- Source companies in data/companies.json\n\n| Company | Role | Location | Link |\n|---|---|---|---|\n${rows}\n`;
  await writeFile(outReadmePath, md);

  if (usedExample && !existsSync(companiesPath)) {
    console.log('\nNo data/companies.json found. Using example list.');
    console.log('Create data/companies.json with entries like the example to control sources.');
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
      if (toAdd.length) {
        results.push(...toAdd);
        payload.count = results.length;
        await writeFile(outJsonPath, JSON.stringify({ ...payload, results }, null, 2) + "\n");
        const rows2 = results
          .sort((a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title))
          .map(r => `| ${r.company} | ${r.title} | ${r.location} | [Apply](${r.url}) |`)
          .join('\n');
        const md2 = `# EU New Grad Roles (auto-generated)\n\n- Updated: ${new Date().toISOString()}\n- Source companies in data/companies.json + direct portals\n\n| Company | Role | Location | Link |\n|---|---|---|---|\n${rows2}\n`;
        await writeFile(outReadmePath, md2);
      }
    }
  } catch (e) {
    console.error('Special portals failed:', e.message);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
