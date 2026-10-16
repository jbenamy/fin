// /passkeys: the passkeys that can sign in, adding one here or via an invite link, removing one, signing out.
import { $, $$, esc, cmp, api, openDialog, showError as fail } from "/shared.js";
import { registerPasskey } from "/js/webauthn.js";

let passkeys = [];
const date = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";

function render() {
  $("#rows").innerHTML = [...passkeys].sort((a, b) => cmp(a.label, b.label)).map((p) => `<tr>
    <td>${esc(p.label)}${p.current ? '<span class="pill">this browser</span>' : ""}</td>
    <td class="hide-sm">${date(p.created_at)}</td><td>${date(p.last_used)}</td>
    <td class="c">${passkeys.length > 1 ? `<button class="ghost danger sm" data-rm="${esc(p.id)}">Remove</button>` : ""}</td></tr>`).join("");
  for (const b of $$("[data-rm]")) b.onclick = () => remove(passkeys.find((p) => p.id === b.dataset.rm));
}

async function load() {
  try { passkeys = await api("/api/passkeys"); render(); }
  catch (e) { fail($("#err"), e); }
}

function remove(p) {
  $("#rmtitle").textContent = `Remove "${p.label}"?`;
  $("#rmerr").hidden = true;
  openDialog($("#rmdlg"), { onSubmit: async () => {
    try { await api("/api/passkeys/" + encodeURIComponent(p.id), { method: "DELETE" }); $("#rmdlg").close(); await load(); }
    catch (e) { fail($("#rmerr"), e); }
  } });
}

$("#add").onclick = () => {
  $("#addlabel").value = ""; $("#adderr").hidden = true; $("#addgo").disabled = false;
  openDialog($("#adddlg"), { onSubmit: async () => {
    $("#addgo").disabled = true;
    try { await registerPasskey($("#addlabel").value); $("#adddlg").close(); await load(); }
    catch (e) { fail($("#adderr"), e); $("#addgo").disabled = false; }
  } });
};

$("#invite").onclick = async () => {
  try {
    const { url, expires_at } = await api("/api/passkeys/invite", { method: "POST" });
    $("#inviteurl").value = url;
    $("#invitehint").textContent = `Works once, until ${new Date(expires_at).toLocaleString()}.`;
    $("#copy").textContent = "Copy";
    openDialog($("#invitedlg"), { onSubmit: async () => {
      try { await navigator.clipboard.writeText(url); $("#copy").textContent = "Copied"; }
      catch { $("#inviteurl").select(); }
    } });
    $("#inviteurl").select();
  } catch (e) { fail($("#err"), e); }
};

$("#logout").onclick = async () => { await api("/api/auth/logout", { method: "POST" }); location.href = "/login"; };

load();
