import { Route } from './scanner/types';

type RoutePath = Pick<Route, 'framework' | 'path'>;

export interface PathParam {
  /** Name to show the user and to key values by. */
  name: string;
  /** The exact text in the route path, e.g. `:id` or `[...slug]`. */
  token: string;
  /** True if the route also matches without this segment. */
  optional: boolean;
  /** True if the value may span several path segments. */
  catchAll: boolean;
}

export interface TestRequest {
  method: string;
  url: string;
  /** JSON text to send as the request body. */
  body?: string;
  timeoutMs?: number;
}

export interface TestResponse {
  status: number;
  statusText: string;
  headers: [name: string, value: string][];
  body: string;
  durationMs: number;
}

// [[...slug]] | [...slug] | [id]
const NEXT_PARAM = /\[\[\.\.\.([^\]]+)\]\]|\[\.\.\.([^\]]+)\]|\[([^\]]+)\]/g;
// :id, :id(\d+), :id? | *, *name
const EXPRESS_PARAM = /:(\w+)(?:\([^)]*\))?(\?)?|\*(\w*)/g;

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BODY_CHARS = 100_000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Lists the dynamic segments of a route path, in order. */
export function pathParams(route: RoutePath): PathParam[] {
  if (route.framework === 'next') {
    return [...route.path.matchAll(NEXT_PARAM)].map((match) => ({
      token: match[0],
      name: match[1] ?? match[2] ?? match[3],
      optional: match[1] !== undefined,
      catchAll: match[3] === undefined,
    }));
  }
  return [...route.path.matchAll(EXPRESS_PARAM)].map((match) => ({
    token: match[0],
    name: match[1] ?? (match[3] || 'wildcard'),
    optional: match[2] !== undefined,
    catchAll: match[1] === undefined,
  }));
}

/** Replaces each dynamic segment with its value, URL-encoded. Throws if a required value is missing. */
export function fillPath(route: RoutePath, values: Readonly<Record<string, string>>): string {
  let path = route.path;
  for (const param of pathParams(route)) {
    const value = values[param.name] ?? '';
    if (!value && !param.optional) {
      throw new Error(`Missing value for ${param.token}`);
    }
    const encoded = param.catchAll
      ? value.split('/').filter(Boolean).map(encodeURIComponent).join('/')
      : encodeURIComponent(value);
    path = path.replace(param.token, () => encoded);
  }
  const cleaned = path.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}

/** Joins a base URL such as `http://localhost:3000` with a route path. Throws if the base URL is invalid. */
export function buildUrl(baseUrl: string, path: string): string {
  const base = new URL(baseUrl.trim());
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new Error('The base URL must start with http:// or https://');
  }
  return `${base.origin}${base.pathname.replace(/\/+$/, '')}${path}`;
}

/** True if the URL points at this machine, where a test request cannot touch real data elsewhere. */
export function isLocalUrl(url: string): boolean {
  const { hostname } = new URL(url);
  return LOCAL_HOSTS.has(hostname) || hostname.endsWith('.localhost');
}

/** Sends the request and reads the whole response. Redirects are reported, not followed. */
export async function sendRequest(request: TestRequest): Promise<TestResponse> {
  const hasBody = request.body !== undefined && request.body !== '';
  const started = performance.now();
  const response = await fetch(request.url, {
    method: request.method,
    headers: hasBody ? { 'content-type': 'application/json' } : undefined,
    body: hasBody ? request.body : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  const body = await response.text();
  const headers: [string, string][] = [];
  response.headers.forEach((value, name) => headers.push([name, value]));
  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    body,
    durationMs: performance.now() - started,
  };
}

/** Renders a response as plain text: request line, status, headers, then the body. */
export function formatResponse(request: TestRequest, response: TestResponse): string {
  const contentType = response.headers.find(([name]) => name === 'content-type')?.[1] ?? '';
  let body = response.body;
  if (contentType.includes('json')) {
    try {
      body = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      // not valid JSON despite the header: show it as received
    }
  }
  if (body.length > MAX_BODY_CHARS) {
    body = `${body.slice(0, MAX_BODY_CHARS)}\n… truncated (${body.length} characters in total)`;
  }
  return [
    `${request.method} ${request.url}`,
    `${response.status} ${response.statusText}`.trim() + ` in ${Math.round(response.durationMs)} ms`,
    '',
    ...response.headers.map(([name, value]) => `${name}: ${value}`),
    '',
    body || '(empty body)',
  ].join('\n');
}

/** Turns a failed request into a message that says what to do about it. */
export function describeFailure(error: unknown, url: string): string {
  const { origin } = new URL(url);
  if (error instanceof Error && error.name === 'TimeoutError') {
    return `No response from ${origin} within the time limit.`;
  }
  const code = (error as { cause?: { code?: string } } | undefined)?.cause?.code;
  if (code === 'ECONNREFUSED') {
    return `Nothing is listening at ${origin}. Start your server or change the base URL.`;
  }
  const reason = code ?? (error instanceof Error ? error.message : String(error));
  return `Request to ${origin} failed: ${reason}`;
}
