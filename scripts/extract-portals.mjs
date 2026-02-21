#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const sourceReadme = path.join(root, 'New-Grad-Positions', 'README.md');
const outDir = path.join(root, 'data');
const outFile = path.join(outDir, 'companies.json');

function uniq(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const k = keyFn(item);
    if (!seen.has(k)) { seen.add(k); out.push(item); }
  }
  return out;
}

function cleanSlug(s) {
  return s.replace(/\/$/, '').toLowerCase();
}

function providerFromUrl(href) {
  try {
    const u = new URL(href);
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.split('/').filter(Boolean);
    // Greenhouse
    if (host.endsWith('greenhouse.io')) {
      // boards.greenhouse.io/<slug>/...
      // job-boards.greenhouse.io/<slug>/...
      const slug = parts[0];
      if (slug && slug !== 'embed') {
        return { type: 'greenhouse', slug: cleanSlug(slug), href };
      }
      return null; // can't infer slug from embed token
    }
    // Lever
    if (host === 'jobs.lever.co') {
      const slug = parts[0];
      if (slug) return { type: 'lever', slug: cleanSlug(slug), href };
    }
    // Ashby
    if (host === 'jobs.ashbyhq.com') {
      const slug = parts[0];
      if (slug) return { type: 'ashby', slug: cleanSlug(slug), href };
    }
    // Workable
    if (host === 'apply.workable.com') {
      const slug = parts[0];
      if (slug) return { type: 'workable', slug: cleanSlug(slug), href };
    }
    // SmartRecruiters
    if (host === 'jobs.smartrecruiters.com') {
      const slug = parts[0];
      if (slug) return { type: 'smartrecruiters', slug: cleanSlug(slug), href };
    }
    // Workday
    if (host.includes('myworkdayjobs.com')) {
      const sub = host.split('.')[0];
      return { type: 'workday', host: host, tenant: sub, href };
    }
    // Eightfold
    if (host.endsWith('eightfold.ai')) {
      return { type: 'eightfold', host: host, href };
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  const md = await readFile(sourceReadme, 'utf8');
  // Extract all href URLs
  const hrefMatches = [...md.matchAll(/href=\"([^\"]+)\"/g)].map(m => m[1]);
  // Also include markdown link style [..](..)
  const mdLinks = [...md.matchAll(/\]\((https?:[^\)\s]+)\)/g)].map(m => m[1]);
  const urls = Array.from(new Set([...hrefMatches, ...mdLinks]));

  const providers = urls
    .map(providerFromUrl)
    .filter(Boolean);

  const mapped = providers.map(p => {
    if (p.type === 'workday') {
      return { name: p.tenant, ats: { type: p.type, host: p.host } };
    }
    if (p.type === 'eightfold') {
      return { name: p.host.split('.')[0], ats: { type: p.type, host: p.host } };
    }
    return { name: p.slug, ats: { type: p.type, slug: p.slug } };
  });

  const unique = uniq(mapped, x => JSON.stringify(x.ats));
  unique.sort((a, b) => a.name.localeCompare(b.name));

  await mkdir(outDir, { recursive: true });
  await writeFile(outFile, JSON.stringify(unique, null, 2) + '\n');
  console.log(`Extracted ${unique.length} company portals to ${path.relative(root, outFile)}`);
}

main().catch(err => { console.error(err); process.exit(1); });

