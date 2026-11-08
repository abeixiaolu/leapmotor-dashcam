import { RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { DirectionProvider } from "@/components/foundations/direction/direction";
import { router } from "./router";
import "@/styles/globals.css";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <DirectionProvider locale="zh-CN">
    <RouterProvider router={router} />
  </DirectionProvider>,
);
