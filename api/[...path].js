/**
 * Vercel Function entry point.
 *
 * The filename is the route: Vercel maps `api/[...path].js` to `/api/*` and
 * forwards the original URL, which is what the Express app expects because it
 * mounts its routers under `/api/v1`.
 *
 * It re-exports the compiled handler rather than the TypeScript source, so the
 * exact code that `npm run build` produced (and that `npm run start` runs) is
 * what serves production traffic. The build command runs before Vercel traces
 * this function, so `dist/` exists by then even though it is never committed.
 */
export { default } from './dist/vercel-handler.js'
