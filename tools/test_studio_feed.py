import urllib.error
from email.message import Message
import contextlib
import datetime as dt
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('feed', Path(__file__).with_name('update_studio_feed.py'))
feed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(feed)

class FeedTests(unittest.TestCase):
    def run_feed(self, fail=None, stats_fail=False, all_fail=False, cached=False):
        now = dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z')
        old = {'updated': '2026-10-23T13:26:41Z', 'log': [
            {'r': 'old', 's': 'oldsha', 'p': 'aneemate', 't': now, 'u': 'old', 'a': 1, 'd': 0, 'm': 'Retained'}]}
        repos = {'QORPO-WORLD/good': 'tamitos', 'QORPO-WORLD/old': 'aneemate'}
        if cached: old['sources'] = {'old': {'status': 'ok'}}
        def pages(path):
            repo = path.split('/')[2]
            if all_fail or (repo == fail and not stats_fail):
                raise RuntimeError('GitHub HTTP404')
            if '/branches' in path: return [{'name': 'main', 'commit': {'sha':repo+'sha'}}, {'name': 'other', 'commit': {'sha':repo+'sha'}}]
            if cached and repo == 'old': raise AssertionError('Unchanged complete ancestry fetched again')
            batch = [{'sha': repo + 'sha', 'author': {'login': repo}, 'commit': {
                'author': {'email': 'fixture@example.invalid'}, 'committer': {'date': now},
                'message': 'Fixture update'}}]
            if repo == 'good' and stats_fail:
                batch.append({**batch[0], 'sha': 'secondsha'})
            return batch
        def get(path):
            if stats_fail and path.endswith('secondsha'): raise RuntimeError('Stats unavailable after one successful enrichment')
            return {'stats': {'additions': 5, 'deletions': 2}}
        with tempfile.TemporaryDirectory() as temp:
            previous = os.getcwd()
            try:
                os.chdir(temp)
                p = Path('feed.json');p.write_text(json.dumps(old));before = p.read_bytes()
                with patch.object(feed, 'REPOS', repos), patch.object(feed, 'TOKENS', {'QORPO-WORLD': 'fixture'}), patch.object(feed, 'pages', pages), patch.object(feed, 'get', get), contextlib.redirect_stdout(io.StringIO()):
                    if all_fail:
                        with self.assertRaises(SystemExit): feed.main()
                        self.assertEqual(before, p.read_bytes())
                        return
                    feed.main()
                    first = json.loads(p.read_text())
                    feed.main()
                    second = json.loads(p.read_text())
                self.assertEqual(len(first['log']), len(second['log']), 'Rerun duplicates')
                return first
            finally: os.chdir(previous)

    def test_all_sources_and_branch_deduplication(self):
        d = self.run_feed()
        self.assertEqual(d['coverage']['status'], 'complete')
        self.assertEqual(len(d['log']), 2)
        self.assertEqual(d['sources']['old']['status'], 'ok')
        self.assertNotIn('fixture@example.invalid', json.dumps(d))

    def test_missing_repo_retains_history_refreshes_other_source(self):
        d = self.run_feed(fail='old')
        self.assertEqual(d['coverage'], {'status':'partial','refreshed_repos':1,'tracked_repos':2})
        self.assertEqual(d['sources']['old']['last_success'], '2026-10-23T13:26:41Z')
        self.assertIn('goodsha', [e['s'] for e in d['log']])
        self.assertIn('oldsha', [e['s'] for e in d['log']])

    def test_stats_failure_rolls_back_whole_source(self):
        d = self.run_feed(fail='good', stats_fail=True)
        self.assertEqual(d['sources']['good']['status'], 'unavailable')
        self.assertNotIn('goodsha', [e['s'] for e in d['log']])

    def test_total_failure_does_not_replace_feed(self): self.run_feed(all_fail=True)

    def test_known_complete_head_reused_but_new_head_scanned(self):
        d = self.run_feed(cached=True)
        self.assertEqual(d['coverage']['status'], 'complete')
        self.assertIn('goodsha', [e['s'] for e in d['log']])
        self.assertIn('oldsha', [e['s'] for e in d['log']])

    def test_primary_rate_limit_stops_repeated_requests_without_exposing_token(self):
        headers = Message()
        headers['X-RateLimit-Remaining'] = '0'
        headers['X-RateLimit-Reset'] = '1793240000'
        error = urllib.error.HTTPError('https://api.github.com/repos/QORPO-WORLD/test',403,'Forbidden',headers,io.BytesIO(b'{"message":"API rate limit exceeded"}'))
        output = io.StringIO()
        with patch.object(feed, 'TOKENS', {'QORPO-WORLD':'private-fixture-key'}), patch.object(feed,'EXHAUSTED_READERS',{}), patch.object(feed.urllib.request,'urlopen',side_effect=error) as request, contextlib.redirect_stdout(output):
            with self.assertRaises(RuntimeError): feed.get('repos/QORPO-WORLD/test/branches')
            with self.assertRaises(RuntimeError): feed.get('repos/QORPO-WORLD/other/branches')
            self.assertEqual(request.call_count, 1)
        self.assertIn('resets', output.getvalue())
        self.assertNotIn('private-fixture-key', output.getvalue())

if __name__ == '__main__': unittest.main()
