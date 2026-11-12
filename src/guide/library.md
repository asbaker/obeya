# Components from libraries

Prefer real components over plain rectangles. Any library in the public Excalidraw catalogue (~230) can be found and used on demand; downloads are cached per user, and nothing about the drawing is sent.

```bash
obeya library search aws icons                 # prefer results with "named": true
obeya library show architecture-diagram-components            # item ids and sizes; insert as <lib>/<item>
obeya library show software-architecture --sheet shots/lib.png # a labelled picture of every item
obeya library insert architecture-diagram-components/slack roadmap --at 120,560 --frame f-sys --id slack
```

- Many popular libraries have **unnamed items** (`item-1`, `item-2`, …): render `--sheet`, look at the PNG, and pick the id under the right picture. Never guess item ids.
- Insert ids are `<prefix>-1`, `<prefix>-2`, … (listed in `ids`); relabel or move the copy with a patch. `--at` is the item's top-left; negative: `--at=-40,120`.
- `library add ./team-kit.excalidrawlib` or `library add https://…/kit.excalidrawlib` adds the person's own; `library list` shows what's cached; the person sees cached libraries in the editor's library sidebar.
- Good starting points: architecture `architecture-diagram-components`, `c4-architecture`, `software-architecture` (unnamed), `system-design` (unnamed); cloud `aws-architecture-icons.childishgirl`, `google-icons`, `microsoft-azure-cloud-icons`, `kubernetes-icons-set`, `network-topology-icons`; UI `basic-ux-wireframing-elements`, `universal-ui-kit`, `lo-fi-wireframing-kit` (unnamed); process `bpmn`, `uml-library-activity-diagram`, `domain-driven-design`, `event-storming`; people `stick-figures`. Sticky notes need no library (`type: "stickynote"`).
- Catalogue libraries are MIT-licensed; `library show` gives each one's authors and source.
