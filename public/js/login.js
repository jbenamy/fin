// /login: sign in with a passkey, create the very first one, or add one from an invite link.
import { $, api, showError as show } from "/shared.js";
import { registerPasskey, signInWithPasskey, supported } from "/js/webauthn.js";

const params = new URLSearchParams(location.search);
const invite = params.get("invite");
// Only same-site paths: "//host" or "/\host" would leave the app.
const next = /^\/(?![/\\])/.test(params.get("next") ?? "") ? params.get("next") : "/";

const showError = (e) => show($("#err"), e);

/** Run `fn` with the button busy; on success go to `next`. */
function action(button, fn) {
  return async (ev) => {
    ev?.preventDefault();
    showError(null);
    button.disabled = true;
    try { await fn(); location.replace(next); }
    catch (e) { showError(e); button.disabled = false; }
  };
}

function nameForm(title, text, buttonText) {
  $("#app").innerHTML = `<h1>${title}</h1><p class="muted">${text}</p>
    <form id="f"><label>Name for this passkey<input id="label" maxlength="60" autocomplete="off" required placeholder="e.g. Alex's iPhone"></label>
    <button type="submit" id="go">${buttonText}</button></form>`;
  $("#label").focus();
}

async function main() {
  if (!supported()) { $("#app").innerHTML = '<h1>Passkeys unavailable</h1><p class="muted">This browser doesn\'t support passkeys.</p>'; return; }
  const status = await api("/api/auth/status" + (invite ? "?invite=" + encodeURIComponent(invite) : ""));
  if (invite) {
    if (!status.invite) { $("#app").innerHTML = '<h1>Invite link expired</h1><p class="muted">This link was already used or is more than a day old. Ask someone who is signed in for a new one.</p>'; return; }
    nameForm("Add a passkey", "You were invited to Fin. Create a passkey on this device to sign in from now on.", "Create passkey");
    $("#f").onsubmit = action($("#go"), () => registerPasskey($("#label").value, invite));
  } else if (status.signedIn) {
    location.replace(next);
  } else if (status.setup) {
    nameForm("Set up Fin", "No passkey exists yet. Create the first one; after that, new passkeys need an invite from someone signed in.", "Create passkey");
    $("#f").onsubmit = action($("#go"), () => registerPasskey($("#label").value));
  } else {
    $("#app").innerHTML = '<h1>Sign in</h1><p class="muted">Use the passkey you created for Fin.</p><button id="go" style="width:100%">Sign in with a passkey</button>';
    $("#go").onclick = action($("#go"), signInWithPasskey);
    $("#go").focus();
  }
}
main().catch(showError);
