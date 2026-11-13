# Server, ports and tabs

- The server starts on the first command that needs it, bound to `127.0.0.1` on the pages folder's own port: 4747 for the first folder, then the next free one, remembered per folder. `--port` or `OBEYA_PORT` override. Always pass the same `--dir` (or `OBEYA_DIR`) for a project.
- `obeya status` reports `{running, url, browsers}` and never starts it; `obeya stop` saves and stops it. It also stops after 12 idle hours (no tab, no calls; `--idle-timeout <minutes>`, `0` = never) and restarts on the next command.
- Live commands (`patch`, `show`, `library insert`) need a connected tab. Without one the CLI opens the canvas in the person's default browser and waits up to 30 s (`canvas_not_connected` if it doesn't connect). With `--no-open` it never opens a browser: exit `2`, `no_canvas_open`, the link in `error.url`.
- `obeya open [<page>] [--frame <id>]` brings the canvas up for the person, or switches the open tab.
- With several canvas tabs open, a patch goes to a tab showing its page, other requests to the tab used last; the other tabs update live.
- After an upgrade, a tab running older page code answers `canvas_outdated`: ask the person to reload it.
