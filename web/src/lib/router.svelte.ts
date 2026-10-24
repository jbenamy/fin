// Client-side routing over clean URLs (/accounts, /connections, ...). The server serves the app for each of them.

export const route = $state({ path: location.pathname, hash: location.hash });

window.addEventListener("popstate", () => { route.path = location.pathname; route.hash = location.hash; });

/** Go to an in-app address without reloading. */
export function navigate(href: string, replace = false) {
  const url = new URL(href, location.href);
  history[replace ? "replaceState" : "pushState"]({}, "", url.pathname + url.search + url.hash);
  route.path = url.pathname; route.hash = url.hash;
  if (!replace) window.scrollTo(0, 0);
}

/** Let plain <a href="/..."> links navigate in-app (modifier clicks and new tabs behave as usual). */
export function interceptLinks(ev: MouseEvent) {
  if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
  const a = (ev.target as Element).closest("a");
  if (!a || a.target || a.origin !== location.origin || a.hasAttribute("download")) return;
  ev.preventDefault();
  navigate(a.href);
}
