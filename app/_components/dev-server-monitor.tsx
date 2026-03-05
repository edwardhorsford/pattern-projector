// app/_components/dev-server-monitor.tsx
// Shows a warning overlay in development when the Next.js dev server stops responding.

"use client";

import { useEffect, useState } from "react";

const POLL_INTERVAL_MS = 3000;
const FAILURE_THRESHOLD = 2;

/**
 * Polls /api/ping in development mode and shows a full-screen warning when
 * the dev server stops responding. Has no effect in production builds.
 */
export default function DevServerMonitor() {
  if (process.env.NODE_ENV !== "development") return null;
  return <DevServerMonitorInner />;
}

function DevServerMonitorInner() {
  const [serverDown, setServerDown] = useState(false);

  useEffect(() => {
    let failureCount = 0;
    let cancelled = false;

    async function ping() {
      if (cancelled) return;

      try {
        // Any HTTP response means the server is up — only a network error means it's gone.
        await fetch(window.location.origin + "/", {
          method: "HEAD",
          cache: "no-store",
        })
        failureCount = 0
        setServerDown(false)
      } catch {
        failureCount++;
      }

      if (failureCount >= FAILURE_THRESHOLD) {
        setServerDown(true);
      }

      if (!cancelled) {
        setTimeout(ping, POLL_INTERVAL_MS);
      }
    }

    const timerId = setTimeout(ping, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimeout(timerId);
    };
  }, []);

  if (!serverDown) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        fontFamily: "monospace",
      }}
    >
      <div
        style={{
          backgroundColor: "#1a1a1a",
          border: "1px solid #444",
          borderRadius: "8px",
          padding: "2rem 2.5rem",
          maxWidth: "400px",
          textAlign: "center",
          color: "#fff",
        }}
      >
        <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>⚠️</div>
        <h2
          style={{
            fontSize: "1.1rem",
            fontWeight: 600,
            marginBottom: "0.5rem",
            color: "#a855f7",
          }}
        >
          Dev server not running
        </h2>
        <p style={{ fontSize: "0.85rem", color: "#aaa", margin: 0 }}>
          The Next.js dev server isn&apos;t responding. Run{" "}
          <code
            style={{
              backgroundColor: "#2a2a2a",
              padding: "0.1em 0.4em",
              borderRadius: "3px",
              color: "#fff",
            }}
          >
            npm run dev
          </code>{" "}
          to restart it.
        </p>
      </div>
    </div>
  );
}
