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

On 29 October, the old QORPO-WORLD/Aneemate_Source path returned404 and had
frozen the whole feed since23October. Authenticated GitHub navigation verified that
both Aneemate_Source and OneLife moved to owner TAMITOS. The canonical source
paths are now TAMITOS/Aneemate_Source and TAMITOS/OneLife, preserving their history.
For these two repositories the collector uses TAMITOS_SOURCE_READ_TOKEN when
configured, otherwise tries the existing STUDIO_FEED_READ_TOKEN. If the existing
reader cannot access the new owner, the owner must configure a scoped Contents:
Read-only credential for only these two repositories. Never create or expand access
automatically. Do not replace this with a source write credential.

Run python3 -B tools/test_studio_feed.py for recovery, rollback, deduplication,
rerun and total-failure fixtures. Trigger the existing workflow after a repair,
verify its coverage summary, then verify the public feed timestamp and the real
Today filters. A green partial run means healthy sources refreshed, not full coverage.

Clients refresh every five minutes while visible and on tab return. All-time
numbers remain the labelled historical snapshot, separate from rolling activity.
