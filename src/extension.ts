import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { RouteTreeProvider, TreeNode } from './routeTree';
import { scanRoutes } from './scanner';
import { Route } from './scanner/types';
import { promptBaseUrl, sendTestRequest } from './sendTestRequest';

const SOURCE_GLOB = '**/*.{ts,tsx,js,jsx,mjs,cjs}';
const MANIFEST_GLOB = '**/package.json';
const EXCLUDE_GLOB = '**/{node_modules,.next,.git,.turbo,.vercel,dist,build,out,coverage}/**';
const MAX_SOURCE_FILES = 5000;
const REFRESH_DELAY_MS = 400;

async function scanWorkspace(): Promise<Route[]> {
  const [sources, manifests] = await Promise.all([
    vscode.workspace.findFiles(SOURCE_GLOB, EXCLUDE_GLOB, MAX_SOURCE_FILES),
    vscode.workspace.findFiles(MANIFEST_GLOB, EXCLUDE_GLOB),
  ]);
  return scanRoutes({
    files: [...sources, ...manifests].map((uri) => uri.fsPath),
    readFile: (file) => {
      try {
        return fs.readFileSync(file, 'utf8');
      } catch {
        return undefined;
      }
    },
  });
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new RouteTreeProvider();
  const view = vscode.window.createTreeView('routeExplorer.routes', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  // The "no routes found" welcome text is hidden until the first scan has finished.
  let scanned = false;
  const refresh = async (): Promise<void> => {
    if (!scanned) {
      view.message = 'Scanning workspace…';
    }
    try {
      const routes = await scanWorkspace();
      provider.setRoutes(routes);
      view.description = routes.length > 0 ? `${routes.length} routes` : undefined;
    } finally {
      if (!scanned) {
        scanned = true;
        view.message = undefined;
        await vscode.commands.executeCommand('setContext', 'routeExplorer.scanned', true);
      }
    }
  };

  let pending: NodeJS.Timeout | undefined;
  const scheduleRefresh = (): void => {
    clearTimeout(pending);
    pending = setTimeout(() => void refresh(), REFRESH_DELAY_MS);
  };

  const watchers = [SOURCE_GLOB, MANIFEST_GLOB].map((glob) => {
    const watcher = vscode.workspace.createFileSystemWatcher(glob);
    watcher.onDidCreate(scheduleRefresh);
    watcher.onDidChange(scheduleRefresh);
    watcher.onDidDelete(scheduleRefresh);
    return watcher;
  });

  const output = vscode.window.createOutputChannel('Route Explorer');

  context.subscriptions.push(
    view,
    output,
    ...watchers,
    vscode.commands.registerCommand('routeExplorer.sendRequest', async (node?: TreeNode) => {
      if (node?.type === 'route') {
        await sendTestRequest(node.route, context.workspaceState, output);
      }
    }),
    vscode.commands.registerCommand('routeExplorer.setBaseUrl', () => promptBaseUrl(context.workspaceState)),
    { dispose: () => clearTimeout(pending) },
    vscode.workspace.onDidChangeWorkspaceFolders(scheduleRefresh),
    vscode.commands.registerCommand('routeExplorer.refresh', refresh),
    vscode.commands.registerCommand('routeExplorer.openRoute', async (route: Route) => {
      const position = new vscode.Position(route.line, 0);
      await vscode.window.showTextDocument(vscode.Uri.file(route.file), {
        selection: new vscode.Range(position, position),
      });
    }),
    vscode.commands.registerCommand('routeExplorer.copyPath', async (node?: TreeNode) => {
      if (node?.type === 'route') {
        await vscode.env.clipboard.writeText(node.route.path);
      }
    }),
  );

  void refresh();
}

export function deactivate(): void {}
