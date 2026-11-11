# Images

```json
{"skeleton": [{"type": "image", "id": "login-shot", "src": "./screens/login.png", "x": 900, "y": 120, "width": 480}]}
```

- `src` is a local PNG, JPEG, GIF, WebP or SVG file, at most 4 MB, relative to where you run `obeya`. obeya downloads nothing: for an image on the web, download it to a temporary file and pass that path.
- Give `width` (height follows the image's shape), both, or neither (its own size, at most 800 wide).
- The image is stored inside the page's `.excalidraw` file; the path isn't kept. Deleting the image removes its data.
- A screenshot of another page: `obeya shot other-page --out /tmp/other.png`, then `"src": "/tmp/other.png"`.
