---
name: release
description: Release obeya from main. Checks everything is merged, writes the CHANGELOG entry from the commits and diffs since the last release, writes the release headline into package.json (what update notices show), bumps the version, has the person run npm publish, then tags and creates the GitHub release. Use when the person says "release", "cut a release", "publish 0.x.y" or "ship it" in this repo.
---

# Release obeya

Run from the repo root. The person stays in the loop: show what you'll change, and ask before each step that leaves this machine (push, tag, GitHub release). **They run `npm publish` themselves** (it needs their npm login and 2FA); never run it for them.

What a release must leave behind, because the update notice reads it:
- `package.json` → `"obeya": {"headline": "…"}`: one plain line, at most 120 characters, no trailing full stop. It's what `obeya --skill`, `obeya status` and the canvas's About box show as the headline.
- A GitHub release at `v<version>` whose notes are that version's CHANGELOG section. About's "What's new →" opens `https://github.com/asbaker/obeya/releases/tag/v<version>`.

## 1. Everything is merged on main

```bash
git fetch origin --tags
git switch main && git pull --ff-only
git status --short            # clean (untracked node_modules is fine)
git log --oneline origin/main..HEAD   # nothing: main is pushed
git branch -r --no-merged origin/main # branches not on main: ask if any should be in this release
npm whoami && gh auth status  # the person is logged in to both
```

Stop and say what's wrong if main isn't clean and current, or if the person meant to include an unmerged branch.

## 2. Read what changed

CHANGELOG.md has no Unreleased section: nobody edits it between releases. The entry is written now, from the commits and the diffs since the last release.

```bash
PREV=$(git describe --tags --abbrev=0)               # e.g. v0.2.1
git log --no-merges --format='%h %s%n%n%b' $PREV..HEAD   # the commit bodies say what users see
git diff --stat $PREV..HEAD
```

Then read the diffs of the surfaces users meet, which catch what a message left out:

| Diff | Tells you |
|---|---|
| `src/lib/commands.mjs` | new or changed commands, flags, help |
| `test/responses.test.mjs` | a command's output keys: any change goes under **Changed** |
| `src/lib/hints.mjs` | new error codes |
| `src/guide/` | what agents are told (new topics, changed advice) |
| `src/page/` (`ui/`, `page.css`) | what the person sees in the tab |
| `README.md`, `INSTALL.md` | setup, privacy, what leaves the machine |

`git diff $PREV..HEAD -- <path>` for each.

## 3. Draft the entry and the headline

- **Sections:** Added, Changed, Fixed (only those with something in them). Each line says what the person or agent sees or can now do, not how it's built; mention commands, flags and keys in backticks. Fold internal-only work (refactors, tests, tooling) out.
- **Opening:** one or two sentences on what the release is about, then the line earlier releases end their opening with: Update both: `npm update -g obeya` and `npx skills update obeya`.
- **Version:** while obeya is 0.x, anything under Added or Changed → next minor (0.2.1 → 0.3.0); only Fixed → next patch (0.3.0 → 0.3.1).
- **Headline** (`"obeya": {"headline": "…"}` in package.json): the release in a few words a person would care about ("Stages, pins, docs you can edit in the tab"); one plain line, at most 120 characters, no trailing full stop.
- **Show the person** the version, the entry and the headline together; they edit or approve before anything is written.

## 4. Write it

- CHANGELOG.md: the entry as `## [X.Y.Z] - YYYY-MM-DD` (today), above the last release. At the bottom, the link (and any missing ones): `[X.Y.Z]: https://github.com/asbaker/obeya/compare/vPREV...vX.Y.Z`.
- package.json: `npm version X.Y.Z --no-git-tag-version` (also sets package-lock.json), then the headline under `"obeya"`.

## 5. Check, then commit

```bash
npm test
npm run test:smoke            # needs Chrome
npm pack --dry-run            # CHANGELOG.md and the src/ tree are in; no docs/obeya, no tests
```

Show `git diff`; on the person's go-ahead:

```bash
git add CHANGELOG.md package.json package-lock.json
git commit -m "Release X.Y.Z" -m "<the entry's opening sentence>"
git push origin main          # ask first
```

## 6. The person publishes

Tell them to run, in this repo:

```bash
npm publish
```

Wait for them to say it's done, then check the registry has the version and its headline (this is exactly what update checks read):

```bash
npm view obeya version                                   # X.Y.Z
curl -s https://registry.npmjs.org/obeya/latest | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s);console.log(m.version, JSON.stringify(m.obeya))})'
```

## 7. Tag and GitHub release

Ask first. Annotated tag, same style as before; the notes are the CHANGELOG section, opened with the install lines:

```bash
git tag -a vX.Y.Z -m "obeya X.Y.Z"
git push origin vX.Y.Z
awk '/^## \[X\.Y\.Z\]/{f=1;next} /^## \[/{f=0} f' CHANGELOG.md > "$TMPDIR/obeya-notes.md"
{ printf 'Also on npm: [`obeya`](https://www.npmjs.com/package/obeya).\n\n```bash\nnpm i -g obeya\nnpx skills add asbaker/obeya -g\n```\n'; cat "$TMPDIR/obeya-notes.md"; } > "$TMPDIR/obeya-release.md"
gh release create vX.Y.Z --title "obeya X.Y.Z" --notes-file "$TMPDIR/obeya-release.md" --latest
```

Open `https://github.com/asbaker/obeya/releases/tag/vX.Y.Z` and check it reads well: it's where "What's new →" lands.

## 8. After

- The kanban (`docs/obeya`, page `kanban`): move the release's cards to Done with the release commit.
- Day-to-day use can go back to the global `obeya` (`npm update -g obeya`).
- Report: the version, the headline, and the npm, tag and release links.

## If something goes wrong

- **Tagged but not published:** `git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z`, fix, tag again.
- **Bad npm publish:** don't unpublish (the number is gone for good). Fix, release the next patch, and `npm deprecate obeya@X.Y.Z "use X.Y.Z+1"`.
- **Release notes need a fix:** `gh release edit vX.Y.Z --notes-file …`.
- **Wrong headline after publishing:** it's baked into that version on npm; the next release's headline replaces it. Don't republish for it.
