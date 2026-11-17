// Excalidraw is pinned to the only build with native sticky notes.
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
  Fonts,
  FONT_FAMILY,
} from "https://esm.sh/@excalidraw/excalidraw@0.18.0-3c916c5?external=react,react-dom";

export { React, createRoot, Excalidraw, convertToExcalidrawElements, restoreElements, exportScene, CaptureUpdateAction, MainMenu, WelcomeScreen, Fonts, FONT_FAMILY };
export const h = React.createElement;
// Must match the import URL above (a test checks).
export const EXCALIDRAW_VERSION = "0.18.0-3c916c5";
