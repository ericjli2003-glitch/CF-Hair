"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function useStatusChange() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function change(id: string, status: string) {
    if (status === "cancelled" && !confirm("Cancel this booking? The time will be released.")) return false;
    setBusy(id + status);
    setError("");
    const res = await fetch(`/api/bookings/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusy(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(
        body.error === "SLOT_TAKEN"
          ? "That time has been booked by someone else. Pick another time with a new booking."
          : "Could not update the booking. Check the connection and try again.",
      );
      return false;
    }
    router.refresh();
    return true;
  }
  return { change, busy, error };
}

export function StatusButtons({
  id,
  status,
  isPast,
  onDone,
  size = "md",
  who,
}: {
  id: string;
  status: string;
  isPast: boolean;
  onDone?: () => void;
  size?: "sm" | "md";
  /** The client's name, so each row's buttons have a distinct accessible name. */
  who?: string;
}) {
  const { change, busy, error } = useStatusChange();
  const cls =
    size === "sm"
      ? "inline-flex min-h-11 items-center justify-center rounded-md px-3 text-sm ring-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      : "inline-flex min-h-11 items-center justify-center rounded-md px-4 text-[0.95rem] ring-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const run = async (s: string) => {
    if (await change(id, s)) onDone?.();
  };
  const actions: { s: string; label: string; style: string }[] = [];
  if (status === "confirmed") {
    actions.push({ s: "completed", label: "Mark completed", style: "bg-primary font-medium text-paper ring-primary hover:bg-primary-hover" });
    actions.push({ s: "no-show", label: "No-show", style: "bg-paper text-alert ring-alert-line hover:bg-alert-wash" });
    // Destructive, so it sits apart from the others.
    actions.push({ s: "cancelled", label: "Cancel booking", style: "ml-auto bg-paper text-ink-soft ring-line hover:text-ink hover:ring-primary" });
  } else {
    actions.push({ s: "confirmed", label: status === "cancelled" ? "Reinstate" : "Undo", style: "bg-paper text-ink ring-line hover:ring-primary" });
    if (status !== "completed" && isPast) actions.push({ s: "completed", label: "Mark completed", style: "bg-primary font-medium text-paper ring-primary hover:bg-primary-hover" });
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button key={a.s} type="button" disabled={!!busy} aria-busy={busy === id + a.s || undefined} onClick={() => run(a.s)} className={`${cls} ${a.style}`}>
            {busy === id + a.s ? "Saving..." : a.label}
            {who && <span className="sr-only">, {who}</span>}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-2 text-sm font-medium text-alert">{error}</p>}
    </div>
  );
}
