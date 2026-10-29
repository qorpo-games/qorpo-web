# Studio live feed

The existing hourly workflow refreshes qorpo.world/feed.json. QORPO /live,
the QORPO update popup, AneeMate /dev and its home band consume that source.
TAMITOS commits are included in the shared studio log. TAMITOS Move's editorial
release feed at help.tamitos.com/v1/releases is a separate source, not a commit feed.

Keep the existing two scoped read credentials in GitHub Actions secrets:
STUDIO_FEED_READ_TOKEN for QORPO-WORLD source repositories and
TAMITOS_SITE_READ_TOKEN for qorpo-games/tamitos-site-deploy. The workflow's
GITHUB_TOKEN writes only the destination and publishes Pages. Never copy keys into
public files or logs. No source repository write access is needed.

Each source is a transaction: all branch pages and new commit statistics must
succeed, or that source retains its prior entries. An unavailable source does not
stop healthy sources. The feed reports coverage.complete/partial, source checked
time and last successful scan; partial totals are explicitly labelled by clients.
If all sources fail, the previous feed remains byte-for-byte unchanged and CI fails.

On 29 October, Aneemate_Source returned404 and had frozen the whole feed since
23 October. A404 can mean missing repository or missing read access; do not infer
which without owner confirmation. Restore its existing read access or confirm its
retirement. Do not silently substitute another repository or broaden permissions.

Run python3 -B tools/test_studio_feed.py for recovery, rollback, deduplication,
rerun and total-failure fixtures. Trigger the existing workflow after a repair,
verify its coverage summary, then verify the public feed timestamp and the real
Today filters. A green partial run means healthy sources refreshed, not full coverage.

Clients refresh every five minutes while visible and on tab return. All-time
numbers remain the labelled historical snapshot, separate from rolling activity.
