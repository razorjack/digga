<script lang="ts">
  import type { ScopeMatch } from "../../shared/api.ts";
  import { formatCount } from "../../shared/display.ts";
  import { type QueueScope, scopeKey } from "../../shared/scope.ts";
  import { api } from "../api.ts";
  import Key from "../components/Key.svelte";
  import { ScopeSearch } from "./scope-search.svelte.ts";

  let {
    open,
    recordScopes,
    onpick,
    onclose,
  }: {
    open: boolean;
    /** The labels and artists of the record on screen, offered until something is typed. */
    recordScopes: QueueScope[];
    onpick: (scope: QueueScope) => void;
    onclose: () => void;
  } = $props();

  const id = $props.id();
  const search = new ScopeSearch(api);
  let dialog = $state<HTMLDialogElement>();

  const options: (QueueScope | ScopeMatch)[] = $derived(
    search.active ? search.matches : recordScopes,
  );
  /** The option moved to with the arrows or a click; the first one until then. */
  let chosenKey = $state<string | null>(null);
  const checked = $derived(
    options.find((option) => scopeKey(option) === chosenKey) ?? options[0] ?? null,
  );

  const status = $derived.by(() => {
    if (search.error) return `The search failed: ${search.error}`;
    if (!search.active) return recordScopes.length === 0 ? "Type two letters or more." : "";
    if (search.searching) return "Searching…";
    if (options.length === 0)
      return `Nothing matches “${search.text.trim()}”. A seller's shop is read in Settings, under Jobs.`;
    return `${formatCount(options.length)} ${options.length === 1 ? "match" : "matches"}, most records first.`;
  });

  /** "label" for a label on the record, "label, 303 records" for a match. */
  function optionNote(option: QueueScope | ScopeMatch): string {
    if (!("records" in option)) return option.kind;
    return `${option.kind}, ${formatCount(option.records)} ${option.records === 1 ? "record" : "records"}`;
  }

  /** The native modal traps focus, closes on Esc and returns focus to where it was. */
  function syncOpen(element: HTMLDialogElement): void {
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }

  /** Opened from a shortcut, nothing had focus before, so focus would stay in the closed dialog. */
  function reset(event: Event & { currentTarget: HTMLDialogElement }): void {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && event.currentTarget.contains(focused)) focused.blur();
    search.clear();
    chosenKey = null;
    onclose();
  }

  function pick(event: SubmitEvent): void {
    if (!checked) {
      event.preventDefault();
      return;
    }
    onpick(checked);
  }

  /** Enter on a radio button does not submit its form in every browser. */
  function submitOnEnter(event: KeyboardEvent & { currentTarget: HTMLInputElement }): void {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  /** ↓ in the search field moves on to the options, where the arrows choose between them. */
  function focusOptions(event: KeyboardEvent & { currentTarget: HTMLInputElement }): void {
    if (event.key !== "ArrowDown") return;
    const option = event.currentTarget.form?.querySelector<HTMLInputElement>("input:checked");
    if (!option) return;
    event.preventDefault();
    option.focus();
  }

  /** For browsers without `closedby`: a click on the backdrop targets the dialog itself. */
  function closeOnBackdrop(event: MouseEvent & { currentTarget: HTMLDialogElement }): void {
    if (event.target === event.currentTarget) event.currentTarget.close();
  }
</script>

<!-- Keys pressed here belong to the picker; the page and app shortcuts listen on the window. -->
<dialog
  bind:this={dialog}
  aria-labelledby="{id}-title"
  closedby="any"
  {@attach syncOpen}
  onclose={reset}
  onclick={closeOnBackdrop}
  onkeydown={(event) => event.stopPropagation()}
>
  <form method="dialog" class="panel" onsubmit={pick}>
    <h2 id="{id}-title">Dig one label, artist or seller</h2>
    <label class="search">
      <span class="visually-hidden">Label, artist or seller</span>
      <input
        type="search"
        autocomplete="off"
        spellcheck="false"
        placeholder="Label, artist or seller"
        aria-describedby="{id}-status"
        value={search.text}
        oninput={(event) => search.update(event.currentTarget.value)}
        onkeydown={focusOptions}
      />
    </label>

    <fieldset class="options" hidden={options.length === 0}>
      <legend>{search.active ? "Matches" : "On this record"}</legend>
      {#each options as option (scopeKey(option))}
        <label class="option">
          <input
            type="radio"
            name="scope"
            value={scopeKey(option)}
            checked={option === checked}
            onchange={() => (chosenKey = scopeKey(option))}
            onkeydown={submitOnEnter}
          />
          <span class="name">{option.name}</span>
          <span class="note">{optionNote(option)}</span>
        </label>
      {/each}
    </fieldset>

    <p class="status" id="{id}-status" role="status">{status}</p>

    <div class="actions">
      <button type="submit" disabled={!checked}>
        <Key label="Enter" primary aria-hidden="true" /> dig
      </button>
      <button type="button" aria-keyshortcuts="Escape" onclick={() => dialog?.close()}>
        <Key label="Esc" aria-hidden="true" /> cancel
      </button>
    </div>
  </form>
</dialog>

<style>
  dialog {
    width: min(560px, calc(100% - 48px));
    max-width: none;
    max-height: calc(100% - 48px);
    padding: 0;
    border: 1px solid var(--rule);
    background: var(--surface);
    color: inherit;
  }
  dialog::backdrop {
    background: color-mix(in srgb, var(--bg) 82%, transparent);
  }
  .panel {
    display: grid;
    gap: 16px;
    padding: 28px 32px 28px;
  }
  h2 {
    font-size: var(--text-xl);
  }
  .search input {
    width: 100%;
    font-size: var(--text-lg);
  }
  .options {
    display: grid;
    gap: 6px;
    max-height: 22em;
    overflow-y: auto;
  }
  legend {
    margin-bottom: 4px;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .option {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }
  .option input {
    accent-color: var(--accent-mark);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note {
    flex: none;
    color: var(--fg-faint);
    font-size: var(--text-sm);
  }
  .status {
    min-height: 1.4em;
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .actions {
    display: flex;
    gap: 28px;
  }
  .actions button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 0;
    background: none;
    padding: 0;
  }
  .actions button:disabled {
    opacity: 0.5;
  }
</style>
