<script lang="ts">
  import Shell from "./components/Shell.svelte";
  import { loadAccounts } from "./lib/data.svelte";
  import { resumeOAuth } from "./lib/link.svelte";
  import { interceptLinks, route } from "./lib/router.svelte";
  import Accounts from "./pages/Accounts.svelte";
  import Connections from "./pages/Connections.svelte";
  import Home from "./pages/Home.svelte";
  import Login from "./pages/Login.svelte";
  import NotFound from "./pages/NotFound.svelte";
  import Passkeys from "./pages/Passkeys.svelte";

  const PAGES = {
    "/": { title: "Overview", page: Home }, "/accounts": { title: "Accounts", page: Accounts },
    "/connections": { title: "Connections", page: Connections }, "/passkeys": { title: "Passkeys", page: Passkeys },
  } as const;
  const current = $derived(PAGES[route.path as keyof typeof PAGES] ?? null);
  const isLogin = $derived(route.path === "/login");

  $effect(() => { document.title = isLogin ? "Fin · Sign in" : current && route.path !== "/" ? `Fin · ${current.title}` : "Fin"; });

  // Everything but the login page needs the account list (the nav shows the last sync time).
  if (location.pathname !== "/login") { loadAccounts(); resumeOAuth(); }
</script>

<svelte:document onclick={interceptLinks} />

{#if isLogin}
  <Login />
{:else}
  <Shell>
    {#if current}<current.page />{:else}<NotFound />{/if}
  </Shell>
{/if}
