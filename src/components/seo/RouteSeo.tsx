import { Helmet } from "react-helmet-async";
import { useLocation } from "react-router-dom";

const SITE_ORIGIN = "https://matbex.com";
const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/og-image.png`;

interface RouteSeoProps {
  title: string;
  description: string;
  /** Override pathname (e.g. for canonicalising dynamic params). Defaults to current location. */
  path?: string;
  ogType?: "website" | "article" | "product";
  image?: string;
  noindex?: boolean;
}

/**
 * Self-referencing canonical + route-specific og:url/og:title/og:description.
 * Drop into any route to override the static index.html head per-page.
 */
export function RouteSeo({
  title,
  description,
  path,
  ogType = "website",
  image,
  noindex,
}: RouteSeoProps) {
  const location = useLocation();
  const pathname = (path ?? location.pathname) || "/";
  const url = `${SITE_ORIGIN}${pathname === "/" ? "/" : pathname.replace(/\/+$/, "")}`;
  const ogImage = image ?? DEFAULT_OG_IMAGE;

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      <meta property="og:type" content={ogType} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:site_name" content="Matbex" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:url" content={url} />
      <meta name="twitter:image" content={ogImage} />
      {noindex && <meta name="robots" content="noindex, follow" />}
    </Helmet>
  );
}
