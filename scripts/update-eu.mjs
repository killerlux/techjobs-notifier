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
const outSeenPath = path.join(dataDir, 'seen_jobs.json');

const EU_KEYWORDS = [
  'london', 'city of london', 'greater london', 'london, uk', 'london, united kingdom', 'gb-london'
];

const NEW_GRAD_KEYWORDS = [
  'new grad', 'new graduate', 'graduate', 'entry level', 'junior', 'early career',
  'jeune diplômé', 'recent graduate', 'grad role', 'graduate program', 'bac+5'
];

const CYBER_KEYWORDS = [
  'cyber', 'cybersecurity', 'security engineer', 'infosec', 'information security',
  'appsec', 'application security', 'security analyst', 'soc', 'penetration',
  'pentest', 'red team', 'blue team', 'threat', 'vulnerability', 'secure'
];

/** Only show jobs posted in the last N days (or unknown date). Test with 10. */
const MAX_DAYS = 10;
/** Delay between company fetches (ms) to avoid rate limits. */
const FETCH_DELAY_MS = 300;
/** Request timeout (ms). */
const FETCH_TIMEOUT_MS = 15000;
const MAX_NOTIFICATION_ROWS = 10;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function jobKey(job) {
  return `${job?.id ?? ''}::${job?.url ?? ''}`;
}

function sortJobs(jobs) {
  return [...jobs].sort((a, b) =>
    a.company.localeCompare(b.company)
    || a.title.localeCompare(b.title)
    || (a.url || '').localeCompare(b.url || '')
  );
}

function sameKeySet(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function formatNotification(newJobs, generatedAt) {
  const lines = [
    `New EU role(s) detected: ${newJobs.length}`,
    `Generated at: ${generatedAt}`,
    '',
  ];

  for (const [index, job] of newJobs.slice(0, MAX_NOTIFICATION_ROWS).entries()) {
    lines.push(
      `${index + 1}. ${job.company} - ${job.title}`,
      `   ${job.location || 'Unknown location'}`,
      `   ${job.url}`,
      ''
    );
  }

  if (newJobs.length > MAX_NOTIFICATION_ROWS) {
    lines.push(`...and ${newJobs.length - MAX_NOTIFICATION_ROWS} more`);
  }

  return lines.join('\n').trim();
}

async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { sent: false, reason: 'missing_credentials' };
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram send failed: ${res.status} ${body.slice(0, 200)}`);
  }

  return { sent: true };
}

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

function isCyber(title, desc) {
  return includesAny(title, CYBER_KEYWORDS) || includesAny(desc, CYBER_KEYWORDS);
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
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'tracker-eu/1.0' },
      signal: ac.signal
    });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(to);
  }
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
  let companiesFetched = 0;
  let fetchFailures = 0;
  for (const c of companies) {
    const type = c.ats?.type;
    const slug = c.ats?.slug;
    const fetcher = fetchers[type];
    if (!fetcher || !slug) {
      continue;
    }
    await sleep(FETCH_DELAY_MS);
    try {
      const jobs = await fetcher(slug);
      companiesFetched++;
      const euNewGrad = jobs
        .filter(j => isEU(j.location) && (isNewGrad(j.title, j.description) || isCyber(j.title, j.description)))
        .map(j => normalizeJob({ ...j, company: c.name }));
      for (const job of euNewGrad) results.push(job);
    } catch (err) {
      fetchFailures++;
      console.error(`Fetcher failed for ${c.name} (${type}:${slug}):`, err.message);
    }
  }

  await sleep(FETCH_DELAY_MS);
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
        .filter(j => isEU(j.location) && (isNewGrad(j.title, j.description) || isCyber(j.title, j.description)))
        .map(normalizeJob);
      const existingIds = new Set(results.map(r => r.id + r.url));
      const toAdd = enriched.filter(e => !existingIds.has(e.id + e.url));
      for (const job of toAdd) results.push(job);
    }
  } catch (e) {
    console.error('Special portals failed:', e.message);
  }

  const beforeFilter = results.length;
  // Only keep jobs from the last MAX_DAYS days (or unknown date)
  results = results.filter(isWithinLastDays);

  const sortedResults = sortJobs(results);
  const currentKeys = sortedResults.map(jobKey).sort();

  const previousPayload = await readJsonIfExists(outJsonPath);
  const previousResults = Array.isArray(previousPayload?.results) ? previousPayload.results : [];
  const previousKeys = previousResults.map(jobKey).sort();
  const hasResultSetChanged = !sameKeySet(currentKeys, previousKeys);

  const generatedAt = hasResultSetChanged || !previousPayload?.generatedAt
    ? new Date().toISOString()
    : previousPayload.generatedAt;

  const payload = {
    generatedAt,
    count: sortedResults.length,
    results: sortedResults
  };
  await writeFile(outJsonPath, JSON.stringify(payload, null, 2) + "\n");

  const tableRow = r => `| ${r.company} | ${r.title} | ${r.location} | ${r.daysAgo ?? '-'} | [Apply](${r.url}) |`;
  const rows = sortedResults
    .map(tableRow)
    .join('\n');

  const md = `# EU New Grad Roles (auto-generated)\n\n- Updated: ${payload.generatedAt}\n- London: new-grad + cyber/security roles from the last ${MAX_DAYS} days (or unknown date)\n- Source: data/companies.json\n\n| Company | Role | Location | Posted | Link |\n|---|---|---|---|---|\n${rows}\n`;
  await writeFile(outReadmePath, md);

  const seenState = await readJsonIfExists(outSeenPath);
  const seenKeys = Array.isArray(seenState?.seenKeys) ? seenState.seenKeys : null;
  let newJobs = [];

  if (seenKeys == null) {
    await writeFile(outSeenPath, JSON.stringify({ seenKeys: currentKeys }, null, 2) + "\n");
    console.log(`Bootstrapped seen state with ${currentKeys.length} jobs (no notifications sent).`);
  } else {
    const seenSet = new Set(seenKeys);
    newJobs = sortedResults.filter(job => !seenSet.has(jobKey(job)));

    if (newJobs.length > 0) {
      const message = formatNotification(newJobs, payload.generatedAt);
      try {
        const sent = await sendTelegramMessage(message);
        if (sent.sent) {
          console.log(`Telegram notification sent for ${newJobs.length} new job(s).`);
        } else {
          console.log('Telegram credentials missing; skipped notifications.');
        }
      } catch (err) {
        console.error('Telegram notification failed:', err.message);
      }
    }

    const mergedKeys = [...new Set([...seenKeys, ...currentKeys])].sort();
    if (!sameKeySet(mergedKeys, [...seenKeys].sort())) {
      await writeFile(outSeenPath, JSON.stringify({ seenKeys: mergedKeys }, null, 2) + "\n");
    }
  }

  console.log(`Companies fetched: ${companiesFetched}, failures: ${fetchFailures}`);
  console.log(`Jobs (London new-grad): ${beforeFilter} total, ${sortedResults.length} in last ${MAX_DAYS} days`);
  console.log(`Result set changed: ${hasResultSetChanged ? 'yes' : 'no'}, new jobs: ${newJobs.length}`);

  if (usedExample && !existsSync(companiesPath)) {
    console.log('\nNo data/companies.json found. Using example list.');
    console.log('Create data/companies.json with entries like the example to control sources.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
