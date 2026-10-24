// An investment account's allocation bar and holdings table (from /api/holdings), rendered into #holdings.
import { $, esc, usd, cls, api } from "/shared.js";

let seq = 0;

const pct = (n) => n == null ? "—" : (n * 100).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
const qty = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });
const signed = (n, fmt) => n == null ? "—" : (n > 0 ? "+" : "") + fmt(n);
const day = (d) => new Date(d + "T00:00:00").toLocaleDateString();

// One bar split by asset class; the legend under it doubles as the value table. Colors are fixed per class (--c<slot>).
function allocation(classes) {
  const shown = classes.filter((c) => c.value > 0 && c.pct);
  if (!shown.length) return "";
  const segs = shown.map((c) => `<span class="seg" style="flex-grow:${c.pct};background:var(--c${c.slot})" title="${esc(`${c.class}: ${usd(c.value)} (${pct(c.pct)})`)}"></span>`).join("");
  const rows = classes.map((c) => `<li><span class="sw" style="background:var(--c${c.slot})"></span><span class="cname">${esc(c.class)}</span>
    <span class="num">${usd(c.value)}</span><span class="num muted">${pct(c.pct)}</span></li>`).join("");
  return `<h2>Allocation</h2><div class="alloc" role="img" aria-label="${esc(shown.map((c) => `${c.class} ${pct(c.pct)}`).join(", "))}">${segs}</div><ul class="legend">${rows}</ul>`;
}

function table(data) {
  const hs = data.holdings;
  const hasCost = hs.some((h) => h.cost_basis != null), hasVested = hs.some((h) => h.vested_value != null && h.vested_value !== h.value);
  const price = (h) => h.price == null ? "—" : `${usd(h.price, h.currency)}${h.price_as_of ? `<small class="${h.stale ? "stale" : "muted"}">${h.stale ? "⚠ " : ""}${day(h.price_as_of)}</small>` : ""}`;
  const row = (h) => `<tr><td>${esc(h.ticker || h.name || "Unknown")}${h.ticker && h.name ? `<small class="muted">${esc(h.name)}</small>` : ""}</td>
    <td class="muted">${esc(h.class)}</td><td class="num">${qty(h.quantity)}</td><td class="num">${price(h)}</td>
    <td class="num">${usd(h.value, h.currency)}</td><td class="num muted">${pct(h.pct)}</td>
    ${hasCost ? `<td class="num">${usd(h.cost_basis, h.currency)}</td><td class="num ${cls(h.gain)}">${signed(h.gain, (n) => usd(n, h.currency))}${h.gain_pct == null ? "" : `<small>${signed(h.gain_pct, pct)}</small>`}</td>` : ""}
    ${hasVested ? `<td class="num">${usd(h.vested_value, h.currency)}</td>` : ""}</tr>`;
  const stale = hs.some((h) => h.stale) ? `<p class="muted" style="font-size:12px"><span class="stale">⚠</span> Price is more than a few days old.</p>` : "";
  return `<h2>Holdings</h2><div class="scroll"><table class="holdings"><thead><tr><th>Security</th><th>Type</th><th class="num">Quantity</th><th class="num">Price</th>
    <th class="num">Value</th><th class="num">Share</th>${hasCost ? `<th class="num">Cost basis</th><th class="num">Gain / loss</th>` : ""}${hasVested ? `<th class="num">Vested</th>` : ""}</tr></thead>
    <tbody>${hs.map(row).join("")}</tbody></table></div>${stale}`;
}

/** Load and render the holdings of investment account `accountId` into #holdings. */
export async function mountHoldings(accountId) {
  const el = $("#holdings"), mine = ++seq;
  el.innerHTML = `<p class="muted">Loading holdings…</p>`;
  let data;
  try { data = await api("/api/holdings?account=" + encodeURIComponent(accountId)); }
  catch (e) { if (mine === seq) el.innerHTML = `<p class="err">Couldn't load holdings: ${esc(e.message)}</p>`; return; }
  if (mine !== seq) return;
  el.innerHTML = !data.holdings.length
    ? `<p class="muted">${data.synced ? "No holdings reported for this account." : "Holdings appear after the next sync."}</p>`
    : allocation(data.allocation) + table(data);
}
