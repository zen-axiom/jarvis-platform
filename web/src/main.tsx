import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/hud.css";

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
