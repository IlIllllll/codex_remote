type BrowserLocation = Pick<Location, "href" | "origin">;

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function fileTargetFromHref(href?: string, browserLocation?: BrowserLocation): string | null {
  if (!href || href.startsWith("#")) {
    return null;
  }

  if (/^file:\/\//i.test(href)) {
    return href;
  }

  if (/^https?:\/\//i.test(href)) {
    const location = browserLocation ?? (typeof window === "undefined" ? null : window.location);
    if (!location) {
      return null;
    }
    try {
      const parsed = new URL(href, location.href);
      if (parsed.origin !== location.origin || parsed.pathname.startsWith("/api/")) {
        return null;
      }
      return `${safeDecodeURIComponent(parsed.pathname)}${parsed.hash}`;
    } catch {
      return null;
    }
  }

  if (href.startsWith("/")) {
    if (href.startsWith("/api/")) {
      return null;
    }
    return safeDecodeURIComponent(href);
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return null;
  }

  return href;
}
