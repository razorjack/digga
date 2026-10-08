<script lang="ts" module>
  import crateDark from "../assets/crate-dark.png";
  import crateLight from "../assets/crate-light.png";
  import moleDark from "../assets/mole-dark.png";
  import moleLight from "../assets/mole-light.png";
  import pressDark from "../assets/press-dark.png";
  import pressLight from "../assets/press-light.png";
  import safeDark from "../assets/safe-dark.png";
  import safeLight from "../assets/safe-light.png";

  /** Each drawing twice: one for the dark scheme, one for paper (docs/assets). */
  const ART = {
    mole: { dark: moleDark, light: moleLight },
    crate: { dark: crateDark, light: crateLight },
    press: { dark: pressDark, light: pressLight },
    safe: { dark: safeDark, light: safeLight },
  };

  export type ArtName = keyof typeof ART;
</script>

<script lang="ts">
  /** One of Digga's drawings, in the version for the scheme in use. Decorative: it has no text. */
  let { name, size = 120 }: { name: ArtName; size?: number } = $props();
</script>

<span class="art" aria-hidden="true">
  <img class="for-dark" src={ART[name].dark} alt="" width={size} height={size} />
  <img class="for-light" src={ART[name].light} alt="" width={size} height={size} />
</span>

<style>
  .art {
    display: inline-block;
    flex: none;
    line-height: 0;
  }
  img {
    height: auto;
  }
  /* The scheme is the system's unless Settings picks one (styles.css, data-color-scheme). */
  .for-light {
    display: none;
  }
  @media (prefers-color-scheme: light) {
    :global(:root:not([data-color-scheme="dark"])) .for-light {
      display: block;
    }
    :global(:root:not([data-color-scheme="dark"])) .for-dark {
      display: none;
    }
  }
  :global(:root[data-color-scheme="light"]) .for-light {
    display: block;
  }
  :global(:root[data-color-scheme="light"]) .for-dark {
    display: none;
  }
</style>
