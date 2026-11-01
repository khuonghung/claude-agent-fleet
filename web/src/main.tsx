import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./controls.css";
import "./flow.css";
import "./ticket-modal.css";
import "./mascot.css";
import "./code-report.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
