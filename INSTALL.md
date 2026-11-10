# Setting up obeya (for an AI agent)

You are setting up **obeya** for a person: an Excalidraw canvas in their browser that you can draw on and read back through a CLI. Follow these steps in order and check each one. Ask the person before anything that changes their machine beyond installing the CLI and the skill, and never create pages, folders or files in their project.

## 1. Check Node

```bash
node --version
```

It must be **22.20 or later** (both obeya and the skills installer need it). If it's older or missing, stop and tell the person: they need a newer Node (from nodejs.org, or their version manager) before going on.

## 2. Install the CLI

```bash
npm i -g obeya
obeya --version
```

`obeya --version` must print a version. If the global install needs permissions you don't have, tell the person the command to run themselves; don't use `sudo` on your own.

## 3. Offer the skill

Ask the person: *"Install the obeya skill for your coding agents, so they know how to use it in every project?"* If they say yes:

```bash
npx skills add asbaker/obeya -g
```

This uses the open skills installer (it works with Claude Code, Codex, Cursor, OpenCode and many more). The skill is small: it tells an agent to run `obeya --skill`, which prints the full guide for the installed version.

If they say no, you're done with this step: an agent can always run `obeya --skill` itself.

## 4. Don't open or create anything

Don't start the server, open a canvas, or make a pages folder now. The person decides where their pages live.

## 5. Tell the person what's next

End with this (in your own words is fine):

> obeya is installed. Next:
>
> 1. Pick a folder for your pages, anywhere you like (for example `docs/obeya` in a project). Keep it out of git if you'd rather; obeya's own working files (in `.obeya/` inside it) already are.
> 2. Ask me to draw something, and say where. For example: *"Use obeya to draw how this project fits together. Put the page in docs/obeya."* I'll start the canvas and give you the link to open in your browser.

## Updating and removing

- Update: `npm update -g obeya` and `npx skills update obeya`.
- Remove: `npx skills remove obeya -g` and `npm uninstall -g obeya`. Pages are plain `.excalidraw` files and stay where the person put them. Each folder's port is remembered in obeya's user cache (`ports.json`); deleting that file is harmless.
