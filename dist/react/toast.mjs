'use client';
/* @bydefaultstudio/design-system v4.8.0 */
/**
 * showToast — React bridge to the Toast module (cms/toast.md).
 *
 * Toast ships as a function, not a component: toast.js owns its DOM
 * outright — it builds the live-region container, appends and removes
 * toasts, reparents into an open modal — so a component would have
 * nothing to render. This wrapper exists so React code imports its toast
 * from the same package as every other adapter, and gets a plain answer
 * when the module is missing instead of a TypeError.
 */
import { warnOnce } from './internal.mjs';

export function showToast(message, type, duration) {
  if (typeof window === 'undefined') return;
  if (typeof window.showToast !== 'function') {
    warnOnce('showToast: toast.js is not loaded — nothing will appear. Load the module (see cms/react.md).');
    return;
  }
  window.showToast(message, type, duration);
}
