#!/usr/bin/env node
/**
 * check-links.js
 *
 * Crawls the LIVE deployed site (no local build needed) starting from the
 * homepage, follows every internal link it finds, and checks:
 *   1. Every internal page/asset returns a working status code.
 *   2. Every external link (other domains) returns a working status code.
 *   3. Same-page "#anchor" links (e.g. table-of-contents links) actually
 *      point to an element that exists on that page.
 *
 * Usage:
 *   node scripts/check-links.js
 *   node scripts/check-links.js https://blog.ultimateedge.info
 *   SITE_URL=https://blog.ultimateedge.info node scripts/check-links.js
 *
 * Exit code is 1 if any broken links were found (so CI can flag it), 0 if clean.
 */

const BASE_URL = (process.argv[2] || process.env.SITE_URL || 'https://blog.ultimateedge.info').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = 15000;
const EXTERNAL_CONCURRENCY = 5;
const ASSET_EXTENSIONS = /\.(jpg|jpeg|png|gif|svg|webp|ico|css|js|xml|json|txt|pdf|woff2?|ttf)$/i;
const SKIP_SCHEMES = /^(mailto:|tel:|sms:|javascript:)/i;

const origin = new URL(BASE_URL).origin;

// GitHub Actions sets this automatically as "owner/repo" â€” no config needed
// when running in CI. Locally it'll just be undefined and we skip edit links.
const GITHUB_REPO = process.env.GITHUB_REPOSITORY || null;
const DEFAULT_BRANCH = process.env.GITHUB_DEFAULT_BRANCH || 'main';

/**
 * Maps a live site path (e.g. "/posts/waec-result-checker-guide/") back to
 * the actual source file in this repo, so a broken link in the report can
 * be jumped to directly instead of hunting for it.
 */
function pathToSourceFile(sitePath) {
  const p = sitePath.replace(/\/$/, '') || '/';
  if (p === '/') return 'src/pages/index.astro';

  const staticPages = {
    '/about': 'src/pages/about.md',
    '/contact': 'src/pages/contact.md',
    '/privacy-policy': 'src/pages/privacy-policy.md',
    '/terms-of-service': 'src/pages/terms-of-service.md',
  };
  if (staticPages[p]) return staticPages[p];

  let m = p.match(/^\/posts\/([^/]+)$/);
  if (m) return `src/pages/posts/${m[1]}.md`;

  m = p.match(/^\/tools\/([^/]+)$/);
  if (m) return `src/pages/tools/${m[1]}.astro`;

  return null; // unknown pattern (e.g. a generated/dynamic route) â€” no direct mapping
}

function editUrl(sourceFile) {
  if (!sourceFile || !GITHUB_REPO) return null;
  return `https://github.com/${GITHUB_REPO}/edit/${DEFAULT_BRANCH}/${sourceFile}`;
}

/** Turns a full page URL into a short annotated string with file + edit link. */
function describeReferrer(fullUrl) {
  let sitePath;
  try {
    sitePath = normalizePath(new URL(fullUrl).pathname);
  } catch {
    return fullUrl;
  }
  const sourceFile = pathToSourceFile(sitePath);
  if (!sourceFile) return fullUrl;

  const edit = editUrl(sourceFile);
  return edit
    ? `${fullUrl}\n     source file: ${sourceFile}\n     edit directly: ${edit}`
    : `${fullUrl}\n     source file: ${sourceFile}`;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal, redirect: 'follow' });
    return { ok: true, status: res.status, res };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'Timeout' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

function extractHrefs(html) {
  const hrefs = [];
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) hrefs.push(m[1]);
  return hrefs;
}

function extractIds(html) {
  const ids = new Set();
  const re = /\bid\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) ids.add(m[1]);
  return ids;
}

function normalizePath(pathname) {
  if (pathname === '') return '/';
  return pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
}

async function crawlInternal() {
  const toVisit = [normalizePath(new URL(BASE_URL).pathname || '/')];
  const visited = new Set();
  const pageIds = new Map();       // normalized path -> Set of element ids on that page
  const brokenInternal = [];       // { page, link, reason }
  const externalLinks = new Map(); // external URL -> Set of referrer pages
  const sameOriginAnchorRefs = []; // { page, targetPath, hash }

  while (toVisit.length > 0) {
    const pathToFetch = toVisit.shift();
    if (visited.has(pathToFetch)) continue;
    visited.add(pathToFetch);

    const fullUrl = origin + pathToFetch;
    const result = await fetchWithTimeout(fullUrl);

    if (!result.ok || result.status >= 400) {
      brokenInternal.push({
        page: '(discovered link)',
        link: fullUrl,
        reason: result.ok ? `HTTP ${result.status}` : result.error,
      });
      continue;
    }

    const contentType = result.res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) continue; // don't parse non-HTML for links

    const html = await result.res.text();
    pageIds.set(pathToFetch, extractIds(html));

    const hrefs = extractHrefs(html);
    for (const raw of hrefs) {
      if (SKIP_SCHEMES.test(raw)) continue;

      // Same-page anchor: "#faq"
      if (raw.startsWith('#')) {
        sameOriginAnchorRefs.push({ page: fullUrl, targetPath: pathToFetch, hash: raw.slice(1) });
        continue;
      }

      let resolved;
      try {
        resolved = new URL(raw, fullUrl);
      } catch {
        brokenInternal.push({ page: fullUrl, link: raw, reason: 'Unparseable URL' });
        continue;
      }

      if (resolved.origin === origin) {
        const p = normalizePath(resolved.pathname);
        if (resolved.hash) {
          sameOriginAnchorRefs.push({ page: fullUrl, targetPath: p, hash: resolved.hash.slice(1) });
        }
        if (!visited.has(p) && !toVisit.includes(p) && !ASSET_EXTENSIONS.test(p)) {
          toVisit.push(p);
        } else if (ASSET_EXTENSIONS.test(p) && !visited.has(p)) {
          // Check asset existence without crawling it for further links
          visited.add(p);
          const assetResult = await fetchWithTimeout(origin + p, { method: 'HEAD' });
          if (!assetResult.ok || assetResult.status >= 400) {
            brokenInternal.push({
              page: fullUrl,
              link: origin + p,
              reason: assetResult.ok ? `HTTP ${assetResult.status}` : assetResult.error,
            });
          }
        }
      } else {
        if (!externalLinks.has(resolved.href)) externalLinks.set(resolved.href, new Set());
        externalLinks.get(resolved.href).add(fullUrl);
      }
    }
  }

  // Validate same-page/cross-page anchor targets against collected id sets
  const brokenAnchors = [];
  for (const { page, targetPath, hash } of sameOriginAnchorRefs) {
    const ids = pageIds.get(targetPath);
    if (ids && !ids.has(hash)) {
      brokenAnchors.push({ page, link: `${targetPath}#${hash}`, reason: `No element with id="${hash}" found on target page` });
    }
    // If the target page itself was broken/uncrawled, that's already reported above.
  }

  return { brokenInternal, brokenAnchors, externalLinks, pagesCrawled: visited.size };
}

async function checkExternalLinks(externalLinks) {
  const entries = [...externalLinks.entries()];
  const broken = [];
  let index = 0;

  async function worker() {
    while (index < entries.length) {
      const i = index++;
      const [url, referrers] = entries[i];
      let result = await fetchWithTimeout(url, { method: 'HEAD' });
      if (!result.ok || result.status >= 400) {
        // Some servers reject HEAD; retry with GET before declaring broken
        result = await fetchWithTimeout(url, { method: 'GET' });
      }
      if (!result.ok || result.status >= 400) {
        broken.push({
          link: url,
          referrers: [...referrers],
          reason: result.ok ? `HTTP ${result.status}` : result.error,
        });
      }
    }
  }

  await Promise.all(Array.from({ length: EXTERNAL_CONCURRENCY }, worker));
  return broken;
}

function printReport({ brokenInternal, brokenAnchors, brokenExternal, pagesCrawled, externalCount }) {
  console.log(`\nðŸ”— Link check for ${BASE_URL}`);
  console.log(`   Internal pages crawled: ${pagesCrawled}`);
  console.log(`   Unique external links checked: ${externalCount}\n`);

  if (brokenInternal.length === 0 && brokenAnchors.length === 0 && brokenExternal.length === 0) {
    console.log('âœ… No broken links found.\n');
    return;
  }

  if (brokenInternal.length > 0) {
    console.log(`âŒ Broken internal links/assets (${brokenInternal.length}):`);
    for (const b of brokenInternal) {
      console.log(`   - ${b.link}`);
      console.log(`     found on: ${describeReferrer(b.page)}  |  reason: ${b.reason}`);
    }
    console.log('');
  }

  if (brokenAnchors.length > 0) {
    console.log(`âš ï¸  Broken anchor links (${brokenAnchors.length}):`);
    for (const b of brokenAnchors) {
      console.log(`   - ${b.link}`);
      console.log(`     linked from: ${describeReferrer(b.page)}  |  reason: ${b.reason}`);
    }
    console.log('');
  }

  if (brokenExternal.length > 0) {
    console.log(`âŒ Broken external links (${brokenExternal.length}):`);
    for (const b of brokenExternal) {
      console.log(`   - ${b.link}  (reason: ${b.reason})`);
      for (const ref of b.referrers) {
        console.log(`     linked from: ${describeReferrer(ref)}`);
      }
    }
    console.log('');
    console.log('   Note: some sites (LinkedIn, Instagram, etc.) block automated HEAD/GET');
    console.log('   requests and may show as broken here even though they work in a browser.');
    console.log('   Spot-check anything unfamiliar before treating it as truly dead.\n');
  }
}

async function main() {
  console.log(`Crawling ${BASE_URL} ...`);
  const { brokenInternal, brokenAnchors, externalLinks, pagesCrawled } = await crawlInternal();
  console.log(`Checking ${externalLinks.size} unique external links ...`);
  const brokenExternal = await checkExternalLinks(externalLinks);

  printReport({
    brokenInternal,
    brokenAnchors,
    brokenExternal,
    pagesCrawled,
    externalCount: externalLinks.size,
  });

  const hasBroken = brokenInternal.length > 0 || brokenAnchors.length > 0 || brokenExternal.length > 0;
  process.exit(hasBroken ? 1 : 0);
}

main().catch((err) => {
  console.error('Link checker crashed:', err);
  process.exit(1);
});
