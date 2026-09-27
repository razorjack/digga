<script lang="ts">
  import Key from "./Key.svelte";
  import type { KeyGroup } from "../keymap.ts";

  let { groups, onclose }: { groups: KeyGroup[]; onclose: () => void } = $props();

  let panel = $state<HTMLDivElement | null>(null);
  $effect(() => {
    panel?.focus();
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}>
  <div
    class="panel"
    role="dialog"
    aria-modal="true"
    aria-label="Keys"
    tabindex="-1"
    bind:this={panel}
    onclick={(e) => e.stopPropagation()}
  >
    <div class="head">
      <h2>Keys</h2>
      <button type="button" onclick={onclose}><Key label="Esc" /> close</button>
    </div>
    <div class="groups">
      {#each groups as group (group.title)}
        <section>
          <h3>{group.title}</h3>
          <dl>
            {#each group.keys as k (k.label)}
              <div class="row">
                <dt>
                  {#each k.keys as key, i (i)}
                    {#if key === "…"}<span class="ellipsis">…</span>{:else}<Key label={key} />{/if}
                  {/each}
                </dt>
                <dd>{k.label}</dd>
              </div>
            {/each}
          </dl>
        </section>
      {/each}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: 24px;
    background: color-mix(in srgb, var(--ground) 82%, transparent);
  }
  .panel {
    width: min(1120px, 100%);
    max-height: 100%;
    overflow-y: auto;
    padding: 28px 32px 32px;
    border: 1px solid var(--groove);
    background: var(--sleeve);
  }
  .panel:focus {
    outline: none;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }
  h2 {
    font-family: var(--display);
    font-weight: 400;
    font-size: var(--text-xl);
  }
  .head button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 0;
    background: none;
    color: var(--faded);
  }
  .groups {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 28px 40px;
  }
  h3 {
    margin-bottom: 10px;
    color: var(--faded);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  dl {
    margin: 0;
    display: grid;
    gap: 8px;
  }
  .row {
    display: grid;
    grid-template-columns: 6.5em 1fr;
    align-items: center;
    gap: 12px;
  }
  dt {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  dd {
    margin: 0;
    font-size: var(--text-sm);
  }
  .ellipsis {
    color: var(--dust);
  }
</style>
