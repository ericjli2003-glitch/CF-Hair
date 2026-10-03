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
      setError(body.error === "SLOT_TAKEN" ? "That time has been booked by someone else." : "Could not update the booking.");
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
}: {
  id: string;
  status: string;
  isPast: boolean;
  onDone?: () => void;
  size?: "sm" | "md";
}) {
  const { change, busy, error } = useStatusChange();
  const cls =
    size === "sm"
      ? "rounded-full px-3 py-1.5 text-xs ring-1 transition disabled:opacity-50"
      : "rounded-full px-4 py-2.5 text-sm ring-1 transition disabled:opacity-50";
  const run = async (s: string) => {
    if (await change(id, s)) onDone?.();
  };
  const actions: { s: string; label: string; style: string }[] = [];
  if (status === "confirmed") {
    actions.push({ s: "completed", label: "Completed", style: "bg-ink text-paper ring-ink hover:bg-clay hover:ring-clay" });
    actions.push({ s: "no-show", label: "No-show", style: "bg-paper text-rose-700 ring-rose-200 hover:bg-rose-50" });
    actions.push({ s: "cancelled", label: "Cancel", style: "bg-paper text-ink-soft ring-line hover:ring-ink" });
  } else {
    actions.push({ s: "confirmed", label: status === "cancelled" ? "Reinstate" : "Undo", style: "bg-paper text-ink ring-line hover:ring-ink" });
    if (status !== "completed" && isPast) actions.push({ s: "completed", label: "Completed", style: "bg-ink text-paper ring-ink" });
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button key={a.s} type="button" disabled={!!busy} onClick={() => run(a.s)} className={`${cls} ${a.style}`}>
            {busy === id + a.s ? "..." : a.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-clay">{error}</p>}
    </div>
  );
}
