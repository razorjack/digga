<script lang="ts">
  /** Every request Digga makes with the Discogs token, so the claim above it can be checked. */
</script>

<details>
  <summary>Every request Digga makes</summary>
  <ul>
    <li>
      Your account: when you connect, and each time you open Settings, which shows whose token is saved and offers
      your lists for the Maybe list. About two requests a visit.
    </li>
    <li>Your collection and wantlist: one request per 100 records, when you import them.</li>
    <li>The Maybe list: when you import it, or press <kbd>I</kbd> in Twelves.</li>
    <li>
      A want: one request 1.5 s after <kbd>A</kbd> or <kbd>C</kbd>, and one more when <kbd>Z</kbd> takes it back. In
      Twelves, when you re-judge a want onto or off the wantlist.
    </li>
    <li>A price: one request when you press <kbd>P</kbd>, for the record on screen.</li>
    <li>A seller's shop: one request per 100 listings, when you read it.</li>
  </ul>
  <p>
    Digga leaves 1.1 s between requests, which keeps it under Discogs' limit of 60 a minute. It pauses when Discogs
    says the limit is nearly used, and waits as long as Discogs asks when it says too many. Nothing runs in the
    background. Digga never changes your collection or lists, and never reads orders or messages. A Discogs token
    cannot be limited to some actions, so Digga saves it only on this computer and sends it only to api.discogs.com.
    You can revoke it on discogs.com at any time.
  </p>
</details>

<style>
  details {
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  summary {
    cursor: pointer;
    color: var(--fg);
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 3px;
  }
  ul {
    margin: 10px 0;
    padding-left: 1.2em;
  }
  li + li {
    margin-top: 4px;
  }
  kbd {
    font-family: var(--mono);
    font-weight: 600;
    color: var(--fg-accent);
  }
</style>
