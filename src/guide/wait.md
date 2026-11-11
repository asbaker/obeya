# Asking the person for something: wait

When you need the person to do something on a page (answer questions, triage, review a draft, place or rank cards, mark what's wrong), ask on the page and wait:

```bash
obeya wait roadmap --frame f-questions --ask "Answer the questions in this frame on stickies, then press Done"
```

- Tabs showing the page show `--ask` in a banner with a **Done** button (Cmd/Ctrl+Enter), with `--frame` outlined. Other tabs stay quiet: the page pill says "(1 waiting)" and the page picker marks the page. No tab is opened or switched; if none shows the page, the link is printed.
- Returns `{page, frame, done, waited, rev, since, changes}`. `changes` is what `obeya changes <page>` would print, and moves the same cursor. `done` is `"button"`, `"timeout"` (with `--timeout <minutes>`) or `"stopped"` (the server stopped). No timeout by default.
- **Run it in the background** if your shell limits how long a command runs (Claude Code: `run_in_background`); you're told when it exits. Stopping the command takes the banner down.
- Keep the ask to one concrete sentence that names where and what. Their reply is what they draw: sticky notes, circles, moves. Their answers don't point at your questions; match them by position (`get --frame`).
- Tell the person in chat which page you're waiting on, with the link.
