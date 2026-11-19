import * as vscode from 'vscode';
import { Framework, Route } from './scanner/types';

const FRAMEWORK_LABELS: Record<Framework, string> = {
  next: 'Next.js',
  express: 'Express',
};

export interface GroupNode {
  type: 'group';
  framework: Framework;
  routes: Route[];
}

export interface RouteNode {
  type: 'route';
  route: Route;
}

export type TreeNode = GroupNode | RouteNode;

export class RouteTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly changed = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this.changed.event;
  private routes: Route[] = [];

  setRoutes(routes: Route[]): void {
    this.routes = routes;
    this.changed.fire();
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!node) {
      return (Object.keys(FRAMEWORK_LABELS) as Framework[])
        .map((framework): GroupNode => ({
          type: 'group',
          framework,
          routes: this.routes.filter((route) => route.framework === framework),
        }))
        .filter((group) => group.routes.length > 0);
    }
    return node.type === 'group' ? node.routes.map((route): RouteNode => ({ type: 'route', route })) : [];
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.type === 'group') {
      const item = new vscode.TreeItem(FRAMEWORK_LABELS[node.framework], vscode.TreeItemCollapsibleState.Expanded);
      item.description = `${node.routes.length}`;
      item.contextValue = 'group';
      return item;
    }

    const { route } = node;
    const label = route.kind === 'page' ? route.path : `${route.method} ${route.path}`;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = vscode.workspace.asRelativePath(route.file);
    item.tooltip = `${label}\n${route.file}:${route.line + 1}`;
    item.iconPath = new vscode.ThemeIcon(route.kind === 'page' ? 'browser' : 'plug');
    item.contextValue = 'route';
    item.command = { command: 'routeExplorer.openRoute', title: 'Open Route', arguments: [route] };
    return item;
  }
}
