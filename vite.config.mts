import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * The renderer only ever loads its own bundle from disk and the alarm
 * sounds embedded in it — no remote code, no remote styles, no network
 * requests of its own (connectivity checks run in the main process). The
 * policy says exactly that, so anything else is refused by the browser
 * rather than relying on nothing ever asking.
 *
 * `data:` is allowed for media because the alarm sounds are embedded as
 * data URIs; `'unsafe-inline'` for styles because the CSS is injected as
 * a stylesheet by the bundler, and style-src has no way to distinguish
 * that from an injection.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

/**
 * Production only. The dev server needs the inline module preamble that
 * @vitejs/plugin-react injects for fast refresh, which this policy would
 * block — and dev mode is not what ships. Electron's own "no CSP" console
 * warning appears in development for the same reason, and stops once the
 * app is packaged, which is exactly when this header is present.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'ipm-content-security-policy',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html.replace(
          '<head>',
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`
        ),
    },
  }
}

// A relative base is required so dist/index.html's asset paths resolve
// when the packaged app loads it over file://.
export default defineConfig({
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
})
