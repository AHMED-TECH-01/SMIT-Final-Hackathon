/**
 * Vercel Function entry point — the only file allowed in this directory.
 *
 * `api/` is a reserved directory on Vercel: every file found inside it becomes a
 * Serverless Function, and the Hobby plan caps a deployment at 12. The backend
 * therefore lives in `server/` (64 source files, 126 compiled ones) and only this
 * shim sits here — that limit is exactly what failed the first three deployments.
 *
 * Traffic reaches it through a `vercel.json` rewrite (`/api/:path*` -> `/api/index`)
 * instead of a catch-all filename. A catch-all file (`api/[...path].js`) looks like
 * the obvious choice, but on this project Vercel matched only one segment per
 * request: `/api/zzz` reached the function while `/api/v1/health` — two segments —
 * fell through to the platform's own 404, so no nested route was ever served.
 * The rewrite is verified to forward any depth, and `req.url` keeps the original
 * path, which is what the Express app needs because it mounts its routers under
 * `/api/v1`.
 *
 * It re-exports the compiled handler rather than the TypeScript source, so the
 * exact code that `npm run build` produced (and that `npm run start` runs) is
 * what serves production traffic. The build command runs before Vercel traces
 * this function, so `server/dist/` exists by then even though it is never
 * committed.
 */
import vercelHandler from '../server/dist/vercel-handler.js'

/**
 * Vercel appends the wildcard it matched as a query parameter (`?path=v1%2Fhealth`)
 * on top of the client's own query string. The API validates query objects, so the
 * injected key is removed to hand Express the exact URL the client sent.
 */
function stripRewriteParam(url) {
  const queryStart = url.indexOf('?')
  if (queryStart === -1) return url
  const kept = url
    .slice(queryStart + 1)
    .split('&')
    .filter((pair) => pair !== '' && !/^path(?:=|$)/.test(pair))
  return kept.length > 0 ? `${url.slice(0, queryStart)}?${kept.join('&')}` : url.slice(0, queryStart)
}

export default function handler(req, res) {
  req.url = stripRewriteParam(req.url)
  return vercelHandler(req, res)
}
