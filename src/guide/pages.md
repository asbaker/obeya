# Pages and folders

`obeya pages` lists each page with its frame count and last edit. A page's name is its path in the pages folder: `project-a/overview` is `project-a/overview.excalidraw`. Quote names with spaces (`obeya get "Café Ideen"`). Patching a new name creates the page and its folder.

Files under `skipped` have names the tool can't use (one with `\ : * ? " < > |`, or a part starting with `.`): tell the person rather than renaming them.

`obeya rename <page> <new-name>` renames a page or moves it to a folder (`obeya rename overview project-a/overview`); its history, bands, cursors and the person's open tab come along. Then fix the links listed in `staleLinks` with a patch, e.g. `{"elements": [{"id": "go", "link": "http://127.0.0.1:<port>/?page=<new-name>&element=f2"}]}`. Never rename `.excalidraw` files yourself. You can't delete pages.

The person switches pages with the page picker (top left, or Cmd/Ctrl+O), makes new ones with ☰ → New page…, and renames, moves or deletes the page on screen with ☰ → Rename or move this page….
