# strava-notion-sync

A [Notion Worker](https://developers.notion.com/) that syncs your [Strava](https://www.strava.com/) activities into a Notion database. It runs on a schedule, pulls recent activities from the Strava API, and upserts them as database rows with type, date, duration, distance, pace, heart rate, and calories.

## How it works

- Defined in [`src/index.ts`](src/index.ts) as a single `stravaActivitiesSync` sync capability.
- Runs every 3 hours in `incremental` mode with a rolling 14-day lookback, so edits and backfilled activities are caught.
- Authenticates with Strava using a manual token-refresh flow: each run exchanges a refresh token for a short-lived access token and persists the newly rotated refresh token in the sync's state (Strava rotates the refresh token on every call).

## Setup

### Prerequisites

- Node >= 22 and npm >= 10.9.2
- A Strava API application — create one at <https://www.strava.com/settings/api>
- A Notion workspace

### 1. Install

```shell
npm install
```

### 2. Configure Strava credentials

Credentials are **never** hardcoded — the worker reads them from three runtime secrets:

```shell
npx workers secrets set \
  STRAVA_CLIENT_ID=<your-client-id> \
  STRAVA_CLIENT_SECRET=<your-client-secret> \
  STRAVA_BOOTSTRAP_REFRESH_TOKEN=<refresh-token-with-activity:read_all-scope>
```

`STRAVA_BOOTSTRAP_REFRESH_TOKEN` seeds the very first run; after that the worker manages and rotates the token itself. See [Re-authenticating](#re-authenticating) for how to obtain one.

### 3. Deploy and run

```shell
npx workers deploy
npx workers exec stravaActivitiesSync   # trigger a first sync
```

## Re-authenticating

If the sync fails with `refresh_token: invalid` (for example after resetting your Strava client secret, which invalidates existing tokens), mint a fresh refresh token:

1. Open this URL in a browser (substitute your client id) and click **Authorize**:

   ```
   https://www.strava.com/oauth/authorize?client_id=<id>&response_type=code&redirect_uri=http://localhost&approval_prompt=force&scope=activity:read_all,read
   ```

   Your app's **Authorization Callback Domain** (in the Strava API settings) must include `localhost`.

2. The browser redirects to a `http://localhost/...` page that won't load — that's expected. Copy the `code=...` value from the address bar.

3. Exchange the code for tokens:

   ```shell
   curl -s -X POST https://www.strava.com/oauth/token \
     -H "Content-Type: application/json" \
     -d '{"client_id":"<id>","client_secret":"<secret>","code":"<code>","grant_type":"authorization_code"}'
   ```

4. Set the returned `refresh_token`:

   ```shell
   npx workers secrets set STRAVA_BOOTSTRAP_REFRESH_TOKEN=<refresh_token>
   ```

## Synced fields

Name, Activity ID, Activity Type, Date, Start Time, Duration, Calories, Average Heart Rate, Distance, and Pace. Distance and pace are only populated for distance-based activity types (runs, walks, rides, hikes, swims, etc.).

## Local development

```shell
npm run dev    # watch and run src/index.ts
npm run check  # type-check only
npm run build  # emit dist/
```

## Debugging

```shell
npx workers runs list
# logs for the latest stravaActivitiesSync run:
npx workers runs list --plain | grep stravaActivitiesSync | head -n1 | cut -f1 | xargs npx workers runs logs
```

## Built with

The [Notion Workers SDK](https://developers.notion.com/) (`@notionhq/workers`). See [`AGENTS.md`](AGENTS.md) for SDK usage notes and [`.examples/`](.examples/) for sync, tool, automation, and OAuth samples.
