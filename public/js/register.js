// The transaction register: 100 rows at a time (lazy-loaded), optionally filtered by payee.
// The page provides #payeeq, #payeelist, #filterchip, #txbody and #txmore; the filter resets when the scope changes.
import { $, esc, api } from "/shared.js";

let observer = null, seq = 0, currentId = null, filter = { payee: "", q: "" };

const scopeParams = (id) => id.startsWith("o:") ? "owner=" + encodeURIComponent(id.slice(2)) : "account=" + encodeURIComponent(id);
const txUrl = (id, cursor) => "/api/transactions?limit=100&" + scopeParams(id) +
  (filter.payee ? "&payee=" + encodeURIComponent(filter.payee) : "") + (filter.q ? "&q=" + encodeURIComponent(filter.q) : "") +
  (cursor ? `&before_date=${encodeURIComponent(cursor.date)}&before_id=${encodeURIComponent(cursor.id)}` : "");

// Fetch further pages as the sentinel nears the viewport.
function lazyLoad(id, mySeq, first, row) {
  const sentinel = $("#txmore"), body = $("#txbody");
  let next = first.next, loaded = first.rows.length, loading = false;
  const status = () => { sentinel.textContent = next ? "" : loaded ? `${loaded.toLocaleString()} transaction${loaded === 1 ? "" : "s"}` : ""; };
  status();
  if (!next) return;
  async function more() {
    if (!next || loading) return;
    loading = true; sentinel.textContent = "Loading…";
    try {
      const page = await api(txUrl(id, next));
      if (mySeq !== seq) return;
      body.insertAdjacentHTML("beforeend", page.rows.map(row).join(""));
      loaded += page.rows.length; next = page.next; status();
    } catch {
      if (mySeq === seq) sentinel.innerHTML = `Couldn't load more. <a href="#" id="retry">Retry</a>`;
      $("#retry")?.addEventListener("click", (ev) => { ev.preventDefault(); loading = false; more(); });
      return;
    } finally { loading = false; }
    // Re-observe so a sentinel that is still in view (short page / tall window) triggers the next load.
    if (next && mySeq === seq) { observer.unobserve(sentinel); observer.observe(sentinel); } else observer.disconnect();
  }
  observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) more(); }, { rootMargin: "400px" });
  observer.observe(sentinel);
}

// Typeahead listing distinct payees with counts. Enter on a highlighted payee filters to exactly that payee;
// Enter with plain text filters to any transaction containing it.
function wireSearch(id, reload) {
  const input = $("#payeeq"), list = $("#payeelist");
  let options = [], active = -1, timer = 0, requestSeq = 0;
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; input.removeAttribute("aria-activedescendant"); };
  const mark = (name, q) => {
    const i = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1;
    return i < 0 ? esc(name) : esc(name.slice(0, i)) + "<mark>" + esc(name.slice(i, i + q.length)) + "</mark>" + esc(name.slice(i + q.length));
  };
  const setActive = (i) => {
    active = i;
    list.querySelectorAll(".popt").forEach((el, n) => { el.classList.toggle("active", n === i); el.setAttribute("aria-selected", n === i); });
    if (i >= 0) { input.setAttribute("aria-activedescendant", "popt" + i); list.querySelector("#popt" + i)?.scrollIntoView({ block: "nearest" }); }
    else input.removeAttribute("aria-activedescendant");
  };
  const apply = (next) => { filter = next; input.value = ""; close(); renderChip(reload); reload(); };
  async function refresh() {
    const q = input.value.trim(), mine = ++requestSeq;
    let data; try { data = await api(`/api/payees?limit=12&${scopeParams(id)}&q=${encodeURIComponent(q)}`); } catch { return; }
    if (mine !== requestSeq) return;
    options = data.payees; active = -1;
    list.innerHTML = options.map((p, n) => `<div class="popt" role="option" id="popt${n}" data-n="${n}" aria-selected="false"><span>${mark(p.payee, q)}</span><span class="n">${p.count.toLocaleString()}</span></div>`).join("") +
      (data.total > options.length ? `<div class="pnote">${(data.total - options.length).toLocaleString()} more — keep typing to narrow</div>` : "") +
      (!options.length ? `<div class="pnote">No matching payees${q ? ` — press Enter to search “${esc(q)}”` : ""}</div>` : "");
    list.hidden = false; input.setAttribute("aria-expanded", "true");
    list.querySelectorAll(".popt").forEach((el) => el.onmousedown = (ev) => { ev.preventDefault(); apply({ payee: options[+el.dataset.n].payee, q: "" }); });
  }
  input.oninput = () => { clearTimeout(timer); timer = setTimeout(refresh, 120); };
  input.onfocus = refresh;
  input.onblur = close;
  input.onkeydown = (ev) => {
    if (ev.key === "ArrowDown") { ev.preventDefault(); if (list.hidden) return refresh(); setActive(Math.min(active + 1, options.length - 1)); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setActive(Math.max(active - 1, 0)); }
    else if (ev.key === "Enter") { ev.preventDefault(); const q = input.value.trim(); if (active >= 0) apply({ payee: options[active].payee, q: "" }); else if (q) apply({ payee: "", q }); }
    else if (ev.key === "Escape") { if (!list.hidden) close(); else input.value = ""; }
  };
}

function renderChip(reload) {
  const label = filter.payee ? `Payee: <b>${esc(filter.payee)}</b>` : filter.q ? `Contains: <b>${esc(filter.q)}</b>` : "";
  $("#filterchip").innerHTML = label ? `<span class="chip">${label}<button aria-label="Clear filter" id="clearfilter">×</button></span>` : "";
  if (label) $("#clearfilter").onclick = () => { filter = { payee: "", q: "" }; renderChip(reload); reload(); };
}

/** Load the first page into the register and wire up search and lazy loading. `columns` sizes the empty-state row. */
export async function mountRegister({ id, row, columns }) {
  if (currentId !== id) { filter = { payee: "", q: "" }; currentId = id; }
  async function reload() {
    observer?.disconnect();
    const mine = ++seq;
    $("#txmore").textContent = "Loading…";
    let first;
    try { first = await api(txUrl(id, null)); }
    catch (e) { if (mine === seq) $("#txmore").textContent = "Couldn't load transactions: " + e.message; return; }
    if (mine !== seq) return; // a newer request superseded this one
    $("#txbody").innerHTML = first.rows.map(row).join("") ||
      `<tr><td colspan="${columns}" class="muted">${filter.payee || filter.q ? "No matching transactions." : "No transactions yet."}</td></tr>`;
    lazyLoad(id, mine, first, row);
  }
  observer?.disconnect();
  wireSearch(id, reload); renderChip(reload);
  await reload();
}
