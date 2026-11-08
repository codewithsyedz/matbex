import { memo } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { buildCrumbs } from "@/lib/routeLabels";
import { useTranslation } from "react-i18next";

/**
 * Route-derived breadcrumbs rendered once by AppLayout so every in-shell
 * page gets the same trail, in the same place, at the same height.
 */
export const PageBreadcrumbs = memo(function PageBreadcrumbs() {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const crumbs = buildCrumbs(pathname);

  if (crumbs.length <= 1) return null;

  return (
    <nav aria-label="Breadcrumb" className="container mx-auto max-w-7xl pt-4 pb-0">
      <Breadcrumb>
        <BreadcrumbList className="text-xs">
          {crumbs.map((c) => (
            <BreadcrumbItem key={c.href}>
              {c.isLast ? (
                <BreadcrumbPage className="font-normal">{t(`routes.${c.href}`, { defaultValue: c.label })}</BreadcrumbPage>
              ) : (
                <>
                  <BreadcrumbLink asChild>
                    <Link to={c.href}>{t(`routes.${c.href}`, { defaultValue: c.label })}</Link>
                  </BreadcrumbLink>
                  <BreadcrumbSeparator />
                </>
              )}
            </BreadcrumbItem>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    </nav>
  );
});
