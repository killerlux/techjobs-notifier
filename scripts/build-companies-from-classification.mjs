#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dataDir = path.join(root, 'data');
const classificationPath = path.join(dataDir, 'portal_classification.json');
const allOutPath = path.join(dataDir, 'companies_all.json');
const activeOutPath = path.join(dataDir, 'companies_active.json');
const legacyOutPath = path.join(dataDir, 'companies.json');

const ACTIVE_TYPES = new Set(['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters']);

function normalize(value) {
  return String(value || '').trim();
}

function toLower(value) {
  return normalize(value).toLowerCase();
}

function keyFor(row) {
  const type = toLower(row.platform);
  const slug = toLower(row.slug);
  const host = toLower(row.host);
  const identity = slug || host;
  if (!type || !identity) return null;
  return `${type}::${identity}`;
}

function toEntry(row) {
  const type = toLower(row.platform);
  const slug = toLower(row.slug);
  const host = toLower(row.host);
  const company = normalize(row.company);
  const name = company || slug || host;

  const ats = { type };
  if (slug) {
    ats.slug = slug;
  } else {
    ats.host = host;
  }

  return {
    name,
    ats,
  };
}

function sortCompanies(companies) {
  return [...companies].sort((a, b) => {
    const leftType = a.ats?.type || '';
    const rightType = b.ats?.type || '';
    return leftType.localeCompare(rightType)
      || a.name.localeCompare(b.name)
      || (a.ats.slug || a.ats.host || '').localeCompare(b.ats.slug || b.ats.host || '');
  });
}

function isActive(entry) {
  const type = entry?.ats?.type;
  if (!ACTIVE_TYPES.has(type)) return false;
  if (!entry?.ats?.slug) return false;
  return true;
}

async function main() {
  const raw = await readFile(classificationPath, 'utf8');
  const rows = JSON.parse(raw);

  const unique = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    if (!key || unique.has(key)) continue;
    unique.set(key, toEntry(row));
  }

  const allCompanies = sortCompanies(Array.from(unique.values()));
  const activeCompanies = sortCompanies(allCompanies.filter(isActive));

  await writeFile(allOutPath, JSON.stringify(allCompanies, null, 2) + '\n');
  await writeFile(activeOutPath, JSON.stringify(activeCompanies, null, 2) + '\n');
  await writeFile(legacyOutPath, JSON.stringify(activeCompanies, null, 2) + '\n');

  console.log(`Classified rows: ${rows.length}`);
  console.log(`Unique portals written: ${allCompanies.length} -> data/companies_all.json`);
  console.log(`Active supported portals written: ${activeCompanies.length} -> data/companies_active.json`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
