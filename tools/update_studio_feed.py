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
import urllib.error
import urllib.parse
import urllib.request

REPOS = {
    'QORPO-WORLD/aneemate-web': 'aneemate',
    'QORPO-WORLD/aneemate-competitions': 'aneemate',
    'QORPO-WORLD/AneeMateV2': 'aneemate',
    'TAMITOS/Aneemate_Source': 'aneemate',
    'QORPO-WORLD/tamitos-webapp': 'tamitos',
    'QORPO-WORLD/tamitos-mobileapp': 'tamitos',
    'QORPO-WORLD/TaleOfUnderstanding': 'tamitos',
    'TAMITOS/OneLife': 'onelife',
    'qorpo-games/tamitos-site-deploy': 'tamitos',
}
TOKENS = {
    'QORPO-WORLD': os.environ.get('STUDIO_FEED_READ_TOKEN'),
    # The source repository moved owners. An existing reader may still have
    # access; a dedicated read-only token can override it without code changes.
    'TAMITOS': os.environ.get('TAMITOS_SOURCE_READ_TOKEN') or os.environ.get('STUDIO_FEED_READ_TOKEN'),
    'qorpo-games': os.environ.get('TAMITOS_SITE_READ_TOKEN'),
}

# GitHub primary quotas are shared by requests using the same reader. Stop
# repeating requests after exhaustion. Wait once for an imminent reset (up to
# 20 minutes); otherwise the next scheduled run retries.
EXHAUSTED_READERS = {}

def get(path):
    token = TOKENS[path.split('/')[1]]
    if token in EXHAUSTED_READERS:
        raise RuntimeError('GitHub read quota exhausted; retry after ' + EXHAUSTED_READERS[token])
    req = urllib.request.Request('https://api.github.com/' + path, headers={
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'qorpo-studio-feed',
    })
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=45) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            # Keep credentials and response headers private. Report only the API message.
            try:
                message = json.loads(exc.read().decode()).get('message', exc.reason)
            except (ValueError, UnicodeError):
                message = exc.reason
            rate_limited = exc.code == 429 or (
                exc.code == 403 and ('rate limit' in str(message).lower()
                                    or exc.headers.get('Retry-After')))
            if rate_limited and exc.headers.get('X-RateLimit-Remaining') == '0':
                reset = exc.headers.get('X-RateLimit-Reset', '')
                reset_at = (dt.datetime.fromtimestamp(int(reset), dt.timezone.utc).isoformat()
                            if reset.isdigit() else 'the next scheduled refresh')
                delay = int(reset) - int(time.time()) + 2 if reset.isdigit() else 0
                if 0 < delay <= 1200 and attempt < 2:
                    print(f'GitHub read quota for {path.split("/")[1]} resets {reset_at}; waiting {delay}s before retry.', flush=True)
                    time.sleep(delay)
                    continue
                EXHAUSTED_READERS[token] = reset_at
                print(f'::warning::GitHub read quota exhausted for {path.split("/")[1]}; resets {reset_at}. Previous entries retained.', flush=True)
                raise RuntimeError('GitHub primary read quota exhausted') from None
            transient = exc.code >= 500 or rate_limited
            if not transient or attempt == 2:
                raise RuntimeError(f'GitHub HTTP {exc.code} for {path}: {message}') from None
            delay = max(60 if rate_limited else 2 ** attempt,
                        int(exc.headers.get('Retry-After', '0')))
            if delay > 120:
                raise RuntimeError(f'GitHub rate limit for {path}; retry later. Existing feed remains untouched.') from None
            print(f'Transient GitHub HTTP {exc.code}; retrying after {delay}s', flush=True)
            time.sleep(delay)
        except (urllib.error.URLError, TimeoutError):
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
    if not all(TOKENS.values()):
        raise SystemExit('Missing scoped read-only feed credentials: STUDIO_FEED_READ_TOKEN for the 8 QORPO-WORLD repositories and TAMITOS_SITE_READ_TOKEN for qorpo-games/tamitos-site-deploy. Existing feed remains untouched.')
    path = Path('feed.json')
    old = json.loads(path.read_text())
    now = dt.datetime.now(dt.timezone.utc)
    # Always rescan the whole 30-day window, so commits missed by an earlier run
    # (outage, rate limit, no credits, a 300-commit page cap) are filled in. Only unseen commits cost a stats call.
    since = (now - dt.timedelta(days=30)).isoformat()
    old_log = old.get('log', [])
    keys = {(entry['r'], entry['s']): entry for entry in old_log}
    # A source is one transaction: publish all of its branches and stats, or keep
    # its previous entries. One unavailable repository must not freeze the studio.
    source_status = {}
    def scan_repo(repo):
        found = {}
        name = repo.split('/')[1]
        prior_complete = old.get('sources', {}).get(name, {}).get('status') == 'ok'
        for branch in pages(f'repos/{repo}/branches'):
            head = (branch.get('commit') or {}).get('sha')
            # An unchanged head already in a successfully scanned source has
            # the same ancestry, so its recent commits are already in old_log.
            # Failed/unknown sources must still get a full recovery scan.
            if prior_complete and head and any(r == name and head.startswith(s) for r, s in keys):
                continue
            query = urllib.parse.urlencode({'sha': branch['name'], 'since': since})
            for commit in pages(f'repos/{repo}/commits?{query}'):
                found[commit['sha']] = commit
        return found
    commits = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        jobs = {repo: pool.submit(scan_repo, repo) for repo in REPOS}
        for repo, job in jobs.items():
            try:
                for sha, commit in job.result().items():
                    commits[(repo, sha)] = commit
                source_status[repo.split('/')[1]] = {'status': 'ok'}
            except (RuntimeError, urllib.error.URLError, TimeoutError):
                source_status[repo.split('/')[1]] = {'status': 'unavailable'}
                print(f'::warning::Studio feed source unavailable: {repo}. Previous entries retained.', flush=True)
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
    added = []
    # A stats error also rolls back that source, never silently publishing a
    # subset of its newly discovered commits as a complete refresh.
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for repo in REPOS:
            if source_status[repo.split('/')[1]]['status'] != 'ok':
                continue
            try:
                batch = list(pool.map(enrich, [item for item in unseen if item[0] == repo]))
                added.extend(batch)
            except (RuntimeError, urllib.error.URLError, TimeoutError):
                source_status[repo.split('/')[1]] = {'status': 'unavailable'}
                print(f'::warning::Studio feed source stats unavailable: {repo}. Previous entries retained.', flush=True)
    successful = sum(s['status'] == 'ok' for s in source_status.values())
    if not successful:
        raise SystemExit('No studio source could be refreshed. Existing feed remains untouched.')
    for (repo, sha), commit in commits.items():
        entry = previous(repo, sha)
        if entry is not None and 'm' not in entry:
            entry['m'] = commit['commit']['message'].splitlines()[0]
    cutoff = (now - dt.timedelta(days=31)).isoformat().replace('+00:00', 'Z')
    log = sorted((entry for entry in old_log + added if entry['t'] >= cutoff), key=lambda entry: entry['t'], reverse=True)
    # Commit messages are already public in this feed. Never publish emails, author names, tokens, or diffs.
    refreshed = now.isoformat(timespec='seconds').replace('+00:00', 'Z')
    previous_sources = old.get('sources', {})
    for repo, status in source_status.items():
        status['checked'] = refreshed
        if status['status'] == 'ok':
            status['last_success'] = refreshed
        else:
            status['last_success'] = previous_sources.get(repo, {}).get('last_success', old.get('updated'))
    result = {**old, 'updated': refreshed, 'log': log, 'builder_ids': identities,
              'coverage': {'status': 'complete' if successful == len(REPOS) else 'partial',
                           'refreshed_repos': successful, 'tracked_repos': len(REPOS)},
              'sources': source_status}
    for project in ('aneemate', 'tamitos', 'onelife'):
        originals = {(e['r'], e['t']): e.get('m') for e in old.get(project, [])}
        result[project] = [{**entry, 'm': entry.get('m') or originals.get((entry['r'], entry['t'])) or 'Studio repository update'} for entry in log if entry['p'] == project][:24]
    cutoff30 = (now - dt.timedelta(days=30)).isoformat().replace('+00:00', 'Z')
    result['stats'] = {'builders30': len({str(e['u']) for e in log if e.get('u') is not None and e['t'] >= cutoff30}), 'repos': len(REPOS), 'since': cutoff[:10], 'source': 'GitHub API, all tracked branches, deduplicated by repository and commit SHA'}
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
    temporary.replace(path)
    print(f'Refreshed {successful}/{len(REPOS)} sources; added {len(added)} verified commits; kept {len(log)} in the rolling feed')

if __name__ == '__main__':
    main()


