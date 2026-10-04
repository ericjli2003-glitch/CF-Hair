"use client";

import { useEffect, useRef, type RefObject } from "react";

// Modal behaviour for the site's overlays (admin booking and call drawers, the
// public phone menu). They render in place, inside the page tree, so instead of
// <dialog> + showModal() (which would need moving them to the top layer and
// rewriting their open/close flow, including the URL-driven call drawer) the
// rest of the page is made `inert`: it cannot be focused, clicked or read while
// the overlay is open. Tab and Shift+Tab also wrap inside the overlay, Escape
// closes it, and focus goes back to whatever opened it.

type Node = { parentElement: Node | null; children: ArrayLike<unknown>; inert?: boolean };

/**
 * Sets `inert` on every element outside `el` (each sibling of `el` and of each
 * of its ancestors, up to `root`) and returns a function that undoes exactly
 * those changes. Elements that were already inert are left alone.
 */
export function inertOutside(el: Node, root: Node): () => void {
  const changed: Node[] = [];
  for (let node: Node | null = el; node && node !== root; node = node.parentElement) {
    const parent: Node | null = node.parentElement;
    if (!parent) break;
    for (const sib of Array.from(parent.children) as Node[]) {
      if (sib === node || sib.inert) continue;
      sib.inert = true;
      changed.push(sib);
    }
  }
  return () => {
    for (const s of changed) s.inert = false;
  };
}

/**
 * Where Tab should go when focus would leave the overlay: from the last item to
 * the first, or (Shift+Tab) from the first to the last. Null means let the
 * browser move focus normally.
 */
export function wrapTarget<T>(items: T[], active: T | null, shift: boolean): T | null {
  if (!items.length) return null;
  const first = items[0];
  const last = items[items.length - 1];
  const inside = active !== null && items.includes(active);
  if (shift) return !inside || active === first ? last : null;
  return !inside || active === last ? first : null;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function focusables(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.getClientRects().length > 0);
}

/**
 * While `open`, makes `ref` behave as a modal: background inert, focus moved in
 * (to the element marked `data-autofocus`, else the first focusable), Tab
 * wrapping, Escape calling `onClose`, and focus returned on close.
 */
export function useModal(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const restore = inertOutside(el, document.body);
    (el.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(el)[0] ?? el).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== "Tab") return;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const target = wrapTarget(focusables(el), active, e.shiftKey);
      if (target) {
        e.preventDefault();
        target.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restore();
      // Back to the control that opened the overlay, if it is still on the page.
      if (opener?.isConnected) opener.focus();
    };
  }, [open, ref]);
}
