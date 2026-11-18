---
name: release
description: Release obeya in two parts. Prepare, on the release branch before it merges - the CHANGELOG entry from the commits and diffs since the last release, the release headline in package.json (what update notices show), the version, tests, a "Release X.Y.Z" commit the person reviews with the code. Ship, from main after the merge - the person runs npm publish, then tag and GitHub release. Use when the person says "release", "prepare the release", "cut a release", "publish 0.x.y" or "ship it" in this repo.
---

# Release obeya

Run from the repo root. The person stays in the loop: show what you'll change, and ask before each step that leaves this machine (push, tag, GitHub release). **They run `npm publish` themselves** (it needs their npm login and 2FA); never run it for them. Never commit without their go-ahead.

What a release must leave behind, because the update notice reads it:
- `package.json` → `"obeya": {"headline": "…"}`: one plain line, at most 120 characters, no trailing full stop. It's what `obeya --skill`, `obeya status` and the canvas's About box show as the headline.
- A GitHub release at `v<version>` whose notes are that version's CHANGELOG section. About's "What's new →" opens `https://github.com/asbaker/obeya/releases/tag/v<version>`.

## The version lives on the branch

A release branch (`v0.3`, …) carries its version from its first commit: `npm version X.Y.Z --no-git-tag-version` (also sets package-lock.json). Nothing publishes from a branch, so the plain number is fine. Why early: a CLI leaves a running server alone when that server's version is the same or newer, so a branch still at the last release's number keeps talking to a server the global `obeya` started. While obeya is 0.x: anything new or changed → next minor (0.2.1 → 0.3.0); only fixes → next patch (0.3.0 → 0.3.1). If the branch's scope changes which one it is, change the number then.

The CHANGELOG entry and the headline are written last, in **Prepare**, from the commits as they finally are.

# Part 1 · Prepare (on the release branch, before it merges)

## 1. The branch is ready

```bash
git fetch origin --tags
git switch <branch> && git status --short   # clean (untracked node_modules is fine)
git log --oneline origin/main..HEAD          # what this release adds
node -p "require('./package.json').version"  # the release's version, not on npm yet
npm view obeya version                       # the last published one
```

Stop and say what's wrong if the branch isn't clean, or its version is already on npm or isn't the right bump. Ask whether anything still open (kanban cards marked for this release) should land first.

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
- **Version:** check the branch's number against the entry: anything under Added or Changed → next minor; only Fixed → next patch. If it's wrong, fix it in step 4.
- **Headline** (`"obeya": {"headline": "…"}` in package.json): the release in a few words a person would care about ("Stages, pins, docs you can edit in the tab"); one plain line, at most 120 characters, no trailing full stop.
- **Show the person** the version, the entry and the headline together; they edit or approve before anything is written.

## 4. Write it

- CHANGELOG.md: the entry as `## [X.Y.Z] - YYYY-MM-DD` (today), above the last release. At the bottom, the link (and any missing ones): `[X.Y.Z]: https://github.com/asbaker/obeya/compare/vPREV...vX.Y.Z`.
- package.json: the headline under `"obeya"`. The version is already set; if step 3 changed it, `npm version X.Y.Z --no-git-tag-version`.

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
git push origin <branch>      # ask first
```

The person reviews the release commit with the rest of the branch (a PR, or locally) and merges it into main. Prepare ends here.

# Part 2 · Ship (from main, after the merge)

## 6. Main has the release

```bash
git switch main && git pull --ff-only
git status --short                           # clean
git log --oneline origin/main..HEAD          # nothing: main is pushed
node -p "require('./package.json').version"  # X.Y.Z, and `npm view obeya version` is older
git log -1 --format=%s -- CHANGELOG.md       # the release commit is on main
npm whoami && gh auth status                 # the person is logged in to both
```

Stop and say what's wrong if main doesn't have the release commit, or the version is already on npm.

## 7. The person publishes

Tell them to run, in this repo:

```bash
npm publish
```

Wait for them to say it's done, then check the registry has the version and its headline (this is exactly what update checks read):

```bash
npm view obeya version                                   # X.Y.Z
curl -s https://registry.npmjs.org/obeya/latest | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s);console.log(m.version, JSON.stringify(m.obeya))})'
```

## 8. Tag and GitHub release

Ask first. Tag main's head (the merge, or the release commit if it fast-forwarded). Annotated tag, same style as before; the notes are the CHANGELOG section, opened with the install lines:

```bash
git tag -a vX.Y.Z -m "obeya X.Y.Z"
git push origin vX.Y.Z
awk '/^## \[X\.Y\.Z\]/{f=1;next} /^## \[/{f=0} f' CHANGELOG.md > "$TMPDIR/obeya-notes.md"
{ printf 'Also on npm: [`obeya`](https://www.npmjs.com/package/obeya).\n\n```bash\nnpm i -g obeya\nnpx skills add asbaker/obeya -g\n```\n'; cat "$TMPDIR/obeya-notes.md"; } > "$TMPDIR/obeya-release.md"
gh release create vX.Y.Z --title "obeya X.Y.Z" --notes-file "$TMPDIR/obeya-release.md" --latest
```

Open `https://github.com/asbaker/obeya/releases/tag/vX.Y.Z` and check it reads well: it's where "What's new →" lands.

## 9. After

- The kanban (`docs/obeya`, page `kanban`): move the release's cards to Done with the release commit.
- The next release branch starts with its version bump (see "The version lives on the branch").
- Day-to-day use can go back to the global `obeya` (`npm update -g obeya`).
- Report: the version, the headline, and the npm, tag and release links.

## If something goes wrong

- **Tagged but not published:** `git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z`, fix, tag again.
- **Bad npm publish:** don't unpublish (the number is gone for good). Fix, release the next patch, and `npm deprecate obeya@X.Y.Z "use X.Y.Z+1"`.
- **Release notes need a fix:** `gh release edit vX.Y.Z --notes-file …`.
- **Wrong headline after publishing:** it's baked into that version on npm; the next release's headline replaces it. Don't republish for it.
