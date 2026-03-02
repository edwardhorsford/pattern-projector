// app/api/ping/route.ts
// Lightweight endpoint used by DevServerMonitor to check if the dev server is alive.

export function GET() {
  return new Response(null, { status: 204 })
}
