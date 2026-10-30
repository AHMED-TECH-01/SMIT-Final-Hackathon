/**
 * Vercel Function entry point — the only file allowed in this directory.
 *
 * The filename is the route: Vercel maps `api/[...path].js` to `/api/*` and
 * forwards the original URL, which is what the Express app expects because it
 * mounts its routers under `/api/v1`.
 *
 * `api/` is a reserved directory on Vercel: every file found inside it becomes a
 * Serverless Function, and the Hobby plan caps a deployment at 12. The backend
 * therefore lives in `server/` (64 source files, 126 compiled ones) and only this
 * shim sits here — that limit is exactly what failed the first three deployments.
 *
 * It re-exports the compiled handler rather than the TypeScript source, so the
 * exact code that `npm run build` produced (and that `npm run start` runs) is
 * what serves production traffic. The build command runs before Vercel traces
 * this function, so `server/dist/` exists by then even though it is never
 * committed.
 */
export { default } from '../server/dist/vercel-handler.js'
