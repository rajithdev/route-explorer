import * as vscode from 'vscode';
import {
  buildUrl,
  describeFailure,
  fillPath,
  formatResponse,
  isLocalUrl,
  pathParams,
  sendRequest,
  TestRequest,
} from './request';
import { Route } from './scanner/types';

const BASE_URL_KEY = 'routeExplorer.baseUrl';
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const PICKABLE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const SEPARATOR = '─'.repeat(60);

/** The base URL chosen for this workspace, falling back to the `routeExplorer.baseUrl` setting. */
function getBaseUrl(state: vscode.Memento): string {
  return (
    state.get<string>(BASE_URL_KEY) ??
    vscode.workspace.getConfiguration('routeExplorer').get<string>('baseUrl', 'http://localhost:3000')
  );
}

/** Asks where the server runs and remembers the answer for this workspace. */
export async function promptBaseUrl(state: vscode.Memento): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: 'Route Explorer: Base URL',
    prompt: 'Where is your server running? Test requests in this workspace are sent here.',
    value: getBaseUrl(state),
    ignoreFocusOut: true,
    validateInput: (input) => {
      try {
        buildUrl(input, '/');
        return undefined;
      } catch {
        return 'Enter a URL such as http://localhost:3000';
      }
    },
  });
  if (value !== undefined) {
    await state.update(BASE_URL_KEY, value.trim());
  }
}

async function pickMethod(route: Route): Promise<string | undefined> {
  if (route.method === 'PAGE') {
    return 'GET';
  }
  if (route.method === 'ALL') {
    return vscode.window.showQuickPick(PICKABLE_METHODS, {
      title: route.path,
      placeHolder: 'HTTP method to send',
    });
  }
  return route.method;
}

/** Collects path values and a body where needed, sends the request, and prints the response. */
export async function sendTestRequest(
  route: Route,
  state: vscode.Memento,
  output: vscode.OutputChannel,
): Promise<void> {
  const method = await pickMethod(route);
  if (!method) {
    return;
  }
  const title = `${method} ${route.path}`;

  const values: Record<string, string> = {};
  for (const param of pathParams(route)) {
    const value = await vscode.window.showInputBox({
      title,
      prompt: `Value for ${param.token}${param.optional ? ' (optional)' : ''}`,
      ignoreFocusOut: true,
      validateInput: (input) => (input || param.optional ? undefined : 'A value is required'),
    });
    if (value === undefined) {
      return;
    }
    values[param.name] = value;
  }

  let body: string | undefined;
  if (BODY_METHODS.has(method)) {
    body = await vscode.window.showInputBox({
      title,
      prompt: 'JSON request body (leave empty to send none)',
      placeHolder: '{"name": "Ada"}',
      ignoreFocusOut: true,
      validateInput: (input) => {
        if (!input.trim()) {
          return undefined;
        }
        try {
          JSON.parse(input);
          return undefined;
        } catch {
          return 'This is not valid JSON';
        }
      },
    });
    if (body === undefined) {
      return;
    }
  }

  let url: string;
  try {
    url = buildUrl(getBaseUrl(state), fillPath(route, values));
  } catch (error) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    return;
  }

  if (!SAFE_METHODS.has(method) && !isLocalUrl(url)) {
    const choice = await vscode.window.showWarningMessage(
      `Send ${method} to ${new URL(url).host}?`,
      { modal: true, detail: 'This is not a local server, so the request may change real data.' },
      'Send',
    );
    if (choice !== 'Send') {
      return;
    }
  }

  const request: TestRequest = { method, url, body: body?.trim() };
  try {
    const response = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: `${method} ${url}` },
      () => sendRequest(request),
    );
    output.appendLine(formatResponse(request, response));
    output.appendLine(SEPARATOR);
    output.show(true);
  } catch (error) {
    const choice = await vscode.window.showErrorMessage(describeFailure(error, url), 'Set Base URL');
    if (choice) {
      await promptBaseUrl(state);
    }
  }
}
