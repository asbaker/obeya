// Third-party code for the page, in one place: React, and Excalidraw at the
// pinned build (the only one with native sticky notes). Loaded from esm.sh;
// drawings never leave this machine.
import React from "react";
import { createRoot } from "react-dom/client";
import {
  Excalidraw,
  convertToExcalidrawElements,
  restoreElements,
  exportScene,
  CaptureUpdateAction,
  MainMenu,
  WelcomeScreen,
} from "https://esm.sh/@excalidraw/excalidraw@0.18.0-3c916c5?external=react,react-dom";

export { React, createRoot, Excalidraw, convertToExcalidrawElements, restoreElements, exportScene, CaptureUpdateAction, MainMenu, WelcomeScreen };
export const h = React.createElement;
// Must match the import URL above (a test checks).
export const EXCALIDRAW_VERSION = "0.18.0-3c916c5";
