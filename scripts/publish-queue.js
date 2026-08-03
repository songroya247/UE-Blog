const fs = require('fs');
const path = require('path');

const QUEUE_DIR = './content-queue';
const POSTS_DIR = './src/pages/posts';
const SCHEDULE_FILE = path.join(QUEUE_DIR, 'schedule.json');

if (!fs.existsSync(SCHEDULE_FILE)) {
  console.log('[Auto-Publish] No schedule.json found.');
  process.exit(0);
}

// Ensure target posts directory exists
if (!fs.existsSync(POSTS_DIR)) {
  fs.mkdirSync(POSTS_DIR, { recursive: true });
}

const schedule = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf-8'));
const today = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"

console.log(`[Auto-Publish] Checking queue for articles scheduled on or before ${today}...`);

schedule.forEach(item => {
  if (item.date <= today) {
    const queueFilePath = path.join(QUEUE_DIR, item.queueFile);
    const destFilePath = path.join(POSTS_DIR, `${item.slug}.md`);

    if (fs.existsSync(queueFilePath)) {
      let content = fs.readFileSync(queueFilePath, 'utf-8');

      // Update frontmatter date to the scheduled date
      content = content.replace(/^date:\s*["'].*?["']/m, `date: "${item.date}"`);

      // Ensure layout path is relative to src/pages/posts/
      content = content.replace(/^layout:\s*["'].*?["']/m, `layout: "../../layouts/BlogPost.astro"`);

      fs.writeFileSync(destFilePath, content, 'utf-8');
      console.log(`[Auto-Publish] Successfully published: ${item.slug} (${item.date})`);
    } else {
      console.warn(`[Auto-Publish] Queue file missing: ${item.queueFile}`);
    }
  }
});