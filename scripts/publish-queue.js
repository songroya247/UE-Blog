const fs = require('fs');
const path = require('path');

const QUEUE_DIR = './content-queue';
const POSTS_DIR = './src/pages/posts';

// No schedule.json needed — this scans content-queue/ directly and reads
// the `date:` field in each file's own frontmatter. To schedule a post,
// just drop the finished .md file into content-queue/ with a real date
// (not "TBD"). This script is non-destructive: it copies due posts into
// POSTS_DIR on every build, but leaves the queue file in place so the
// daily GitHub Action (which does the real move + cleanup) stays the
// source of truth. It's a safety net so a build never misses a due post
// even if the cron job hasn't run yet.

if (!fs.existsSync(QUEUE_DIR)) {
  console.log('[Auto-Publish] No content-queue directory found.');
  process.exit(0);
}

if (!fs.existsSync(POSTS_DIR)) {
  fs.mkdirSync(POSTS_DIR, { recursive: true });
}

const today = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"
const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Priority for the published filename/slug: explicit `slug:` field in
// frontmatter > slugified `title:` field > the queue filename itself.
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function resolveSlug(content, filenameSlug) {
  const slugMatch = content.match(/^slug:\s*"(.*?)"\s*$/m);
  if (slugMatch && slugMatch[1].trim()) return slugify(slugMatch[1].trim());

  const titleMatch = content.match(/^title:\s*"(.*?)"\s*$/m);
  if (titleMatch && titleMatch[1].trim()) return slugify(titleMatch[1].trim());

  return filenameSlug;
}

console.log(`[Auto-Publish] Checking queue for articles scheduled on or before ${today}...`);

const files = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('.md'));

files.forEach(filename => {
  const filenameSlug = filename.replace(/\.md$/, '');
  const queueFilePath = path.join(QUEUE_DIR, filename);

  const content = fs.readFileSync(queueFilePath, 'utf-8');
  const match = content.match(/^date:\s*"(.*?)"\s*$/m);
  const scheduledDate = match ? match[1].trim() : null;

  if (!scheduledDate || !VALID_DATE.test(scheduledDate)) {
    return; // still "TBD" — not scheduled yet
  }

  const slug = resolveSlug(content, filenameSlug);
  const destFilePath = path.join(POSTS_DIR, `${slug}.md`);

  if (fs.existsSync(destFilePath)) return; // already published

  if (scheduledDate <= today) {
    // Ensure layout path is relative to src/pages/posts/
    const finalContent = content.replace(
      /^layout:\s*["'].*?["']/m,
      `layout: "../../layouts/BlogPost.astro"`
    );
    fs.writeFileSync(destFilePath, finalContent, 'utf-8');
    console.log(`[Auto-Publish] Successfully published: ${slug} (${scheduledDate})`);
  }
});
