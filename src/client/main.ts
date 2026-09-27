import "@fontsource/michroma/latin-400.css";
import "@fontsource-variable/martian-mono/wdth.css";
import "./styles.css";
import { mount } from "svelte";
import App from "./App.svelte";

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;
