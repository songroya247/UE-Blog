name: Check for broken links

on:
  schedule:
    # Every Monday at 06:00 UTC
    - cron: "0 6 * * 1"
  workflow_dispatch: {} # lets you trigger it manually from the Actions tab

jobs:
  check-links:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repo
        uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Run link checker against live site
        run: node scripts/check-links.js https://blog.ultimateedge.info
