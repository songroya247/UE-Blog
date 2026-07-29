#!/usr/bin/env python3
"""
Moves posts from content-queue/ into src/pages/posts/ once their scheduled
date has arrived. Reads content-queue/schedule.json for the plan.

This script does no AI work and no content generation — every file in
content-queue/ is already a complete, final Astro markdown post (frontmatter
+ body) exactly as it will appear when published. This script only decides
WHEN each file becomes live, by moving it into the routed pages folder.
"""

import json
import os
import re
import shutil
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
QUEUE_DIR = os.path.join(REPO_ROOT, "content-queue")
SCHEDULE_PATH = os.path.join(QUEUE_DIR, "schedule.json")
POSTS_DIR = os.path.join(REPO_ROOT, "src", "pages", "posts")

def today_str():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")

def set_frontmatter_date(content, date_str):
    """Replace the `date: "..."` line in frontmatter with the given date,
    only if it's still a placeholder or missing. Leaves an already-set
    explicit date untouched, so you can still hand-schedule an exception."""
    def repl(match):
        return f'date: "{date_str}"'
    # Only touch obviously-placeholder dates so manually-set dates aren't clobbered
    if re.search(r'date:\s*"?(TBD|PLACEHOLDER|)"?\s*$', content, re.MULTILINE):
        content = re.sub(r'date:\s*"?(TBD|PLACEHOLDER|)"?\s*$', f'date: "{date_str}"', content, count=1, flags=re.MULTILINE)
    return content

def main():
    if not os.path.exists(SCHEDULE_PATH):
        print("No schedule.json found — nothing to do.")
        return

    with open(SCHEDULE_PATH) as f:
        schedule = json.load(f)

    today = today_str()
    os.makedirs(POSTS_DIR, exist_ok=True)

    published_any = False
    remaining = []

    for entry in schedule:
        slug = entry["slug"]
        queue_file = entry["queueFile"]
        scheduled_date = entry["date"]
        queue_path = os.path.join(QUEUE_DIR, queue_file)
        dest_path = os.path.join(POSTS_DIR, f"{slug}.md")

        already_published = os.path.exists(dest_path)
        due = scheduled_date <= today

        if already_published:
            continue  # nothing to do, keep it out of "remaining" too (it's done)

        if due and os.path.exists(queue_path):
            shutil.copyfile(queue_path, dest_path)
            with open(dest_path) as f:
                content = f.read()
            content = set_frontmatter_date(content, scheduled_date)
            with open(dest_path, "w") as f:
                f.write(content)
            os.remove(queue_path)
            print(f"Published: {slug} (scheduled {scheduled_date})")
            published_any = True
        else:
            remaining.append(entry)

    # Keep schedule.json in sync — remove entries that have been published,
    # so re-runs are idempotent and the file always shows what's still pending.
    with open(SCHEDULE_PATH, "w") as f:
        json.dump(remaining, f, indent=2)

    if not published_any:
        print("Nothing due today.")

if __name__ == "__main__":
    main()
