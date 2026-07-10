# Notion Worker

A worker is a small Node/TypeScript program hosted by Notion
that registers capabilities (third-party data syncs, custom agent tools, custom
automations) to extend Notion. The worker lives in `src/index.ts` and exports a
single `Worker` instance.

## Prerequisites

- Node >= 22
- npm >= 10

## Quickstart

```shell
npm init @project-ajax@latest
# choose a folder, then:
cd my-worker
npm install
```

Connect to a Notion workspace and deploy the sample worker:

```shell
npx workers deploy
# or target a specific environment:
npx workers deploy --env=dev
```

Run the sample sync to create a database:

```shell
npx workers exec tasksSync
```

## Glossary

- Worker: The Node/TypeScript program you deploy, defined in `src/index.ts`.
- Capability: A named sync, tool, automation, or OAuth definition registered on a worker.
- Secret: A key/value stored with `npx workers secrets`, exposed as environment variables (for example, `process.env.SECRET_NAME`). Use `KEY=VALUE` pairs when setting secrets.

## Build a Worker

Create the worker instance and export it. Register capabilities on the same
instance:

```ts
import { Worker } from "@project-ajax/sdk";

const worker = new Worker();
export default worker;
```

### Sync

Syncs create or update a Notion database from your source data.

The most basic sync returns all data that should be copied to the Notion database on each run:

```ts
import * as Builder from "@project-ajax/sdk/builder";
import * as Schema from "@project-ajax/sdk/schema";

const worker = new Worker();
export default worker;

worker.sync("tasksSync", {
  primaryKeyProperty: "ID",
  schema: {
    defaultName: "Tasks",
    properties: {
      Name: Schema.title(),
      ID: Schema.richText(),
    },
  },
  execute: async (_state, { notion }) => ({
    // `notion` is the Notion API SDK client.
    changes: [
      {
        type: "upsert",
        key: "1",
        properties: {
          Name: Builder.title("Write docs"),
          ID: Builder.richText("1"),
        },
      },
    ],
    hasMore: false,
  }),
});
```

Notion will delete stale rows after each run. A stale row is a row that was in the database but that your function did not return.

#### Write a sync that paginates

When your sync is pulling in many rows of data (>1k), you'll want to use pagination. Breaking down pages to ~100 is a good starting point.

You can use `state` to persist things like pagination tokens between `execute` runs. Notion passes `state` as the first argument to `execute`, plus a `context` object that includes the Notion client at `context.notion`. Return `nextState` to set the `state` for the next run:

```ts
worker.sync("fullSync", {
  primaryKeyProperty: "ID",
  mode: "replace",
  schema: { defaultName: "Records", properties: { Name: Schema.title(), ID: Schema.richText() } },
  execute: async (state, { notion }) => {
    const { items , nextCursor } = await fetchPage(state?.page);
    return {
      changes: items.map((item) => ({
        type: "upsert",
        key: item.id,
        properties: { Name: Builder.title(item.name), ID: Builder.richText(item.id) },
      })),
      hasMore: nextCursor ? true : false,
      nextState: nextCursor ? { cursor: nextCursor } : undefined,
    };
  },
});
```

Return `hasMore=false` for each run until you reach the end. On the last run, return `hasMore=true`. At the start of the next cycle, Notion will start anew and call `execute` with `state` undefined.

#### Write a sync that syncs incrementally

When your sync is working with a lot of data (10k+), you'll want to use the `incremental` sync mode. With incremental syncs, you can for example backfill all the data from an API into Notion, and then sync only incremental updates from that point forward.

Set the sync's `mode` to `incremental` and use pagination as above:

```ts
worker.sync("incrementalSync", {
  primaryKeyProperty: "ID",
  mode: "incremental",
  schema: { defaultName: "Records", properties: { Name: Schema.title(), ID: Schema.richText() } },
  execute: async (state, { notion }) => {
    const { upserts, deletes, nextCursor } = await fetchChanges(state?.cursor);
    return {
      changes: [
        ...upserts.map((item) => ({
          type: "upsert",
          key: item.id,
          properties: { Name: Builder.title(item.name), ID: Builder.richText(item.id) },
        })),
        ...deletes.map((id) => ({ type: "delete", key: id })),
      ],
      hasMore: Boolean(nextCursor),
      nextState: nextCursor ? { cursor: nextCursor } : undefined,
    };
  },
});
```

Unlike the `replace` sync mode, Notion will not drop "stale" rows and `state` will persist between sync cycles.

**Deletes**

With incremental syncs, you can delete rows by returning a delete marker, like so:

```ts
changes: [
  // this is an upsert
  {
    type: "upsert",
    key: item.id,
    properties: { Name: Builder.title(item.name), ID: Builder.richText(item.id) },
  },
  // this is a delete
  {
    type: "delete",
    key: item.id
  }
]
```

### Tool

Tools are callable by Notion custom agents.

```ts
worker.tool("sayHello", {
  title: "Say Hello",
  description: "Return a greeting",
  schema: {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
    additionalProperties: false,
  },
  execute: ({ name }, { notion }) => `Hello, ${name}`,
});
```

### Automation

Automations run from Notion database buttons or automations.

```ts
worker.automation("sendWelcomeEmail", {
  title: "Send Welcome Email",
  description: "Runs from a database automation",
  execute: async (event, { notion }) => {
    const { pageId } = event;
    console.log("Triggered for page", pageId);
  },
});
```

### OAuth

OAuth capabilities let your worker access third-party APIs.

```ts
// Notion-managed provider
worker.oauth("googleAuth", { name: "my-google-auth", provider: "google" });

// User-managed provider
worker.oauth("acmeAuth", {
  name: "acme-oauth",
  authorizationEndpoint: "https://provider.example.com/oauth/authorize",
  tokenEndpoint: "https://provider.example.com/oauth/token",
  scope: "read write",
  clientId: "YOUR_CLIENT_ID",
  clientSecret: "YOUR_CLIENT_SECRET",
});
```

## Local Development

```shell
npm run dev   # watch and run src/index.ts
npm run check # type-check
npm run build # emit dist/
```

## Workers CLI Commands

### `npx workers auth login`
Log in to Notion (use `--env=dev` for dev):

```shell
npx workers auth login --env=dev
```

Login is automatically handled by `npx workers deploy`, so this command is
typically not needed.

### `npx workers auth show`
Show the active auth token:

```shell
npx workers auth show
```

### `npx workers auth logout`
Clear the stored auth token:

```shell
npx workers auth logout
```

### `npx workers deploy`
Build and upload your worker bundle:

```shell
npx workers deploy
```

### `npx workers exec`
Run a sync or tool capability:

```shell
npx workers exec tasksSync
```

### `npx workers capabilities list`
List deployed capabilities:

```shell
npx workers capabilities list
```

### `npx workers capabilities enable`
Enable a sync capability:

```shell
npx workers capabilities enable tasksSync
```

### `npx workers capabilities disable`
Disable a sync capability:

```shell
npx workers capabilities disable tasksSync
```

### `npx workers secrets set`
Store secrets for runtime access:

```shell
npx workers secrets set API_KEY=my-secret
```

You can pass multiple secrets and quote values that contain spaces or `=`:

```shell
npx workers secrets set FOO=bar BAZ="qux" ASDF="x=y" GREETING="hello world"
```

### `npx workers secrets list`
List secret keys:

```shell
npx workers secrets list
```

### `npx workers secrets rm`
Remove a secret:

```shell
npx workers secrets rm API_KEY
```

### `npx workers oauth start`
Start an OAuth flow for a capability:

```shell
npx workers oauth start googleAuth
```

### `npx workers env pull`
Write remote env vars to a local `.env` file:

```shell
npx workers env pull .env
```

### `npx workers runs list`
List recent runs:

```shell
npx workers runs list
```

Use `--plain` for machine-readable tab-separated output:

```shell
npx workers runs list --plain
```

### `npx workers runs logs`
Fetch logs for a run:

```shell
npx workers runs logs <runId>
```

Get logs for the latest run (any capability):

```shell
npx workers runs list --plain | head -n1 | cut -f1 | xargs npx workers runs logs
```

Get logs for the latest run of a specific capability:

```shell
npx workers runs list --plain | grep tasksSync | head -n1 | cut -f1 | xargs npx workers runs logs
```

### `npx workers bundle download`
Download the deployed bundle:

```shell
npx workers bundle download
```
