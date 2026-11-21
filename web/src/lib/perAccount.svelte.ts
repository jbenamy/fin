// One account's data from the API (holdings, performance), refetched when the account changes or after a sync /
// edit (data.version). Results are tagged with their account, so switching accounts shows "loading" instead of the
// previous account's data, while a refetch for the same account keeps the current data on screen.
import { api, message } from "./api";
import { data } from "./data.svelte";

/** Call during component init. `id` is read reactively; `url` builds the request for an id. */
export function perAccount<T>(id: () => string, url: (id: string) => string) {
  // $derived passes on only a changed id (the prop is a getter on an account object that a reload replaces).
  const key = $derived(id());
  let loaded = $state<{ id: string; value: T } | null>(null), error = $state("");
  let seq = 0;
  $effect(() => {
    void data.version;
    const forId = key, mine = ++seq; error = "";
    api<T>(url(forId)).then((v) => { if (mine === seq) loaded = { id: forId, value: v }; })
      .catch((e) => { if (mine === seq) error = message(e); });
  });
  return {
    get value() { return loaded?.id === key ? loaded.value : null; },
    get error() { return error; },
  };
}
