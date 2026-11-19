export type Framework = 'next' | 'express';
export type RouteKind = 'page' | 'api';

export interface Route {
  framework: Framework;
  kind: RouteKind;
  /** Upper-case HTTP method, 'ALL' for any method, or 'PAGE' for a rendered page. */
  method: string;
  /** URL path in the framework's own syntax: `/blog/[slug]` for Next.js, `/users/:id` for Express. */
  path: string;
  /** Absolute path of the file that defines the route. */
  file: string;
  /** Zero-based line of the definition inside `file`. */
  line: number;
}
