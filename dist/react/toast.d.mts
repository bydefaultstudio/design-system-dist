/* @bydefaultstudio/design-system v4.7.0 */
export type ToastType = 'default' | 'success' | 'warning' | 'danger' | 'info';

/**
 * Toast ships as a function, not a component: toast.js owns its own DOM.
 * Call it from a client component — imported into a Server Component it
 * becomes a non-callable client reference.
 */
export declare function showToast(message: string, type?: ToastType, duration?: number): void;
