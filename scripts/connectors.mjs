#!/usr/bin/env node
export async function fetchAmazonLondonNewGrad() {
  const base = 'https://www.amazon.jobs/en/search.json';
  const params = new URLSearchParams({
    offset: '0',
    result_limit: '200',
    sort: 'recent',
  });
  params.append('normalized_country_code[]', 'GBR');
  params.append('city[]', 'London');

  const url = `${base}?${params.toString()}`;
  const res = await fetch(url, { headers: { 'user-agent': 'tracker-eu/1.0' } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const data = await res.json();
  const jobs = (data.jobs || []).map(j => ({
    id: String(j.id || j.job_id || ''),
    title: j.title || '',
    location: [j.city, j.state, j.country_code].filter(Boolean).join(', '),
    url: j.job_path ? `https://www.amazon.jobs${j.job_path}` : (j.job_url || ''),
    description: '',
    company: 'Amazon',
    source: 'amazon.jobs',
    postedAt: j.posted_date || j.updated_time || null
  }));
  const NEW_GRAD = ['new grad', 'graduate', 'entry level', 'early career', 'university'];
  return jobs.filter(j => NEW_GRAD.some(k => (j.title || '').toLowerCase().includes(k)));
}

export async function fetchMicrosoftLondonNewGrad() {
  const url = 'https://gcsservices.careers.microsoft.com/search/api/v1/search';
  const payload = {
    page: 1,
    pageSize: 50,
    keywords: 'graduate OR new grad OR entry level',
    location: 'London',
    lang: 'en_us'
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'origin': 'https://careers.microsoft.com',
      'referer': 'https://careers.microsoft.com/',
      'user-agent': 'tracker-eu/1.0'
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const data = await res.json();
  const results = data?.searchResults || data?.value || data?.jobs || [];
  return results.map(r => ({
    id: String(r.jobId || r.id || ''),
    title: r.title || r.jobTitle || '',
    location: r.location || r.formattedLocation || '',
    url: r.jobUrl || r.url || '',
    description: '',
    company: 'Microsoft',
    source: 'careers.microsoft.com',
    postedAt: r.postedDate || r.lastModified || null
  }));
}

