import React from "react";
import ReactDOM from "react-dom/client";
import faviconUrl from "@assets/favicon.png";
import App from "./App.jsx";
import "./index.css";
import "./platform/platform.css";

const favicon =
  document.querySelector("link[rel='icon']") ?? document.createElement("link");
favicon.rel = "icon";
favicon.type = "image/png";
favicon.href = faviconUrl;
document.head.appendChild(favicon);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
