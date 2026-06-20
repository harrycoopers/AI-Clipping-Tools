// The GitHub Pages base path. Your site is served at
//   https://USERNAME.github.io/AI-Clipping-Tools/
// so in production every asset/route must be prefixed with the REPO name.
//
// 👉 If you ever rename the GitHub repository, change REPO_NAME here AND in
//    next.config.ts (they must match).
//
// process.env.NODE_ENV is inlined by Next at build time, so this works in the
// browser bundle without any runtime server.
export const REPO_NAME = "AI-Clipping-Tools";

export const BASE_PATH = process.env.NODE_ENV === "production" ? `/${REPO_NAME}` : "";

/** Prefix a public-folder asset (e.g. "/fonts/x.ttf") with the base path. */
export function asset(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_PATH}${clean}`;
}
