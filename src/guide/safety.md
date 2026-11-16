# Safety

obeya is not an official Excalidraw project.

- Everything is local. The server listens on `127.0.0.1` only and refuses requests from other websites; drawings, annotations and screenshots never leave the machine. Only Excalidraw's code (its Mermaid converter included) and fonts load from a pinned CDN; Mermaid text is converted in the browser, library downloads come from the public catalogue, and once a day the server asks the npm registry for obeya's latest version (nothing about the person is sent).
- Don't send drawing content, screenshots or canvas links to any external service unless the person asks you to.
- The canvas link is a plain local address (`http://127.0.0.1:<port>/?page=…`); the person can bookmark it.
