# Diagrams from Mermaid

For flowcharts, sequence, class, state and ER diagrams, gantt, quadrant charts and timelines, write Mermaid and let obeya draw it: a few hundred bytes of Mermaid instead of a skeleton several times its size, laid out for you. The result is ordinary Excalidraw elements the person can edit. Other Mermaid types (pie, journey, …) arrive as one image.

```bash
obeya mermaid roadmap --file flow.mmd --id login              # below what's on the page
obeya mermaid roadmap --file flow.mmd --id login --frame f-auth  # inside a frame
obeya mermaid roadmap --file - --id login --at 120,560 <<'MMD'
flowchart LR
  A[Sign in] -->|SSO| B(Identity provider)
  B --> C{Allowed?}
MMD
```

- **Ids** are `<id>-<mermaid id>`: node `A` is `login-A`, the edge `A --> B` is `login-A_B`; things Mermaid doesn't name are `login-m1`, `login-m2`, …. The whole diagram is one group, so the person can drag it as one. Patch them like any element (recolour, link, `customData`).
- **Updating**: keep the `.mmd` (in the repo, or a temp file) as the source of truth. Edit it and run the same command with the same `--id`: the diagram is replaced, in the same place (and frame). Edits made on the canvas to that diagram are not kept, so change the Mermaid, not the drawing; if the person reshaped it by hand, ask before re-running.
- **Placement**: `--at x,y` is the top-left; without it, where the earlier run was, else inside `--frame`, else below everything on the page.
- The response is `{rev, created, removed, warnings, fixes}`, with `image: true` when the type was drawn as an image. A syntax error is `invalid_mermaid`, and nothing changes.
- Lint and screenshots as usual: a diagram in a frame can overflow it; make the frame bigger or the diagram simpler.
