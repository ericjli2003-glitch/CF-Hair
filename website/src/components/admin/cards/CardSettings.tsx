"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CardSettings(props: { monthlyCap: number; pricePerCardCAD: number }) {
  const router = useRouter();
  const [cap, setCap] = useState(String(props.monthlyCap));
  const [price, setPrice] = useState(props.pricePerCardCAD.toFixed(2));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    const res = await fetch("/api/cards/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthlyCap: Number(cap), pricePerCardCAD: Number(price) }),
    });
    if (!res.ok) {
      setState("error");
      return;
    }
    setState("saved");
    router.refresh();
  }

  return (
    <form id="card-settings" onSubmit={save} className="scroll-mt-24 rounded-xl bg-paper p-5 ring-1 ring-line">
      <p className="font-medium">Card settings</p>
      <label className="label mt-4" htmlFor="card-cap">
        Monthly limit
      </label>
      <div className="flex items-center gap-2 text-sm text-ink-soft">
        <span>At most</span>
        <input
          id="card-cap"
          type="number"
          min={0}
          max={10000}
          value={cap}
          onChange={(e) => {
            setCap(e.target.value);
            setState("idle");
          }}
          className="field !w-20 !px-2 !py-2 text-center"
        />
        <span>cards approved per calendar month</span>
      </div>
      <label className="label mt-4" htmlFor="card-price">
        Price per card
      </label>
      <div className="flex items-center gap-2 text-sm text-ink-soft">
        <span>$</span>
        <input
          id="card-price"
          type="number"
          min={0}
          max={1000}
          step="0.01"
          value={price}
          onChange={(e) => {
            setPrice(e.target.value);
            setState("idle");
          }}
          className="field !w-24 !px-2 !py-2 text-center"
        />
        <span>CAD, card, writing and stamp</span>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button disabled={state === "saving"} className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm text-paper hover:bg-primary-hover disabled:opacity-50">
          {state === "saving" ? "Saving..." : "Save"}
        </button>
        {state === "saved" && <span className="text-sm text-primary">Saved</span>}
        {state === "error" && <span className="text-sm text-alert">Use whole cards for the limit and a price like 8.50.</span>}
      </div>
    </form>
  );
}
