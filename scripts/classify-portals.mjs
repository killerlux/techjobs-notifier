#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const listingsPath = path.join(process.cwd(), 'New-Grad-Positions', '.github', 'scripts', 'listings.json');
const outDir = path.join(process.cwd(), 'data');
const outPath = path.join(outDir, 'portal_classification.json');

function classify(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const pathParts = u.pathname.split('/').filter(Boolean);

    const response = { platform: 'unknown', slug: null, host, notes: null };

    const pick = (platform, slug = null, notes = null) => ({ platform, slug, host, notes });

    if (host.includes('greenhouse.io')) {
      if (pathParts[0] && pathParts[0] !== 'embed') {
        return pick('greenhouse', pathParts[0]);
      }
      return pick('greenhouse', null, 'embed token only');
    }
    if (host === 'jobs.lever.co') {
      return pick('lever', pathParts[0] || null);
    }
    if (host === 'jobs.ashbyhq.com') {
      return pick('ashby', pathParts[0] || null);
    }
    if (host === 'apply.workable.com') {
      return pick('workable', pathParts[0] || null);
    }
    if (host === 'jobs.smartrecruiters.com') {
      return pick('smartrecruiters', pathParts[0] || null);
    }
    if (host.endsWith('.myworkdayjobs.com')) {
      return pick('workday', host.split('.')[0]);
    }
    if (host.endsWith('eightfold.ai')) {
      return pick('eightfold', host.split('.')[0]);
    }
    if (host.includes('taleo.net')) {
      return pick('taleo', host.split('.')[0]);
    }
    if (host.includes('icims.com')) {
      return pick('icims', host.split('.')[0]);
    }
    if (host.includes('oraclecloud.com')) {
      return pick('oraclecloud', host.split('.')[0]);
    }
    if (host.includes('successfactors.com')) {
      return pick('successfactors', host.split('.')[0]);
    }
    if (host.includes('indeed.com')) {
      return pick('indeed');
    }
    if (host === 'www.amazon.jobs' || host === 'amazon.jobs') {
      return pick('amazon.jobs');
    }
    if (host.includes('microsoft.com') && u.pathname.includes('/careers')) {
      return pick('microsoft-careers');
    }
    if (host.includes('google.com') && u.pathname.includes('/careers')) {
      return pick('google-careers');
    }
    if (host.includes('myworkday.com')) {
      return pick('workday');
    }
    if (host.includes('careerbuilder.com')) {
      return pick('careerbuilder');
    }
    if (host.includes('myworkdayjobs.eu')) {
      return pick('workday');
    }
    return response;
  } catch (e) {
    return { platform: 'invalid', slug: null, host: null, notes: e.message };
  }
}

async function main() {
  const listings = JSON.parse(await readFile(listingsPath, 'utf8'));
  const seen = new Map();

  for (const item of listings) {
    const url = item.url;
    if (!url || seen.has(url)) continue;
    const info = classify(url);
    seen.set(url, {
      company: item.company_name,
      url,
      platform: info.platform,
      slug: info.slug,
      host: info.host,
      notes: info.notes
    });
  }

  const rows = Array.from(seen.values());
  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, JSON.stringify(rows, null, 2) + '\n');

  const summary = rows.reduce((acc, row) => {
    acc[row.platform] = (acc[row.platform] || 0) + 1;
    return acc;
  }, {});

  console.log('Classified portals:', rows.length);
  const sorted = Object.entries(summary).sort((a, b) => b[1] - a[1]);
  for (const [platform, count] of sorted) {
    console.log(`${platform}: ${count}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
