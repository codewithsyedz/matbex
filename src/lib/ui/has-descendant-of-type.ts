import * as React from "react";

/**
 * Recursively walks `children` and returns true if any descendant React
 * element's `type.displayName` matches `displayName`.
 *
 * Used by Dialog/Sheet/Drawer/AlertDialog wrappers to detect whether the
 * caller already provided a Radix Description node, so the wrapper can
 * avoid injecting a duplicate sr-only fallback.
 */
export function hasDescendantOfType(
  children: React.ReactNode,
  displayName: string,
): boolean {
  let found = false;
  React.Children.forEach(children, (child) => {
    if (found) return;
    if (!React.isValidElement(child)) return;
    const type = child.type as { displayName?: string } | string | undefined;
    if (typeof type === "object" && type?.displayName === displayName) {
      found = true;
      return;
    }
    const props = child.props as { children?: React.ReactNode } | undefined;
    if (props?.children && hasDescendantOfType(props.children, displayName)) {
      found = true;
    }
  });
  return found;
}