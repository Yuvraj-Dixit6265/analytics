import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import PublicView from "./components/PublicView.jsx";
import "./styles.css";

const base = import.meta.env.BASE_URL || "/";
const pathname = window.location.pathname;

const relativePath =
  base !== "/" && pathname.startsWith(base)
    ? "/" + pathname.slice(base.length)
    : pathname;

const publicMatch = relativePath.match(/^\/r\/(.+)$/);

const root = createRoot(document.getElementById("root"));

root.render(
  <React.StrictMode>
    {publicMatch ? <PublicView slug={publicMatch[1]} /> : <App />}
  </React.StrictMode>
);