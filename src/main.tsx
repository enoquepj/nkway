import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import ContextoViewer from "./ContextoViewer";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <ContextoViewer />
  </StrictMode>
);
