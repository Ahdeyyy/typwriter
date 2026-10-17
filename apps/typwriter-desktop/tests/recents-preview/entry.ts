import { mount } from "svelte";
import Home from "../../src/lib/components/pages/home.svelte";
import "./preview.css";

document.documentElement.classList.toggle("dark", new URLSearchParams(location.search).get("theme") === "dark");
mount(Home, { target: document.getElementById("app")! });
