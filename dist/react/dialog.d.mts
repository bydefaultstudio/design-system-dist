/* @bydefaultstudio/design-system v4.7.0 */
import * as React from 'react';

/** `detail.source` on a guarded close: what asked the surface to close. */
export type DialogHideSource = 'close-button' | 'backdrop' | 'escape';

export interface DialogProps {
  /** React owns visibility. Setting this false is a programmatic close and
   * deliberately bypasses the `dialog-hide` guard. */
  open?: boolean;
  /** Fires on a user-driven close — Escape, the backdrop, the close button.
   * Not for the close that follows setting `open` to false. */
  onClose?: () => void;
  /** The cancellable `dialog-hide` event. `preventDefault()` keeps it open. */
  onHide?: (event: CustomEvent<{ source: DialogHideSource }>) => void;
  /** Renders the header, the title and the close button. Without it there is
   * no header — supply `aria-label` and your own dismiss control. */
  title?: React.ReactNode;
  footer?: React.ReactNode;
  /** Match the surrounding page outline; the class carries the styling. */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Opt out of closing on a backdrop press. */
  static?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
  children?: React.ReactNode;
}

export declare const Dialog: React.ForwardRefExoticComponent<
  DialogProps & React.RefAttributes<HTMLDialogElement>
>;
