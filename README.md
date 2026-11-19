# Route Explorer

A VS Code extension that lists every Next.js and Express route in your workspace in a sidebar tree. Click a route to jump to the line that defines it.

## What it finds

**Next.js** (any folder whose `package.json` depends on `next`)

- App Router pages and route handlers under `app/` or `src/app/`, including route groups `(group)`, parallel slots `@slot`, private folders `_folder` and dynamic segments.
- The HTTP methods each `route.ts` exports (`GET`, `POST`, and so on), each linked to its own line.
- Pages Router pages and API routes under `pages/` or `src/pages/`.

**Express**

- `app.get(...)`, `router.post(...)` and the other HTTP methods, on anything created with `express()` or `Router()`.
- `router.route('/x').get(...).post(...)` chains and arrays of paths.
- Mount prefixes from `app.use('/api', router)`, both inside one file and across files (`import` and `require`).

## Send a test request

Hover a route and click the play button, or right-click it and choose **Send Test Request**. The response (status, time, headers and body) appears in the **Route Explorer** output panel.

- Dynamic segments such as `:id` or `[slug]` are asked for one at a time.
- `POST`, `PUT` and `PATCH` ask for an optional JSON body.
- Requests go to `http://localhost:3000` by default. Change the `routeExplorer.baseUrl` setting, or run **Route Explorer: Set Base URL** to choose one for the current workspace.
- Anything other than `GET`, `HEAD` or `OPTIONS` asks for confirmation before it is sent to a server that is not on your machine.
- Redirects are shown, not followed.

## Run it

```bash
npm install
```

Then press F5 in VS Code. A second window opens on the `examples/` folder with the Route Explorer icon in the activity bar.

## Develop

```bash
npm test
```

```bash
npm run watch
```

The scanners in `src/scanner/` do not import `vscode`, so the tests run in plain Node against the apps in `examples/`.

| Path | Purpose |
| --- | --- |
| `src/scanner/next.ts` | Next.js file-path rules and route handler exports |
| `src/scanner/express.ts` | Express route and mount extraction for one file |
| `src/scanner/index.ts` | Workspace scan and cross-file mount resolution |
| `src/routeTree.ts` | Sidebar tree |
| `src/request.ts` | Path parameters, URL building, sending and formatting (no `vscode` import) |
| `src/sendTestRequest.ts` | Prompts and output for a test request |
| `src/extension.ts` | Activation, commands, file watching |

## Known gaps

- Express routes registered on a parameter (`module.exports = (app) => { app.get(...) }`) are not found.
- Express routers re-exported through an index file are not followed.
- Paths built from variables or template expressions are skipped.
- Every change triggers a full rescan; large workspaces need incremental scanning.
- Test requests use one base URL per workspace, so a monorepo with servers on different ports needs it switched by hand.
- Test requests cannot set custom headers, query strings or authentication yet.

## Ideas for next

- Headers, query strings and saved auth tokens for test requests; a base URL per app.
- Nest the tree by path segment, and group by app in monorepos.
- More frameworks: Fastify, Hono, NestJS, SvelteKit, Remix.
- Search and filter by method.

## Package and publish

Build an installable `.vsix` file:

```bash
npm run package
```

Install it locally from the Extensions view (**…** menu, **Install from VSIX**) to try the packaged build.

To publish, create a publisher at https://marketplace.visualstudio.com/manage whose ID matches `publisher` in `package.json`, create a personal access token with the Marketplace "Manage" scope, then run `npx @vscode/vsce login <publisher>` and `npx @vscode/vsce publish`.
