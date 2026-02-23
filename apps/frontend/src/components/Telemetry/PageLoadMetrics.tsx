"use client";

import { useEffect } from "react";

type PageLoadMetricsPayload = {
  path: string;
  ttfb_ms: number | null;
  dom_content_loaded_ms: number | null;
  load_event_ms: number | null;
  first_contentful_paint_ms: number | null;
  largest_contentful_paint_ms: number | null;
  timestamp: string;
};

function postMetrics(payload: PageLoadMetricsPayload) {
  const body = JSON.stringify(payload);
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon("/api/metrics/page-load", blob);
    return;
  }

  void fetch("/api/metrics/page-load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  });
}

export default function PageLoadMetrics() {
  useEffect(() => {
    let lcp = 0;
    let fcp = 0;

    const paintEntries = performance.getEntriesByType("paint");
    for (const entry of paintEntries) {
      if (entry.name === "first-contentful-paint") {
        fcp = entry.startTime;
      }
    }

    const lcpObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const lastEntry = entries[entries.length - 1];
      if (lastEntry) {
        lcp = lastEntry.startTime;
      }
    });
    lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });

    const send = () => {
      const navigationEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      postMetrics({
        path: window.location.pathname,
        ttfb_ms: navigationEntry ? navigationEntry.responseStart - navigationEntry.requestStart : null,
        dom_content_loaded_ms: navigationEntry
          ? navigationEntry.domContentLoadedEventEnd - navigationEntry.startTime
          : null,
        load_event_ms: navigationEntry ? navigationEntry.loadEventEnd - navigationEntry.startTime : null,
        first_contentful_paint_ms: fcp || null,
        largest_contentful_paint_ms: lcp || null,
        timestamp: new Date().toISOString(),
      });
      lcpObserver.disconnect();
    };

    if (document.readyState === "complete") {
      window.setTimeout(send, 0);
      return;
    }

    const onLoad = () => window.setTimeout(send, 0);
    window.addEventListener("load", onLoad, { once: true });
    return () => {
      lcpObserver.disconnect();
      window.removeEventListener("load", onLoad);
    };
  }, []);

  return null;
}
