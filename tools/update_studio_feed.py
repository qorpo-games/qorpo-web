#!/usr/bin/env python3
"""Refresh the public studio feed from authenticated GitHub data, never AI text.
Requires STUDIO_FEED_READ_TOKEN with read-only Contents on the tracked repositories.
The write/deploy credential is separate and scoped to qorpo-web by GitHub Actions.
"""
import concurrent.futures
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.parse
import urllib.request

REPOS = {
    'QORPO-WORLD/aneemate-web': 'aneemate',
    'QORPO-WORLD/aneemate-competitions': 'aneemate',
    'QORPO-WORLD/AneeMateV2': 'aneemate',
    'QORPO-WORLD/Aneemate_Source': 'aneemate',
    'QORPO-WORLD/tamitos-webapp': 'tamitos',
    'QORPO-WORLD/tamitos-mobileapp': 'tamitos',
    'QORPO-WORLD/TaleOfUnderstanding': 'tamitos',
    'QORPO-WORLD/OneLife': 'onelife',
    'qorpo-games/tamitos-site-deploy': 'tamitos',
}
TOKEN = os.environ.get('STUDIO_FEED_READ_TOKEN')

def get(path):
    req = urllib.request.Request('https://api.github.com/' + path, headers={
        'Authorization': 'Bearer ' + TOKEN,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'qorpo-studio-feed',
    })
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=45) as response:
                return json.load(response)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)

def pages(path):
    result = []
    for page in range(1, 100):
        batch = get(path + ('&' if '?' in path else '?') + f'per_page=100&page={page}')
        result.extend(batch)
        if len(batch) < 100:
            return result
    raise RuntimeError('Pagination exceeded; keep existing feed rather than publish partial data')

def identity(commit):
    author = commit.get('author') or {}
    name = author.get('login') or commit['commit']['author']['email'].lower()
    return hashlib.sha256(name.encode()).hexdigest()

def main():
    if not TOKEN:
        raise SystemExit('Missing STUDIO_FEED_READ_TOKEN: add a read-only token for the 9 tracked private/public repositories. Existing feed remains untouched.')
    path = Path('feed.json')
    old = json.loads(path.read_text())
    now = dt.datetime.now(dt.timezone.utc)
    last = dt.datetime.fromisoformat(old['updated'].replace('Z', '+00:00'))
    # A two-hour overlap catches late arrivals and lets us retain existing anonymous builder IDs.
    since = (min(last - dt.timedelta(hours=2), now) - dt.timedelta(minutes=5)).isoformat()
    commits = {}
    jobs = []
    for repo in REPOS:
        for branch in pages(f'repos/{repo}/branches'):
            jobs.append((repo, branch['name']))
    def branch_commits(job):
        repo, branch = job
        query = urllib.parse.urlencode({'sha': branch, 'since': since})
        return repo, pages(f'repos/{repo}/commits?{query}')
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for repo, batch in pool.map(branch_commits, jobs):
            for commit in batch:
                commits[(repo, commit['sha'])] = commit
    old_log = old.get('log', [])
    keys = {(entry['r'], entry['s']): entry for entry in old_log}
    def previous(repo, sha):
        return next((entry for (r, s), entry in keys.items() if r == repo.split('/')[1] and sha.startswith(s)), None)
    identities = old.get('builder_ids', {})
    for (repo, sha), commit in commits.items():
        entry = previous(repo, sha)
        if entry is not None and entry.get('u') is not None:
            identities[identity(commit)] = entry['u']
    unseen = [(repo, sha, commit) for (repo, sha), commit in commits.items() if previous(repo, sha) is None]
    def enrich(item):
        repo, sha, commit = item
        stats = get(f'repos/{repo}/commits/{sha}')['stats']
        return {
            'p': REPOS[repo], 'r': repo.split('/')[1], 's': sha,
            't': commit['commit']['committer']['date'],
            'a': stats['additions'], 'd': stats['deletions'],
            'u': identities.get(identity(commit), identity(commit)[:16]),
            'm': commit['commit']['message'].splitlines()[0],
        }
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        added = list(pool.map(enrich, unseen))
    for (repo, sha), commit in commits.items():
        entry = previous(repo, sha)
        if entry is not None and 'm' not in entry:
            entry['m'] = commit['commit']['message'].splitlines()[0]
    cutoff = (now - dt.timedelta(days=31)).isoformat().replace('+00:00', 'Z')
    log = sorted((entry for entry in old_log + added if entry['t'] >= cutoff), key=lambda entry: entry['t'], reverse=True)
    # Commit messages are already public in this feed. Never publish emails, author names, tokens, or diffs.
    result = {**old, 'updated': now.isoformat(timespec='seconds').replace('+00:00', 'Z'), 'log': log, 'builder_ids': identities}
    for project in ('aneemate', 'tamitos', 'onelife'):
        originals = {(e['r'], e['t']): e.get('m') for e in old.get(project, [])}
        result[project] = [{**entry, 'm': entry.get('m') or originals.get((entry['r'], entry['t'])) or 'Studio repository update'} for entry in log if entry['p'] == project][:24]
    result['stats'] = {'builders30': len({str(e['u']) for e in log if e.get('u') is not None}), 'repos': len(REPOS), 'since': cutoff[:10], 'source': 'GitHub API, all tracked branches, deduplicated by repository and commit SHA'}
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
    temporary.replace(path)
    print(f'Verified {len(commits)} commits; added {len(added)}; kept {len(log)} in the rolling feed')

if __name__ == '__main__':
    main()
