#!/usr/bin/env python3
"""Outage + network/security news for the TEMobile News tab.

Runs server-side (GitHub Action) so feeds without CORS headers can be read:
  * Google News searches aimed at service / internet outages (who's down now)
    and at security incidents,
  * official status-page incidents from the big providers (RSS / Atom).
Writes one small JSON file the app reads from the repo's `data` branch.

Standard library only. Usage: fetch_news.py OUTPUT.json
"""
import email.utils
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

UA = 'Mozilla/5.0 (TEMobile news fetcher; +https://github.com/lucidium2000/TEMobile)'
NOW = time.time()
KEEP_S = 48 * 3600          # keep the last two days
MAX_ITEMS = 60
PER_QUERY = 10

GNEWS = 'https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q='
# (query, kind). Provider names first so a big named outage always shows.
NEWS_QUERIES = [
    ('outage (Microsoft OR Azure OR "Microsoft 365" OR Outlook OR Teams OR Xbox) when:2d', 'outage'),
    ('outage (AWS OR Amazon OR Google OR Gmail OR YouTube OR Cloudflare OR Akamai) when:2d', 'outage'),
    ('outage (Zoom OR Slack OR Webex OR GitHub OR Salesforce OR ServiceNow OR Okta OR CrowdStrike) when:2d', 'outage'),
    ('outage (Verizon OR "AT&T" OR "T-Mobile" OR Comcast OR Xfinity OR Spectrum OR Starlink) when:2d', 'outage'),
    ('("internet outage" OR "service outage" OR "network outage" OR "down for users" OR "global outage") when:1d', 'outage'),
    ('(cyberattack OR ransomware OR "data breach" OR "zero-day" OR DDoS) when:2d', 'security'),
]
# Official status pages: (provider, url).
STATUS_FEEDS = [
    ('AWS', 'https://status.aws.amazon.com/rss/all.rss'),
    ('Azure', 'https://azure.status.microsoft/en-us/status/feed/'),
    ('Google Cloud', 'https://status.cloud.google.com/en/feed.atom'),
    ('GitHub', 'https://www.githubstatus.com/history.rss'),
    ('Cloudflare', 'https://www.cloudflarestatus.com/history.rss'),
    ('Zoom', 'https://status.zoom.us/history.rss'),
    ('Slack', 'https://slack-status.com/feed/rss'),
    ('Atlassian', 'https://status.atlassian.com/history.rss'),
]
# Weather / utility outages aren't what this tab is for.
# Status pages also list planned work - not an outage.
MAINT = re.compile(r'maintenance|scheduled|lifecycle update|certificate rotation|^[A-Z]{3} \([^)]*\) on \d{4}-', re.I)
NOISE = re.compile(r'\b(power|electric(ity)?|water|gas|blackout)\s+outages?\b|\boutage map\b.*\bpower\b', re.I)


def get(url, timeout=20):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def when(text):
    if not text:
        return None
    text = text.strip()
    try:
        return email.utils.parsedate_to_datetime(text).timestamp()
    except Exception:
        pass
    try:   # ISO 8601 (Atom)
        from datetime import datetime
        return datetime.fromisoformat(text.replace('Z', '+00:00')).timestamp()
    except Exception:
        return None


def clean(s):
    s = html.unescape(re.sub(r'<[^>]+>', ' ', s or ''))
    return re.sub(r'\s+', ' ', s).strip()


def items(xml_bytes):
    """Yield (title, link, ts, source) from RSS or Atom."""
    root = ET.fromstring(xml_bytes)
    atom = '{http://www.w3.org/2005/Atom}'
    for it in root.iter('item'):
        src = it.find('source')
        yield (clean(it.findtext('title')), (it.findtext('link') or '').strip(),
               when(it.findtext('pubDate')), clean(src.text) if src is not None and src.text else '')
    for e in root.iter(atom + 'entry'):
        link = e.find(atom + 'link')
        yield (clean(e.findtext(atom + 'title')), link.get('href') if link is not None else '',
               when(e.findtext(atom + 'updated') or e.findtext(atom + 'published')), '')


def main(out_path):
    out, seen, errors = [], set(), []

    for q, kind in NEWS_QUERIES:
        try:
            # Newest first, and at most PER_QUERY from each search so one huge
            # story can't push every other outage / security item out.
            got = 0
            for title, link, ts, source in sorted(items(get(GNEWS + urllib.parse.quote(q))), key=lambda x: -(x[2] or 0)):
                if got >= PER_QUERY:
                    break
                if not title or not ts or NOW - ts > KEEP_S or ts > NOW + 300:
                    continue
                if kind == 'outage' and NOISE.search(title):
                    continue
                if source and title.endswith(' - ' + source):
                    title = title[: -len(source) - 3]
                key = re.sub(r'\W+', '', title.lower())[:80]
                if key in seen:
                    continue
                seen.add(key)
                out.append({'title': title, 'url': link, 'source': source or 'News', 't': int(ts * 1000), 'kind': kind})
                got += 1
        except Exception as e:   # one bad feed shouldn't empty the file
            errors.append(f'news {q[:30]}: {e}')

    for provider, url in STATUS_FEEDS:
        try:
            for title, link, ts, _ in items(get(url)):
                if not title or not ts or NOW - ts > KEEP_S or ts > NOW + 300 or MAINT.search(title):
                    continue
                key = (provider + title).lower()[:90]
                if key in seen:
                    continue
                seen.add(key)
                out.append({'title': title, 'url': link, 'source': provider + ' status', 't': int(ts * 1000), 'kind': 'status', 'provider': provider})
        except Exception as e:
            errors.append(f'status {provider}: {e}')

    out.sort(key=lambda x: x['t'], reverse=True)
    doc = {'generatedAt': int(NOW * 1000), 'items': out[:MAX_ITEMS], 'errors': errors}
    with open(out_path, 'w') as f:
        json.dump(doc, f, separators=(',', ':'))
    print(f'{len(doc["items"])} items, {len(errors)} feed errors')
    for e in errors:
        print('  !', e)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'news.json')
