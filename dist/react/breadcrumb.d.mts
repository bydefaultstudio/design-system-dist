/* @bydefaultstudio/design-system v7.0.0 */
import * as React from 'react';

export interface BreadcrumbItem {
  label: string;
  /** Omit for a level with nowhere to link to; it renders as plain text.
   * Ignored on the last item, which is always the current page. */
  href?: string;
}

export interface BreadcrumbProps {
  /** The trail, top level first, current page last. At least two. */
  items: BreadcrumbItem[];
  /** The nav's accessible name. Defaults to "Breadcrumb". */
  label?: string;
  className?: string;
}

export declare function Breadcrumb(props: BreadcrumbProps): React.ReactElement;
