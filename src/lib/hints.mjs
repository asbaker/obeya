// What to do about each error, by code. The CLI adds `hint` to every error
// envelope, so the guide needn't carry an error table that every session pays
// for: an agent reads the fix only when it hits the error. Keep each hint one
// short instruction. test/guide.test.mjs checks every code thrown in src/ has one.

export const HINTS = {
  // usage
  missing_argument: "see `usage`; obeya <command> --help for the options",
  unknown_option: "see `usage`; obeya <command> --help for the options",
  invalid_argument: "fix the argument the message names",
  unknown_command: "obeya --help lists the commands",
  unknown_topic: "pick one of `topics`, or run obeya --skill",

  // the person must act (exit 2)
  no_canvas_open: "give the person error.url, ask them to open it, then retry",
  canvas_not_connected: "give the person error.url, ask them to open it, then retry",

  // pages and elements
  unknown_page: "pick one of error.pages (the nearest names), or check obeya pages",
  bad_page_name: "page names are parts joined by /, without \\ : * ? \" < > | and no part starting with .",
  page_exists: "pick another name",
  page_gone: "the page was deleted or renamed; check obeya pages",
  last_page: "make another page first",
  unknown_element: "re-read ids with obeya describe or get",
  unknown_band: "obeya band list <page> shows the bands",

  // patches and images
  invalid_patch: "fix the patch; nothing was changed (obeya --skill patch)",
  no_room: "make the area bigger or move something out; nothing was changed",
  invalid_image: "check the path; images are PNG, JPEG, GIF, WebP or SVG",
  image_too_large: "shrink the image under 4 MB, then retry",
  invalid_mermaid: "fix the mermaid syntax the message names; nothing was changed",

  // the canvas tab
  canvas_outdated: "ask the person to reload the canvas tab, then retry; nothing was changed",
  canvas_timeout: "retry; if it repeats, ask the person to check the canvas tab",
  canvas_error: "the editor failed; retry, and tell the person if it repeats",
  unknown_tab: "the tab went away; retry",
  unknown_wait: "nothing is waiting any more; run obeya wait again if you still need an answer",

  // server and ports
  port_in_use: "drop --port (obeya picks the folder's own) or pass another",
  port_in_use_other_dir: "drop --port (obeya picks the folder's own) or pass another",
  no_free_port: "pass --port <n>",
  server_start_failed: "read error.log or .obeya/server.log in the pages folder",
  server_unreachable: "retry; obeya status shows whether the server is running",
  forbidden_host: "talk to the server through obeya, on 127.0.0.1",
  forbidden_origin: "talk to the server through obeya, on 127.0.0.1",
  not_found: "check the library id or URL (or the command: obeya --help)",
  invalid_json: "send valid JSON",
  too_large: "make it smaller, then retry",

  // rendering and export
  renderer_failed: "open the canvas (obeya open), then retry",
  no_chrome: "install Chrome or set CHROME_PATH, or use --format html",
  pdf_failed: "use --format html and print it from the browser",

  // libraries
  unknown_library: "obeya library search <words> finds catalogue ids",
  unknown_library_item: "obeya library show <lib> lists item ids; --sheet shows them",
  invalid_library: "check the file or URL is an .excalidrawlib",
  library_exists: "pass --as <id>",
  network_error: "check the connection, then retry; cached libraries still work",

  internal: "a bug in obeya: tell the person, with the message",
};

/** The error envelope's body: {code, message, hint, ...extra}. */
export const errorBody = (code, message, extra = {}) => ({ code, message, ...(HINTS[code] ? { hint: HINTS[code] } : {}), ...extra });
