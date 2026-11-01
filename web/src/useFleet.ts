import { useEffect, useState } from "react";
import type { FleetState } from "./types";

export type Link = "connecting" | "live" | "lost";

/** The fleet state, pushed by the server over SSE; reconnects on its own. */
export function useFleet() {
  const [state, setState] = useState<FleetState | null>(null);
  const [link, setLink] = useState<Link>("connecting");
  const [lastAt, setLastAt] = useState(0);

  useEffect(() => {
    const source = new EventSource("/api/stream");
    source.onopen = () => setLink("live");
    source.onerror = () => setLink("lost");
    // The first frame is the whole state; then patches carry only the parts that changed (telemetry per member).
    source.onmessage = (e) => {
      try {
        setState(JSON.parse(e.data) as FleetState);
        setLastAt(Date.now());
        setLink("live");
      } catch {
        // Ignore a frame we cannot read; the next one replaces it.
      }
    };
    // The server pings when nothing changed, so a quiet fleet is not mistaken for a lost link.
    source.addEventListener("ping", () => {
      setLastAt(Date.now());
      setLink("live");
    });
    source.addEventListener("patch", (e) => {
      try {
        const { rev, serverTime, patch } = JSON.parse((e as MessageEvent<string>).data) as { rev: number; serverTime: string; patch: Partial<FleetState> };
        setState((prev) => (prev ? { ...prev, ...patch, rev, serverTime, telemetry: patch.telemetry ? { ...prev.telemetry, ...patch.telemetry } : prev.telemetry } : prev));
        setLastAt(Date.now());
        setLink("live");
      } catch {
        // A patch we cannot read leaves the state as it was; reconnecting sends it whole again.
      }
    });
    return () => source.close();
  }, []);

  return { state, link, lastAt };
}

/** Wall clock that ticks every second, for countdowns and "ago" labels. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
