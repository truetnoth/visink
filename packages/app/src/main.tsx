import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import { App } from "./App";
import { useStore } from "./store";

// для отладки и автотестов в браузере
if (import.meta.env.DEV) (window as unknown as { visink: typeof useStore }).visink = useStore;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
