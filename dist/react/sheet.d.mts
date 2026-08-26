/* @bydefaultstudio/design-system v4.7.0 */
import * as React from 'react';

/** `detail.source` on a guarded close. Drawers add "drag". */
export type DrawerHideSource = 'close-button' | 'backdrop' | 'escape' | 'drag';

export type DrawerPlacement = 'start' | 'end' | 'top' | 'bottom';

export interface SheetProps {
  open?: boolean;
  /** Fires on a user-driven close — Escape, the backdrop, the close button,
   * a drag. Not for the close that follows setting `open` to false. */
  onClose?: () => void;
  onHide?: (event: CustomEvent<{ source: DrawerHideSource }>) => void;
  title?: React.ReactNode;
  footer?: React.ReactNode;
  /** Supplementary controls beside the close button. Icon-only controls here
   * need their own `aria-label`. */
  headerActions?: React.ReactNode;
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Defaults to "bottom" — the sheet shape. */
  placement?: DrawerPlacement;
  /** Drag-to-dismiss grip. Defaults on for `bottom`, off elsewhere. */
  handle?: boolean;
  /** `--drawer-size`: a width on inline edges, a height on block edges. */
  size?: string;
  static?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export declare const Sheet: React.ForwardRefExoticComponent<
  SheetProps & React.RefAttributes<HTMLDialogElement>
>;

/** The same component under the name the system doc uses (cms/drawer.md). */
export declare const Drawer: typeof Sheet;
