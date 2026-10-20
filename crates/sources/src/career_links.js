// Job links of a rendered career page (successor of the Python playwright_scraper DOM heuristics).
// A job link is recognized by its URL: a job-ish path segment plus an id (4+ digits) or a long slug, or a link
// to a known ATS. Returns {links: [{title, url, location}], next: listing-page URL or null, url: final URL}.
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 60 && document.readyState !== 'complete'; i++) await sleep(250);

  const JOBISH = /(^|[\/_-])(jobs?|vagas?|oportunidades?|careers?|positions?|openings?|details?|jobdetail|requisitions?|postings?|opportunit(y|ies))([\/_?=-]|$)/i;
  const ID = /\d{4,}|[a-z0-9]+(-[a-z0-9]+){3,}/i;
  const ATS = /(greenhouse\.io|lever\.co|jobs2web\.com|empregare\.com|myworkdayjobs\.com|successfactors\.com|icims\.com|gupy\.io|ashbyhq\.com|smartrecruiters\.com|eightfold\.ai)\//i;
  const SKIP = /^\s*(apply|candidatar|login|entrar|cadastr|criar conta|sign[- ]?in|home|início|about|sobre|contact|contato|privacy|cookies|terms|blog|news|press|instagram|linkedin|twitter|youtube|facebook|ver todas as vagas|ver mais|load more|saved jobs|vagas salvas)\s*$/i;
  // Call-to-action texts: the job title is in the surrounding card.
  const GENERIC = /^\s*(saiba mais|ver vaga|ver detalhes|ver mais( detalhes)?|mais detalhes|learn more|view (job|details|role)|see details|read more|apply now|candidate-se|detalhes|ver descrição completa do cargo|see full role description)\s*$/i;
  const LISTING = [/\/vagas-abertas/i, /\/todas-vagas/i, /\/open-positions$/i, /\/vagas$/i, /\/jobs$/i,
    /\/carreiras$/i, /\/careers$/i, /\/oportunidades$/i];
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const ok = t => t.length >= 6 && t.length <= 250;
  const isJob = a => {
    let u;
    try { u = new URL(a.href); } catch (e) { return false; }
    if (!/^https?:$/.test(u.protocol)) return false;
    if (u.origin === location.origin && u.pathname === location.pathname) return false;
    const rest = u.pathname + u.search;
    return ATS.test(u.host + u.pathname + '/') || (JOBISH.test(u.pathname) && ID.test(rest));
  };
  // The card around a link (never the link itself, whose class may say "job" too).
  const cardOf = el => el.parentElement && el.parentElement.closest('li, article, tr, [class*="card"], [class*="job"], [class*="item"], [class*="position"], [class*="vacancy"], [class*="vaga"]');
  // Heading text without a nested location badge ("VENDEDOR <span class=job-location>...").
  const text = el => {
    const c = el.cloneNode(true);
    c.querySelectorAll('[class*="location"]').forEach(x => x.remove());
    return clean(c.textContent);
  };
  const locationOf = a => {
    const c = cardOf(a) || a;
    const l = c.querySelector('[class*="location"], [class*="Location"]');
    const t = l ? clean(l.innerText) : '';
    return t.length <= 120 ? t : '';
  };
  const containerTitle = el => {
    const c = cardOf(el);
    if (!c) return '';
    const h = c.querySelector('h1,h2,h3,h4,h5,p[class*="title"],span[class*="title"],div[class*="title"],'
      + 'p[class*="name"],span[class*="name"],div[class*="name"],'
      + 'p[class*="position"],span[class*="position"],div[class*="position"]');
    return h ? text(h) : '';
  };
  const titleOf = a => {
    // A card-wide link: its heading is the title (innerText would add location, buttons...).
    const h = a.querySelector('h1,h2,h3,h4,h5,[class*="title"]');
    let t = h ? text(h) : clean(a.innerText);
    if (GENERIC.test(t)) t = '';
    if (!ok(t)) {
      const aria = clean(a.getAttribute('aria-label'));
      t = aria.length >= 6 && !GENERIC.test(aria) ? aria : clean(containerTitle(a));
    }
    t = t.replace(/^(learn more about|saiba mais sobre)\s+/i, '');
    return ok(t) && !SKIP.test(t) ? t : '';
  };
  const collect = () => {
    const byUrl = new Map();
    for (const a of document.querySelectorAll('a[href]')) {
      if (!isJob(a)) continue;
      const url = a.href.split('#')[0];
      const t = titleOf(a);
      if (!byUrl.has(url) || (!byUrl.get(url).title && t)) byUrl.set(url, { title: t, location: locationOf(a) });
    }
    return [...byUrl].map(([url, v]) => ({ url, ...v }));
  };
  // SPAs render after load: give them up to ~12 s to show titled job links.
  let links = [];
  for (let i = 0; i < 12; i++) {
    links = collect();
    if (links.some(l => l.title)) break;
    await sleep(1000);
  }
  let next = null;
  if (!links.length) {
    for (const a of document.querySelectorAll('a[href]')) {
      if (LISTING.some(p => p.test(a.getAttribute('href')))) { next = a.href; break; }
    }
  }
  return { links, next, url: location.href };
})()
