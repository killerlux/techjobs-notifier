#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dataDir = path.join(root, 'data');
const companiesPath = path.join(dataDir, 'companies.json');
const outPath = path.join(dataDir, 'portal_health.json');

const FETCH_TIMEOUT_MS = 12000;
const URL_TIMEOUT_MS = 10000;
const MAX_URL_CHECKS_PER_COMPANY = 2;
const CONCURRENCY = 8;

const USER_AGENT = 'tracker-eu-portal-health/1.0';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${url} -> ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGreenhouse(slug) {
  const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
  return (data.jobs || []).map(job => ({
    id: String(job.id),
    title: job.title || '',
    url: job.absolute_url || '',
  }));
}

async function fetchLever(slug) {
  const data = await fetchJson(`https://api.lever.co/v0/postings/${slug}?mode=json`);
  return data.map(job => ({
    id: job.id || job._id || '',
    title: job.text || job.title || '',
    url: job.hostedUrl || job.applyUrl || '',
  }));
}

async function fetchAshby(slug) {
  const data = await fetchJson(`https://jobs.ashbyhq.com/api/external/jobs?organizationSlug=${slug}`);
  return (data.jobs || []).map(job => ({
    id: job.id || job.jobId || '',
    title: job.title || '',
    url: job.jobUrl || job.applyUrl || '',
  }));
}

async function fetchWorkable(slug) {
  const data = await fetchJson(`https://apply.workable.com/api/v3/accounts/${slug}/jobs?limit=200`);
  return (data.results || []).map(job => ({
    id: job.id || job.shortcode || '',
    title: job.title || '',
    url: job.shortcode ? `https://apply.workable.com/${slug}/j/${job.shortcode}/` : '',
  }));
}

async function fetchSmartRecruiters(slug) {
  const data = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=200`);
  const items = data?.content || data?.results || data?.data || [];
  return items.map(job => ({
    id: job.id || job.uuid || '',
    title: job.name || job.title || '',
    url: job.applyUrl || job.ref || (job.id ? `https://jobs.smartrecruiters.com/${slug}/${job.id}` : ''),
  }));
}

const fetchers = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
  workable: fetchWorkable,
  smartrecruiters: fetchSmartRecruiters,
};

function normalizeStatusCode(status) {
  return status >= 200 && status < 400;
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        ...(init?.headers || {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function checkUrl(url) {
  if (!url) {
    return { ok: false, status: null, method: null, error: 'missing_url' };
  }

  try {
    const head = await fetchWithTimeout(url, { method: 'HEAD' }, URL_TIMEOUT_MS);
    if (normalizeStatusCode(head.status) || head.status === 401 || head.status === 403) {
      return { ok: true, status: head.status, method: 'HEAD' };
    }
    if (head.status !== 405 && head.status !== 501) {
      return { ok: false, status: head.status, method: 'HEAD', error: 'bad_status' };
    }
  } catch {
    // Fall back to GET when HEAD is blocked or unsupported.
  }

  try {
    const get = await fetchWithTimeout(url, { method: 'GET' }, URL_TIMEOUT_MS);
    if (normalizeStatusCode(get.status) || get.status === 401 || get.status === 403) {
      return { ok: true, status: get.status, method: 'GET' };
    }
    return { ok: false, status: get.status, method: 'GET', error: 'bad_status' };
  } catch (error) {
    return { ok: false, status: null, method: 'GET', error: error.message };
  }
}

function uniqueUrls(jobs) {
  const seen = new Set();
  const urls = [];
  for (const job of jobs) {
    const url = String(job.url || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

async function checkCompany(company) {
  const type = company?.ats?.type;
  const slug = company?.ats?.slug;
  const fetcher = fetchers[type];

  if (!fetcher) {
    return {
      company: company?.name || 'unknown',
      type,
      slug: slug || null,
      status: 'unsupported',
      jobsCount: 0,
      checkedUrls: [],
    };
  }

  if (!slug) {
    return {
      company: company?.name || 'unknown',
      type,
      slug: null,
      status: 'misconfigured',
      jobsCount: 0,
      checkedUrls: [],
      error: 'missing_slug',
    };
  }

  try {
    const jobs = await fetcher(slug);
    const sampleUrls = uniqueUrls(jobs).slice(0, MAX_URL_CHECKS_PER_COMPANY);
    const checkedUrls = [];
    for (const url of sampleUrls) {
      checkedUrls.push({ url, ...(await checkUrl(url)) });
      await sleep(100);
    }
    const badLinks = checkedUrls.filter(item => !item.ok).length;

    let status = 'healthy';
    if (jobs.length === 0) {
      status = 'empty';
    } else if (badLinks > 0) {
      status = 'degraded';
    }

    return {
      company: company.name,
      type,
      slug,
      status,
      jobsCount: jobs.length,
      badLinks,
      checkedUrls,
    };
  } catch (error) {
    return {
      company: company.name,
      type,
      slug,
      status: 'fetch_error',
      jobsCount: 0,
      checkedUrls: [],
      error: error.message,
    };
  }
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

  const workers = [];
  const workerCount = Math.min(concurrency, items.length);
  for (let i = 0; i < workerCount; i += 1) {
    workers.push(runner());
  }
  await Promise.all(workers);
  return results;
}

function summarize(results) {
  const summary = {
    total: results.length,
    healthy: 0,
    degraded: 0,
    empty: 0,
    fetch_error: 0,
    unsupported: 0,
    misconfigured: 0,
  };

  for (const row of results) {
    if (summary[row.status] !== undefined) {
      summary[row.status] += 1;
    }
  }
  return summary;
}

function sortBySeverity(results) {
  const severity = {
    fetch_error: 0,
    degraded: 1,
    misconfigured: 2,
    empty: 3,
    healthy: 4,
    unsupported: 5,
  };
  return [...results].sort((a, b) => {
    const left = severity[a.status] ?? 99;
    const right = severity[b.status] ?? 99;
    return left - right || a.company.localeCompare(b.company);
  });
}

async function main() {
  const companies = JSON.parse(await readFile(companiesPath, 'utf8'));
  const checks = await runPool(companies, checkCompany, CONCURRENCY);
  const sorted = sortBySeverity(checks);
  const summary = summarize(sorted);

  const payload = {
    generatedAt: new Date().toISOString(),
    summary,
    results: sorted,
  };

  await mkdir(dataDir, { recursive: true });
  await writeFile(outPath, JSON.stringify(payload, null, 2) + '\n');

  console.log('Portal health summary:');
  for (const [key, value] of Object.entries(summary)) {
    console.log(`- ${key}: ${value}`);
  }

  const noisy = sorted.filter(item => ['fetch_error', 'degraded', 'misconfigured'].includes(item.status));
  if (noisy.length) {
    console.log('\nTop issues:');
    for (const item of noisy.slice(0, 15)) {
      const reason = item.error ? ` (${item.error})` : '';
      console.log(`- ${item.company} [${item.type}:${item.slug}] -> ${item.status}${reason}`);
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
