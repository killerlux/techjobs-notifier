#!/usr/bin/env node
import { fetchAmazonLondonNewGrad, fetchMicrosoftLondonNewGrad } from './connectors.mjs';

async function main() {
  const out = [];
  try {
    const amazon = await fetchAmazonLondonNewGrad();
    out.push({ portal: 'amazon.jobs', count: amazon.length, sample: amazon.slice(0, 3) });
  } catch (e) {
    out.push({ portal: 'amazon.jobs', error: e.message });
  }
  try {
    const ms = await fetchMicrosoftLondonNewGrad();
    out.push({ portal: 'careers.microsoft.com', count: ms.length, sample: ms.slice(0, 3) });
  } catch (e) {
    out.push({ portal: 'careers.microsoft.com', error: e.message });
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });

