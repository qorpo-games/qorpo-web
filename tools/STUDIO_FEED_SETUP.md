# Independent hourly studio feed

The live feed and both websites are refreshed. AneeMate /dev, AneeMate homepage,
QORPO /live and the QORPO on-page update popup all read qorpo.world/feed.json.
The clients now refresh every five minutes while visible and on returning to the tab.

There was no GitHub update workflow or repository secret in qorpo-games/qorpo-web.
The hourly producer cannot authenticate to nine private source repositories yet.
The updater is committed as tools/update_studio_feed.py. The ready workflow is at
work/live-feeds/qorpo/.github/workflows/studio-feed.yml, held locally until access is configured.

The account owner must create two fine-grained GitHub tokens with Contents: Read-only:

1. Resource owner QORPO-WORLD, selected repositories:
   aneemate-web, aneemate-competitions, AneeMateV2, Aneemate_Source,
   tamitos-webapp, tamitos-mobileapp, TaleOfUnderstanding, OneLife.
   Save in qorpo-games/qorpo-web Actions secrets as STUDIO_FEED_READ_TOKEN.
2. Resource owner qorpo-games, only tamitos-site-deploy.
   Save in the same repository as TAMITOS_SITE_READ_TOKEN.

Do not paste credentials into chat. No private source repository write permission is needed.
The workflow's automatic GITHUB_TOKEN writes only the public destination feed and deploys Pages.
After secrets are saved, commit the prepared workflow, run it manually, verify the
result, then its schedule repeats at minute 17 each hour without Claude or Codex credits.
The owner must ensure organization approval for the QORPO-WORLD read token if required.

All branches are paginated; duplicate SHAs from multiple branches count once per repository.
Each addition/deletion count is taken from the GitHub commit endpoint. Errors leave the
previous feed intact. No emails, author names, source diffs or tokens are published.
All-time statistics remain explicitly labelled as the historical snapshot; this task
updates the rolling activity feed, not the 280-repository historical census.
