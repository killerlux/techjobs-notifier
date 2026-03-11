#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fetchAmazonLondonNewGrad, fetchMicrosoftLondonNewGrad } from './connectors.mjs';

const root = process.cwd();
const dataDir = path.join(root, 'data');
const companiesActivePath = path.join(dataDir, 'companies_active.json');
const companiesLegacyPath = path.join(dataDir, 'companies.json');
const exampleCompaniesPath = path.join(dataDir, 'companies.example.json');
const outJsonPath = path.join(dataDir, 'eu_roles.json');
const outReadmePath = path.join(root, 'README.md');
const outSeenPath = path.join(dataDir, 'seen_jobs.json');
const portalHealthPath = path.join(dataDir, 'portal_health.json');

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
  /\bdata\s+(engineer|engineering|scientist|science|platform|infrastructure)\b/i,
  /\b(machine\s+learning|ml|ai)\s+(engineer|engineering|scientist|science|research)\b/i,
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
  /\bconsultant\b/i,
  /\bmanager\b/i,
  /\bsenior\b/i,
  /\bstaff\b/i,
  /\bprincipal\b/i,
  /\blead\b/i,
];

const TARGET_COUNTRY_LINE = TARGET_COUNTRIES.map(country => country.name).join(', ');
const COUNTRY_ORDER_INDEX = new Map(TARGET_COUNTRIES.map((country, index) => [country.name, index]));
const PRIORITY_TIERS = {
  faang: 2,
  cac40: 1,
  standard: 0,
};

const FAANG_ALIASES = [
  'amazon', 'google', 'alphabet', 'meta', 'facebook', 'apple', 'netflix', 'microsoft'
];

const CAC40_ALIASES = [
  'airbus', 'air liquide', 'axa', 'bnp paribas', 'bouygues', 'capgemini', 'carrefour',
  'credit agricole', 'danone', 'engie', 'essilorluxottica', 'hermes', 'kering',
  'loreal', 'lvmh', 'michelin', 'orange', 'pernod ricard', 'publicis', 'renault',
  'safran', 'saint gobain', 'sanofi', 'schneider electric', 'societe generale',
  'stellantis', 'thales', 'totalenergies', 'unibail', 'veolia', 'vinci', 'worldline'
];

/** Only show jobs posted in the last N days (or unknown date). Test with 10. */
const MAX_DAYS = 10;
/** Request timeout (ms). */
const FETCH_TIMEOUT_MS = 15000;
const FETCH_RETRIES = 2;
/** Number of ATS portals fetched in parallel. */
const FETCH_CONCURRENCY = Number(process.env.FETCH_CONCURRENCY || 12);
/** Random jitter before each fetch (ms) to reduce synchronized bursts. */
const FETCH_JITTER_MS = 120;
const MAX_NOTIFICATION_ROWS = 10;
const MIGRATION_ALERT_SUPPRESS_THRESHOLD = 80;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runPool(items, worker, concurrency) {
  if (items.length === 0) return [];
  const results = new Array(items.length);
  let index = 0;

  async function runner() {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) {
        return;
      }
      results[current] = await worker(items[current]);
    }
  }

  const count = Math.max(1, Math.min(concurrency, items.length));
  const runners = [];
  for (let i = 0; i < count; i += 1) {
    runners.push(runner());
  }
  await Promise.all(runners);
  return results;
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

  const priorityRank = (tier) => PRIORITY_TIERS[tier] ?? PRIORITY_TIERS.standard;

  return [...jobs].sort((a, b) =>
    priorityRank(b.priorityTier) - priorityRank(a.priorityTier)
    || countryIndex(a.country) - countryIndex(b.country)
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
  const sortedNewJobs = sortJobs(newJobs);
  const lines = [
    `New EU role(s) detected: ${newJobs.length}`,
    `Generated at: ${generatedAt}`,
    '',
  ];

  for (const [index, job] of sortedNewJobs.slice(0, MAX_NOTIFICATION_ROWS).entries()) {
    const priority = job.priorityTier === 'faang'
      ? '[FAANG] '
      : (job.priorityTier === 'cac40' ? '[CAC40] ' : '');
    lines.push(
      `${index + 1}. ${priority}${job.company} - ${job.title}`,
      `   ${job.country || 'Unknown country'} | ${job.location || 'Unknown location'}`,
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

function detectPriorityTier(companyName, title, url) {
  const haystack = `${companyName || ''} ${title || ''} ${url || ''}`;

  if (FAANG_ALIASES.some(alias => containsAlias(haystack, alias))) {
    return 'faang';
  }

  if (CAC40_ALIASES.some(alias => containsAlias(haystack, alias))) {
    return 'cac40';
  }

  return 'standard';
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
  const combinedText = `${titleText} ${descriptionText}`;

  if (LEVEL_PATTERNS.some(pattern => pattern.test(titleText))) {
    return true;
  }

  const associateTechnicalTitle = /\bassociate\b/i.test(titleText)
    && /\b(engineer|developer)\b/i.test(titleText)
    && /\b(new\s*grad(uate)?|graduate|entry[\s-]*level|junior|early\s*career|campus)\b/i.test(combinedText);
  if (associateTechnicalTitle) {
    return true;
  }

  const titleLooksTechnical = /\b(engineer|developer|security|cyber|data|software|devops|sre|platform)\b/i.test(titleText);
  return titleLooksTechnical && LEVEL_PATTERNS.some(pattern => pattern.test(descriptionText));
}

function hasTechSignal(title, description) {
  const titleText = String(title || '');
  const nonTechnicalTitle = /\b(associate|operations|manager|consultant|coordinator|specialist|analyst|designer)\b/i.test(titleText);
  if (nonTechnicalTitle) {
    return /\b(software|security|cyber|appsec|devops|sre|developer|engineer|ml|machine\s+learning|ai|platform)\b/i.test(titleText);
  }

  return TECH_PATTERNS.some(pattern => pattern.test(titleText));
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
  let lastError = null;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'tracker-eu/1.0' },
        signal: ac.signal
      });
      if (!res.ok) throw new Error(`${url} -> ${res.status}`);
      return res.json();
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_RETRIES) {
        await sleep(200 * (attempt + 1));
      }
    } finally {
      clearTimeout(to);
    }
  }
  throw lastError;
}

async function fetchText(url) {
  let lastError = null;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'tracker-eu/1.0' },
        signal: ac.signal
      });
      if (!res.ok) throw new Error(`${url} -> ${res.status}`);
      return res.text();
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_RETRIES) {
        await sleep(200 * (attempt + 1));
      }
    } finally {
      clearTimeout(to);
    }
  }
  throw lastError;
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function ashbySlugCandidates(slug) {
  const base = safeDecodeURIComponent(String(slug || '').trim()).replace(/^\/+|\/+$/g, '');
  const candidates = [];
  const push = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized || candidates.includes(normalized)) return;
    candidates.push(normalized);
  };

  push(base);
  push(base.replace(/\s+/g, '-'));
  push(base.replace(/\s+/g, ''));
  push(base.replace(/\.(com|ai|io|co|uk|au|eu|org)$/g, ''));
  push(base.replace(/[^a-z0-9._-]/g, ''));
  push(base.replace(/[^a-z0-9]+/g, '-'));
  push(base.replace(/[^a-z0-9]+/g, ''));

  return candidates;
}

function extractAshbyAppData(html) {
  const marker = 'window.__appData = ';
  const start = html.indexOf(marker);
  if (start === -1) {
    throw new Error('Ashby app data marker missing');
  }

  let index = start + marker.length;
  while (index < html.length && html[index] !== '{') {
    index += 1;
  }
  if (index >= html.length) {
    throw new Error('Ashby app data JSON start not found');
  }

  let braceDepth = 0;
  let inString = false;
  let escaped = false;
  let quote = '';
  let end = -1;

  for (let i = index; i < html.length; i += 1) {
    const char = html[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }

    if (char === '{') {
      braceDepth += 1;
      continue;
    }
    if (char === '}') {
      braceDepth -= 1;
      if (braceDepth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  if (end === -1) {
    throw new Error('Ashby app data JSON end not found');
  }

  return JSON.parse(html.slice(index, end));
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
  let lastError = null;

  for (const candidate of ashbySlugCandidates(slug)) {
    const boardUrl = `https://jobs.ashbyhq.com/${encodeURIComponent(candidate)}`;
    try {
      const html = await fetchText(boardUrl);
      const appData = extractAshbyAppData(html);
      const postings = Array.isArray(appData?.jobBoard?.jobPostings)
        ? appData.jobBoard.jobPostings
        : [];

      const jobs = postings
        .filter(posting => posting?.isListed !== false)
        .map(posting => {
          const secondaryLocations = Array.isArray(posting.secondaryLocations)
            ? posting.secondaryLocations.map(item => item?.locationName).filter(Boolean)
            : [];
          const primaryLocation = posting.locationName || '';
          const allLocations = [primaryLocation, ...secondaryLocations].filter(Boolean);

          return {
            id: posting.jobId || posting.id || '',
            title: posting.title || '',
            location: allLocations.join(', '),
            url: `${boardUrl}/${posting.id}`,
            description: `${posting.teamName || ''} ${posting.departmentName || ''} ${posting.employmentType || ''}`.trim(),
            company: candidate,
            source: 'ashby',
            postedAt: posting.publishedDate || posting.updatedAt || null
          };
        });

      return jobs;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`Ashby fetch failed for slug ${slug}`);
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

function companyAtsKey(company) {
  const type = String(company?.ats?.type || '').toLowerCase();
  const slug = String(company?.ats?.slug || company?.ats?.host || '').toLowerCase();
  if (!type || !slug) return null;
  return `${type}::${slug}`;
}

async function applyPortalHealthFilter(companies) {
  if (!existsSync(portalHealthPath)) {
    return {
      companies,
      healthFilteredOut: 0,
    };
  }

  const healthPayload = await readJsonIfExists(portalHealthPath);
  const rows = Array.isArray(healthPayload?.results) ? healthPayload.results : [];
  if (rows.length === 0) {
    return {
      companies,
      healthFilteredOut: 0,
    };
  }

  const healthyStatuses = new Set(['healthy', 'degraded', 'empty']);
  const healthIndex = new Map();
  for (const row of rows) {
    const key = `${String(row?.type || '').toLowerCase()}::${String(row?.slug || '').toLowerCase()}`;
    if (!row?.type || !row?.slug) continue;
    healthIndex.set(key, row.status);
  }

  const filtered = [];
  let filteredOut = 0;

  for (const company of companies) {
    const key = companyAtsKey(company);
    if (!key) {
      filtered.push(company);
      continue;
    }

    const status = healthIndex.get(key);
    if (status && !healthyStatuses.has(status)) {
      filteredOut += 1;
      continue;
    }
    filtered.push(company);
  }

  return {
    companies: filtered,
    healthFilteredOut: filteredOut,
  };
}

async function loadCompanies() {
  if (existsSync(companiesActivePath)) {
    const companies = JSON.parse(await readFile(companiesActivePath, 'utf8'));
    const filtered = await applyPortalHealthFilter(companies);
    return {
      companies: filtered.companies,
      usedExample: false,
      sourcePath: companiesActivePath,
      healthFilteredOut: filtered.healthFilteredOut,
    };
  }

  if (existsSync(companiesLegacyPath)) {
    const companies = JSON.parse(await readFile(companiesLegacyPath, 'utf8'));
    const filtered = await applyPortalHealthFilter(companies);
    return {
      companies: filtered.companies,
      usedExample: false,
      sourcePath: companiesLegacyPath,
      healthFilteredOut: filtered.healthFilteredOut,
    };
  }

  const ex = JSON.parse(await readFile(exampleCompaniesPath, 'utf8'));
  return {
    companies: ex,
    usedExample: true,
    sourcePath: exampleCompaniesPath,
    healthFilteredOut: 0,
  };
}

function normalizeJob(j) {
  const postedAt = j.postedAt || null;
  const country = j.country || undefined;
  const matchReason = j.matchReason || undefined;
  const priorityTier = j.priorityTier || 'standard';
  return {
    id: j.id,
    title: j.title,
    location: j.location || '',
    country,
    url: j.url,
    company: j.company,
    source: j.source,
    matchReason,
    priorityTier,
    postedAt: postedAt || undefined,
    daysAgo: daysAgo(postedAt) || undefined
  };
}

function selectTargetJobs(jobs, companyName) {
  const selected = [];
  for (const job of jobs) {
    const resolvedCompany = companyName || job.company;
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
        company: resolvedCompany,
        country,
        matchReason: role.reason,
        priorityTier: detectPriorityTier(resolvedCompany, job.title, job.url),
      })
    );
  }
  return selected;
}

async function main() {
  await mkdir(dataDir, { recursive: true });
  const { companies, usedExample, sourcePath, healthFilteredOut } = await loadCompanies();

  let results = [];
  let companiesFetched = 0;
  let fetchFailures = 0;
  const failureDetails = [];

  const fetchOutcomes = await runPool(companies, async (c) => {
    const type = c.ats?.type;
    const slug = c.ats?.slug;
    const fetcher = fetchers[type];
    if (!fetcher || !slug) {
      return {
        company: c.name,
        skipped: true,
        jobs: [],
      };
    }

    if (FETCH_JITTER_MS > 0) {
      await sleep(Math.floor(Math.random() * FETCH_JITTER_MS));
    }

    try {
      const jobs = await fetcher(slug);
      const matchedJobs = selectTargetJobs(jobs, c.name);
      return {
        company: c.name,
        skipped: false,
        jobs: matchedJobs,
        failed: false,
      };
    } catch (err) {
      return {
        company: c.name,
        skipped: false,
        jobs: [],
        failed: true,
        type,
        slug,
        error: err.message,
      };
    }
  }, FETCH_CONCURRENCY);

  for (const outcome of fetchOutcomes) {
    if (!outcome) continue;
    if (outcome.skipped) continue;
    companiesFetched += 1;
    if (outcome.failed) {
      fetchFailures += 1;
      failureDetails.push(outcome);
      continue;
    }
    for (const job of outcome.jobs) results.push(job);
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
  const priorityCounts = {
    faang: sortedResults.filter(job => job.priorityTier === 'faang').length,
    cac40: sortedResults.filter(job => job.priorityTier === 'cac40').length,
  };
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

  const tableRow = r => `| ${r.company} | ${r.title} | ${r.priorityTier || 'standard'} | ${r.country ?? '-'} | ${r.location} | ${r.daysAgo ?? '-'} | ${r.source} | [Apply](${r.url}) |`;
  const rows = sortedResults
    .map(tableRow)
    .join('\n');
  const rowsOrPlaceholder = rows || '| - | - | - | - | - | - | - | - |';

  const sourceRelPath = path.relative(root, sourcePath);
  const md = `# EU New Grad Roles (auto-generated)\n\n- Updated: ${payload.generatedAt}\n- Countries: ${TARGET_COUNTRY_LINE}\n- Filters: entry-level + technical roles only, posted in last ${MAX_DAYS} days (or unknown date)\n- Priority: FAANG first, then CAC40\n- Source: ${sourceRelPath}\n\n| Company | Role | Tier | Country | Location | Posted | Source | Link |\n|---|---|---|---|---|---|---|---|\n${rowsOrPlaceholder}\n`;
  await writeFile(outReadmePath, md);

  const seenState = await readJsonIfExists(outSeenPath);
  const seenKeys = Array.isArray(seenState?.seenKeys) ? seenState.seenKeys : null;
  let newJobs = [];
  let alertsSuppressedForMigration = false;

  if (seenKeys == null) {
    await writeFile(outSeenPath, JSON.stringify({ seenKeys: currentKeys }, null, 2) + "\n");
    console.log(`Bootstrapped seen state with ${currentKeys.length} jobs (no notifications sent).`);
  } else {
    const seenSet = new Set(seenKeys);
    newJobs = sortedResults.filter(job => !seenSet.has(jobKey(job)));

    alertsSuppressedForMigration = newJobs.length >= MIGRATION_ALERT_SUPPRESS_THRESHOLD;

    if (newJobs.length > 0 && !alertsSuppressedForMigration) {
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
    } else if (alertsSuppressedForMigration) {
      console.log(
        `Suppressed bulk notification during migration (${newJobs.length} new jobs >= ${MIGRATION_ALERT_SUPPRESS_THRESHOLD}).`
      );
    }

    const mergedKeys = [...new Set([...seenKeys, ...currentKeys])].sort();
    if (!sameKeySet(mergedKeys, [...seenKeys].sort())) {
      await writeFile(outSeenPath, JSON.stringify({ seenKeys: mergedKeys }, null, 2) + "\n");
    }
  }

  console.log(`Companies fetched: ${companiesFetched}, failures: ${fetchFailures}`);
  if (healthFilteredOut > 0) {
    console.log(`Skipped ${healthFilteredOut} portal(s) based on portal health status.`);
  }
  if (failureDetails.length > 0) {
    const maxLoggedFailures = 25;
    for (const failure of failureDetails.slice(0, maxLoggedFailures)) {
      console.error(
        `Fetcher failed for ${failure.company} (${failure.type}:${failure.slug}): ${failure.error}`
      );
    }
    if (failureDetails.length > maxLoggedFailures) {
      console.error(`...and ${failureDetails.length - maxLoggedFailures} more fetch failures.`);
    }
  }
  console.log(`Jobs (target countries + entry-level technical): ${beforeFilter} total, ${sortedResults.length} in last ${MAX_DAYS} days`);
  console.log(`Priority matches: FAANG=${priorityCounts.faang}, CAC40=${priorityCounts.cac40}`);
  console.log(`Result set changed: ${hasResultSetChanged ? 'yes' : 'no'}, new jobs: ${newJobs.length}`);
  if (alertsSuppressedForMigration) {
    console.log('Telegram alert suppressed for migration safety; seen state still updated.');
  }

  if (usedExample && !existsSync(companiesActivePath) && !existsSync(companiesLegacyPath)) {
    console.log('\nNo data/companies.json found. Using example list.');
    console.log('Generate data/companies_active.json from data/portal_classification.json with `npm run build-companies`.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
