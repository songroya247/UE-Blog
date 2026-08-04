#!/usr/bin/env python3
"""
Moves posts from content-queue/ into src/pages/posts/ once their scheduled
date has arrived.

No schedule.json needed. This script scans every .md file in content-queue/,
reads its frontmatter `date:` field directly, and publishes it once that
date is <= today. To schedule a new post: just drop the finished .md file
into content-queue/ with a real date (not "TBD") in its frontmatter.
Files with date "TBD" (or no date) are left in the queue untouched.
"""

import os
import re
import shutil
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
QUEUE_DIR = os.path.join(REPO_ROOT, "content-queue")
POSTS_DIR = os.path.join(REPO_ROOT, "src", "pages", "posts")

DATE_RE = re.compile(r'^date:\s*"(.*?)"\s*$', re.MULTILINE)
VALID_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
SLUG_FIELD_RE = re.compile(r'^slug:\s*"(.*?)"\s*$', re.MULTILINE)
TITLE_RE = re.compile(r'^title:\s*"(.*?)"\s*$', re.MULTILINE)


def today_str():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def get_frontmatter_date(content):
    match = DATE_RE.search(content)
    if not match:
        return None
    value = match.group(1).strip()
    if not VALID_DATE_RE.match(value):
        return None  # "TBD", empty, or malformed — not ready to publish
    return value


def slugify(text):
    text = text.lower()
    text = re.sub(r"[''\"]", "", text)          # drop quotes/apostrophes
    text = re.sub(r"[^a-z0-9]+", "-", text)      # everything else -> hyphen
    return text.strip("-")


def resolve_slug(content, filename_slug):
    """Priority: explicit `slug:` field > slugified `title:` > filename."""
    slug_match = SLUG_FIELD_RE.search(content)
    if slug_match and slug_match.group(1).strip():
        return slugify(slug_match.group(1).strip())

    title_match = TITLE_RE.search(content)
    if title_match and title_match.group(1).strip():
        return slugify(title_match.group(1).strip())

    return filename_slug


def main():
    if not os.path.isdir(QUEUE_DIR):
        print("No content-queue/ directory found — nothing to do.")
        return

    today = today_str()
    os.makedirs(POSTS_DIR, exist_ok=True)

    published_any = False

    for filename in sorted(os.listdir(QUEUE_DIR)):
        if not filename.endswith(".md"):
            continue

        queue_path = os.path.join(QUEUE_DIR, filename)
        filename_slug = filename[:-3]

        with open(queue_path) as f:
            content = f.read()

        scheduled_date = get_frontmatter_date(content)
        if scheduled_date is None:
            continue  # still TBD, not scheduled yet

        slug = resolve_slug(content, filename_slug)
        dest_path = os.path.join(POSTS_DIR, f"{slug}.md")

        if os.path.exists(dest_path):
            continue  # already published

        if scheduled_date <= today:
            shutil.copyfile(queue_path, dest_path)
            os.remove(queue_path)
            print(f"Published: {slug} (scheduled {scheduled_date})")
            published_any = True

    if not published_any:
        print("Nothing due today.")


if __name__ == "__main__":
    main()