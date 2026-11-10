// Small shared UI pieces: Excalidraw's toast, and closing a modal from its backdrop.
import { RENDERER, S } from "../state.mjs";

// Short messages in Excalidraw's own toast: errors, the connection, the agent's changes.
// Excalidraw restarts a toast's timer whenever the editor re-renders, so while
// the person works it would never close: close it on our own timer.
let toastTimer = null;
export function toast(message, { duration = 3000 } = {}) {
  if (RENDERER || !S.api?.setToast) return;
  clearTimeout(toastTimer);
  S.api.setToast({ message, closable: true, duration: Infinity });
  if (Number.isFinite(duration)) toastTimer = setTimeout(() => S.api.setToast(null), duration);
}

export const closeOnBackdrop = (onClose) => (ev) => ev.target === ev.currentTarget && onClose();
