<script lang="ts">
  import { commandKeys } from "../keymap.ts";
  import Key from "./Key.svelte";

  /** A Cmd or Ctrl shortcut's caps, as this platform's keyboard labels them. */
  let { key }: { key: string } = $props();
</script>

{#each commandKeys(key) as label (label)}<Key {label} />{/each}
