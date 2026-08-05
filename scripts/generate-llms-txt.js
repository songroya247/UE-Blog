const fs = require('fs');
const path = require('path');

// Auto-populates public/llms.txt from the frontmatter of every published
// post in src/pages/posts/ plus the top-level static pages (about, contact).
// Runs on every build (chained after publish-queue.js in prebuild) so the
// file always reflects whatever is actually live — no manual upkeep.

const POSTS_DIR = path.join(__dirname, '..', 'src', 'pages', 'posts');
const STATIC_PAGES = [
  { file: path.join(__dirname, '..', 'src', 'pages', 'about.md'), slug: 'about' },
  { file: path.join(__dirname, '..', 'src', 'pages', 'contact.md'), slug: 'contact' },
];
const OUTPUT_FILE = path.join(__dirname, '..', 'public', 'llms.txt');
const SITE_BASE = 'https://blog.ultimateedge.info';

const SITE_TITLE = 'Ultimate Edge Blog';
const SITE_SUMMARY =
  'Practical, fact-checked guides on JAMB, WAEC, NECO, Post-UTME, and Nigerian university admissions — covering JAMB CAPS mechanics, result checking, aggregate score calculation, cut-off marks, and alternative admission pathways.';

const MAX_DESC_LENGTH = 180;

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const block = match[1];
  const get = (field) => {
    const m = block.match(new RegExp(`^${field}:\\s*"(.*?)"\\s*$`, 'm'));
    return m ? m[1].trim() : null;
  };
  return {
    title: get('title'),
    category: get('category'),
    description: get('description'),
    date: get('date'),
  };
}

function cleanDescription(desc) {
  if (!desc) return '';
  let text = desc.trim();
  if (text.length > MAX_DESC_LENGTH) {
    text = text.slice(0, MAX_DESC_LENGTH);
    const lastSpace = text.lastIndexOf(' ');
    if (lastSpace > 0) text = text.slice(0, lastSpace);
    text += '...';
  }
  return text;
}

function loadEntries() {
  const entries = [];

  if (fs.existsSync(POSTS_DIR)) {
    const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md'));
    for (const filename of files) {
      const slug = filename.replace(/\.md$/, '');
      const content = fs.readFileSync(path.join(POSTS_DIR, filename), 'utf-8');
      const fm = parseFrontmatter(content);
      if (!fm.title) continue; // skip anything malformed rather than crash the build
      entries.push({
        slug,
        title: fm.title,
        category: fm.category || 'Uncategorized',
        description: cleanDescription(fm.description),
        date: fm.date || null,
        url: `${SITE_BASE}/posts/${slug}`,
      });
    }
  }

  for (const { file, slug } of STATIC_PAGES) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf-8');
    const fm = parseFrontmatter(content);
    if (!fm.title) continue;
    entries.push({
      slug,
      title: fm.title,
      category: fm.category || 'Site Information',
      description: cleanDescription(fm.description),
      date: fm.date || null,
      url: `${SITE_BASE}/${slug}`,
    });
  }

  return entries;
}

function groupByCategory(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.category)) groups.set(entry.category, []);
    groups.get(entry.category).push(entry);
  }
  // Push "Site Information" to the end, keep everything else in first-seen order
  const categories = [...groups.keys()];
  categories.sort((a, b) => {
    if (a === 'Site Information') return 1;
    if (b === 'Site Information') return -1;
    return 0;
  });
  return categories.map((cat) => ({ category: cat, posts: groups.get(cat) }));
}

function buildLlmsTxt(groupedEntries) {
  let out = `# ${SITE_TITLE}\n\n> ${SITE_SUMMARY}\n\n`;

  for (const { category, posts } of groupedEntries) {
    out += `## ${category}\n\n`;
    // Newest first within each category
    posts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    for (const post of posts) {
      const desc = post.description ? `: ${post.description}` : '';
      out += `- [${post.title}](${post.url})${desc}\n`;
    }
    out += '\n';
  }

  return out.trimEnd() + '\n';
}

function main() {
  const entries = loadEntries();
  if (entries.length === 0) {
    console.log('[llms.txt] No published posts found — skipping generation.');
    return;
  }
  const grouped = groupByCategory(entries);
  const content = buildLlmsTxt(grouped);
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, content, 'utf-8');
  console.log(`[llms.txt] Generated with ${entries.length} entries across ${grouped.length} categories.`);
}

main();
