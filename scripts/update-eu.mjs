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

const TARGET_COUNTRIES = [
  {
    name: 'Luxembourg',
    aliases: ['luxembourg', 'luxemburg', 'lu', 'luxembourg city']
  },
  {
    name: 'France',
    aliases: ['france', 'fr', 'paris', 'lyon', 'toulouse', 'nantes', 'lille', 'bordeaux', 'nice']
  },
  {
    name: 'Ireland',
    aliases: ['ireland', 'ie', 'dublin', 'cork', 'galway', 'limerick']
  },
  {
    name: 'United Kingdom',
    aliases: [
      'united kingdom', 'uk', 'u.k.', 'great britain', 'gbr', 'gb',
      'england', 'scotland', 'wales', 'northern ireland',
      'london', 'manchester', 'edinburgh', 'belfast', 'bristol', 'cambridge', 'oxford'
    ]
  },
  {
    name: 'Norway',
    aliases: ['norway', 'no', 'oslo', 'bergen', 'trondheim']
  },
  {
    name: 'Finland',
    aliases: ['finland', 'fi', 'helsinki', 'espoo', 'tampere']
  },
  {
    name: 'Netherlands',
    aliases: ['netherlands', 'the netherlands', 'nl', 'amsterdam', 'rotterdam', 'utrecht', 'eindhoven', 'the hague', 'den haag']
  },
  {
    name: 'Sweden',
    aliases: ['sweden', 'se', 'stockholm', 'gothenburg', 'goteborg', 'malmo']
  },
  {
    name: 'Singapore',
    aliases: ['singapore', 'sg']
  },
  {
    name: 'Qatar',
    aliases: ['qatar', 'qa', 'doha']
  },
  {
    name: 'Iceland',
    aliases: ['iceland', 'is', 'reykjavik']
  },
  {
    name: 'Switzerland',
    aliases: ['switzerland', 'ch', 'zurich', 'geneva', 'basel', 'lausanne', 'bern']
  },
  {
    name: 'Denmark',
    aliases: ['denmark', 'dk', 'copenhagen', 'aarhus', 'odense']
  },
  {
    name: 'Belgium',
    aliases: ['belgium', 'be', 'brussels', 'antwerp', 'ghent']
  },
  {
    name: 'Austria',
    aliases: ['austria', 'at', 'vienna', 'graz', 'linz']
  },
  {
    name: 'Germany',
    aliases: ['germany', 'de', 'berlin', 'munich', 'hamburg', 'frankfurt', 'cologne', 'stuttgart']
  },
  {
    name: 'Slovenia',
    aliases: ['slovenia', 'si', 'ljubljana']
  },
  {
    name: 'Spain',
    aliases: ['spain', 'es', 'madrid', 'barcelona', 'valencia', 'bilbao']
  },
  {
    name: 'Italy',
    aliases: ['italy', 'it', 'milan', 'rome', 'turin']
  },
  {
    name: 'Malta',
    aliases: ['malta', 'mt', 'valletta']
  },
  {
    name: 'Lithuania',
    aliases: ['lithuania', 'lt', 'vilnius', 'kaunas']
  },
  {
    name: 'Cyprus',
    aliases: ['cyprus', 'cy', 'nicosia', 'limassol', 'larnaca']
  }
];

const LEVEL_PATTERNS = [
  /\bnew\s*grad(uate)?\b/i,
  /\bgraduate\b/i,
  /\bentry[\s-]*level\b/i,
  /\bjunior\b/i,
  /\bearly\s*career\b/i,
  /\brecent\s*graduate\b/i,
  /\buniversity\s*graduate\b/i,
  /\bcampus\b/i,
];

const TECH_PATTERNS = [
  /\bsoftware\b/i,
  /\bsecurity\b/i,
  /\bcyber(?:security)?\b/i,
  /\binfosec\b/i,
  /\bappsec\b/i,
  /\bapplication\s+security\b/i,
  /\bdata\b/i,
  /\bmachine\s+learning\b/i,
  /\bml\b/i,
  /\bai\b/i,
  /\bdevops\b/i,
  /\bsre\b/i,
  /\bsite\s+reliability\b/i,
  /\bplatform\b/i,
  /\bcloud\b/i,
  /\bbackend\b/i,
  /\bback-end\b/i,
  /\bfrontend\b/i,
  /\bfront-end\b/i,
  /\bfull[\s-]*stack\b/i,
  /\bengineer\b/i,
  /\bdeveloper\b/i,
];

const NEGATIVE_PATTERNS = [
  /\bdue\s+diligence\b/i,
  /\bcompliance\b/i,
  /\baudit\b/i,
  /\blegal\b/i,
  /\battorney\b/i,
  /\baccounting\b/i,
  /\bfinance\b/i,
  /\bfinancial\b/i,
  /\bsales\b/i,
  /\bmarketing\b/i,
  /\brecruit(ing|er)?\b/i,
  /\bhuman\s+resources\b/i,
  /\bhr\b/i,
  /\bcustomer\s+support\b/i,
  /\bdue\s+care\b/i,
  /\bsenior\b/i,
  /\bstaff\b/i,
  /\bprincipal\b/i,
  /\blead\b/i,
];

const TARGET_COUNTRY_LINE = TARGET_COUNTRIES.map(country => country.name).join(', ');
const COUNTRY_ORDER_INDEX = new Map(TARGET_COUNTRIES.map((country, index) => [country.name, index]));

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
  const countryIndex = (country) => COUNTRY_ORDER_INDEX.has(country)
    ? COUNTRY_ORDER_INDEX.get(country)
    : Number.MAX_SAFE_INTEGER;

  return [...jobs].sort((a, b) =>
    countryIndex(a.country) - countryIndex(b.country)
    || a.company.localeCompare(b.company)
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

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsAlias(text, alias) {
  const normalizedText = normalizeText(text);
  const normalizedAlias = normalizeText(alias);
  if (!normalizedAlias) return false;
  const pattern = new RegExp(`(^|\\s)${escapeRegex(normalizedAlias)}($|\\s)`, 'i');
  return pattern.test(normalizedText);
}

function resolveTargetCountry(locationText) {
  const raw = String(locationText || '').trim();
  if (!raw) return null;
  for (const country of TARGET_COUNTRIES) {
    if (country.aliases.some(alias => containsAlias(raw, alias))) {
      return country.name;
    }
  }
  return null;
}

function hasLevelSignal(title, description) {
  const titleText = String(title || '');
  const descriptionText = String(description || '');

  if (LEVEL_PATTERNS.some(pattern => pattern.test(titleText))) {
    return true;
  }

  const associateTechnicalTitle = /\bassociate\b/i.test(titleText)
    && /\b(engineer|developer|security|cyber|data|platform|devops|sre)\b/i.test(titleText);
  if (associateTechnicalTitle) {
    return true;
  }

  const titleLooksTechnical = /\b(engineer|developer|security|cyber|data|software|devops|sre|platform)\b/i.test(titleText);
  return titleLooksTechnical && LEVEL_PATTERNS.some(pattern => pattern.test(descriptionText));
}

function hasTechSignal(title, description) {
  const titleText = String(title || '');
  const descriptionText = String(description || '');

  if (TECH_PATTERNS.some(pattern => pattern.test(titleText))) {
    return true;
  }

  const nonTechnicalTitle = /\b(associate|operations|manager|consultant|coordinator|specialist|analyst)\b/i.test(titleText);
  if (nonTechnicalTitle) {
    return false;
  }

  return TECH_PATTERNS.some(pattern => pattern.test(descriptionText));
}

function hasNegativeSignal(title, description) {
  const text = `${title || ''} ${description || ''}`;
  return NEGATIVE_PATTERNS.some(pattern => pattern.test(text));
}

function evaluateRole(title, description) {
  if (hasNegativeSignal(title, description)) {
    return { ok: false, reason: 'negative_signal' };
  }
  if (!hasLevelSignal(title, description)) {
    return { ok: false, reason: 'missing_level_signal' };
  }
  if (!hasTechSignal(title, description)) {
    return { ok: false, reason: 'missing_tech_signal' };
  }
  return { ok: true, reason: 'level+tech' };
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
    description: String(j.content || ''),
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
    description: j.description || j.descriptionHtml || '',
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
  const country = j.country || undefined;
  const matchReason = j.matchReason || undefined;
  return {
    id: j.id,
    title: j.title,
    location: j.location || '',
    country,
    url: j.url,
    company: j.company,
    source: j.source,
    matchReason,
    postedAt: postedAt || undefined,
    daysAgo: daysAgo(postedAt) || undefined
  };
}

function selectTargetJobs(jobs, companyName) {
  const selected = [];
  for (const job of jobs) {
    const country = resolveTargetCountry(job.location);
    if (!country) {
      continue;
    }
    const role = evaluateRole(job.title, job.description);
    if (!role.ok) {
      continue;
    }
    selected.push(
      normalizeJob({
        ...job,
        company: companyName || job.company,
        country,
        matchReason: role.reason,
      })
    );
  }
  return selected;
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
      const matchedJobs = selectTargetJobs(jobs, c.name);
      for (const job of matchedJobs) results.push(job);
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
      const enriched = selectTargetJobs(special);
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

  const tableRow = r => `| ${r.company} | ${r.title} | ${r.country ?? '-'} | ${r.location} | ${r.daysAgo ?? '-'} | ${r.source} | [Apply](${r.url}) |`;
  const rows = sortedResults
    .map(tableRow)
    .join('\n');
  const rowsOrPlaceholder = rows || '| - | - | - | - | - | - | - |';

  const md = `# EU New Grad Roles (auto-generated)\n\n- Updated: ${payload.generatedAt}\n- Countries: ${TARGET_COUNTRY_LINE}\n- Filters: entry-level + technical roles only, posted in last ${MAX_DAYS} days (or unknown date)\n- Source: data/companies.json\n\n| Company | Role | Country | Location | Posted | Source | Link |\n|---|---|---|---|---|---|---|\n${rowsOrPlaceholder}\n`;
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
  console.log(`Jobs (target countries + entry-level technical): ${beforeFilter} total, ${sortedResults.length} in last ${MAX_DAYS} days`);
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
