"use client";

/**
 * HouseholdContext — session-scoped household bootstrap.
 *
 * On first authenticated render:
 *  1. Reads `v_my_active_household` (via Supabase JS — no FastAPI).
 *  2. If empty  → sets status to 'unprovisioned', triggering AccountTypePickerDialog.
 *  3. If found  → caches householdId silently.
 *
 * Retries up to MAX_RETRIES times with exponential back-off on transient errors.
 * Permanent failure surfaces a banner via `status = 'error'`.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AccountType = "individual" | "joint";

export type HouseholdStatus =
  | "idle"
  | "loading"
  | "provisioned"
  | "unprovisioned"
  | "error";

export interface HouseholdState {
  /** Current bootstrap status. */
  status: HouseholdStatus;
  /** The active household UUID once provisioned, otherwise null. */
  householdId: string | null;
  /** Permanent error message after MAX_RETRIES exhausted. */
  errorMessage: string | null;
  /** Re-run the bootstrap (e.g. after dialog submission). */
  retriggerBootstrap: () => void;
  /** Call this with the chosen account type to call ensure_household RPC. */
  provisionHousehold: (accountType: AccountType) => Promise<void>;
  /** Signed-in user email (null if not yet loaded). */
  userEmail: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 800;

// ── Context ───────────────────────────────────────────────────────────────────

const HouseholdContext = createContext<HouseholdState | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

/**
 * Wrap the authenticated shell (MainLayout or app root) with this provider.
 * It must only mount inside a client component tree.
 */
export function HouseholdProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<HouseholdStatus>("idle");
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Prevent concurrent bootstrap runs
  const runningRef = useRef(false);
  // Trigger counter — incrementing forces a re-run
  const [trigger, setTrigger] = useState(0);

  const retriggerBootstrap = useCallback(() => {
    runningRef.current = false;
    setStatus("idle");
    setTrigger((n) => n + 1);
  }, []);

  const provisionHousehold = useCallback(
    async (accountType: AccountType): Promise<void> => {
      setStatus("loading");
      const { data, error } = await supabaseBrowser.rpc("ensure_household", {
        p_account_type: accountType,
      });
      if (error || !data) {
        setStatus("error");
        setErrorMessage(
          error?.message ?? "Failed to provision household. Please try again."
        );
        return;
      }
      setHouseholdId(data as string);
      setStatus("provisioned");
      setErrorMessage(null);
    },
    []
  );

  useEffect(() => {
    if (runningRef.current) return;
    runningRef.current = true;

    let cancelled = false;

    async function bootstrap() {
      // Load signed-in user email
      const {
        data: { user },
      } = await supabaseBrowser.auth.getUser();
      if (cancelled) return;

      if (!user) {
        // Not authenticated — middleware will redirect; stay idle
        runningRef.current = false;
        return;
      }
      setUserEmail(user.email ?? null);

      setStatus("loading");

      let attempt = 0;
      while (attempt < MAX_RETRIES) {
        attempt += 1;
        try {
          const { data, error } = await supabaseBrowser
            .from("v_my_active_household")
            .select("id")
            .maybeSingle();

          if (cancelled) return;

          if (error) throw error;

          if (data?.id) {
            setHouseholdId(data.id as string);
            setStatus("provisioned");
            return;
          }

          // No household row — show picker dialog
          setStatus("unprovisioned");
          return;
        } catch (err) {
          if (cancelled) return;
          if (attempt >= MAX_RETRIES) {
            const msg =
              err instanceof Error
                ? err.message
                : "Unknown error during household bootstrap";
            setStatus("error");
            setErrorMessage(msg);
            return;
          }
          // Exponential back-off: 800ms, 1600ms, 3200ms
          await new Promise((r) =>
            setTimeout(r, BASE_DELAY_MS * Math.pow(2, attempt - 1))
          );
        }
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  // trigger is the only intentional dependency; runningRef is stable
  }, [trigger]);

  const value: HouseholdState = {
    status,
    householdId,
    errorMessage,
    retriggerBootstrap,
    provisionHousehold,
    userEmail,
  };

  return (
    <HouseholdContext.Provider value={value}>
      {children}
    </HouseholdContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Consume the household bootstrap state.
 * Must be used inside a <HouseholdProvider>.
 */
export function useHousehold(): HouseholdState {
  const ctx = useContext(HouseholdContext);
  if (!ctx) {
    throw new Error("useHousehold must be used inside <HouseholdProvider>");
  }
  return ctx;
}
