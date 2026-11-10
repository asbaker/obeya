import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { parseCli, UsageError } from "../src/lib/args.mjs";
import { baseName, caseClash, exportStem, folderOf, foldersOf, joinName, normalizePageName, validPageName } from "../src/lib/names.mjs";

const cwd = path.resolve("/work/project");
const parse = (argv, env = {}) => parseCli(argv, env, cwd);
const usage = (argv, code, env = {}) =>
  assert.throws(() => parse(argv, env), (e) => e instanceof UsageError && e.code === code, `${argv.join(" ")} -> ${code}`);

test("defaults: ./obeya and port 4747", () => {
  const p = parse(["pages"]);
  assert.equal(p.command, "pages");
  assert.equal(p.dir, path.join(cwd, "obeya"));
  assert.equal(p.port, 4747);
  assert.equal(p.noOpen, false);
  assert.equal(p.consumer, "default");
});

test("env vars, then flags, override defaults", () => {
  const env = { OBEYA_DIR: "pages", OBEYA_PORT: "4800", OBEYA_CONSUMER: "ux" };
  const e = parse(["pages"], env);
  assert.equal(e.dir, path.join(cwd, "pages"));
  assert.equal(e.port, 4800);
  assert.equal(e.consumer, "ux");
  const f = parse(["pages", "--dir", "other", "--port=4900"], env);
  assert.equal(f.dir, path.join(cwd, "other"));
  assert.equal(f.port, 4900);
});

test("--no-open is a boolean and never swallows the next word", () => {
  const p = parse(["--no-open", "get", "board"]);
  assert.equal(p.noOpen, true);
  assert.equal(p.command, "get");
  assert.equal(p.page, "board");
});

test("page commands need a page", () => {
  for (const cmd of ["get", "describe", "patch", "changes", "shot", "show"]) usage([cmd], "missing_argument");
});

test("patch never defaults to stdin: --file is required", () => {
  usage(["patch", "board"], "missing_argument");
  assert.equal(parse(["patch", "board", "--file", "-"]).flags.file, "-");
  assert.equal(parse(["patch", "board", "--file", "p.json"]).flags.file, "p.json");
});

test("unknown commands and options", () => {
  usage(["draw"], "unknown_command");
  usage(["get", "board", "--bogus"], "unknown_option");
  usage(["pages", "--frame", "x"], "unknown_option"); // a real option, but not for this command
  usage(["pages", "extra"], "invalid_argument");
});

test("values are validated", () => {
  usage(["pages", "--port", "abc"], "invalid_argument");
  usage(["pages", "--port", "70000"], "invalid_argument");
  usage(["changes", "board", "--since", "yesterday"], "invalid_argument");
  usage(["changes", "board", "--source", "robot"], "invalid_argument");
  usage(["shot", "board", "--scale", "0"], "invalid_argument");
  usage(["shot", "board", "--around", " , "], "invalid_argument");
  usage(["shot", "board", "--around", "a", "--frame", "f1"], "invalid_argument");
  assert.deepEqual(parse(["shot", "board", "--around", "n1, n2,,n3"]).around, ["n1", "n2", "n3"]);
  usage(["describe", "board", "--format", "xml"], "invalid_argument");
  usage(["get", "../etc"], "invalid_argument");
  usage(["changes", "board", "--consumer", "a b"], "invalid_argument");
  usage(["get", "board", "--frame"], "invalid_argument"); // string option without a value
  assert.equal(parse(["changes", "board", "--since", "last"]).flags.since, "last");
  assert.equal(parse(["changes", "board", "--since", "12"]).flags.since, "12");
});

test("help, skill and version short-circuit validation", () => {
  assert.equal(parse([]).command, null);
  assert.equal(parse(["--skill"]).skill, true);
  assert.equal(parse(["-V"]).version, true);
  const h = parse(["patch", "--help"]);
  assert.equal(h.help, true);
  assert.equal(h.command, "patch");
});

test("open takes an optional page", () => {
  assert.equal(parse(["open"]).page, null);
  assert.equal(parse(["open", "board", "--frame", "f1"]).page, "board");
});

test("page names: parts joined by /, any letters, spaces and most punctuation", () => {
  for (const ok of ["board", "story-map", "v1.2", "A_b", "a b", "a..b", "-x", "a/b", "project-a/overview", "Café Ideen", "日本語/ページ", "x/y/z (draft) #2"]) {
    assert.ok(validPageName(ok), ok);
  }
  for (const bad of ["", ".hidden", "..", "a/.b", "a/../b", "/a", "a/", "a//b", " a", "a ", "a.", "a\\b", "a:b", "a*b", "a?b", 'a"b', "a<b", "a>b", "a|b", "a\u0001b", "x".repeat(121), "e\u0301"]) {
    assert.ok(!validPageName(bad), JSON.stringify(bad));
  }
  assert.ok(validPageName(normalizePageName("e\u0301")), "NFD normalizes to a valid NFC name");
});

test("page names: folders, case clashes, export stems", () => {
  assert.deepEqual([folderOf("a/b/c"), baseName("a/b/c"), folderOf("top"), baseName("top"), joinName("", "x"), joinName("a", "x")], ["a/b", "c", "", "top", "x", "a/x"]);
  assert.deepEqual(foldersOf(["roadmap", "project-b/research/interviews", "project-a/api"]), ["project-a", "project-b", "project-b/research"]);
  const names = ["roadmap", "project-a/api"];
  assert.equal(caseClash("Roadmap", names), "roadmap");
  assert.equal(caseClash("Project-A/new", names), "project-a", "a folder in other capitals");
  assert.equal(caseClash("project-a/new", names), null);
  assert.equal(caseClash("Roadmap", names, "roadmap"), null, "a page may change its own capitals");
  assert.equal(exportStem("project-a/overview"), "project-a-overview");
});

test("command groups: bare group asks for group help; subcommands parse", () => {
  const g = parse(["band"]);
  assert.equal(g.groupHelp, true);
  assert.equal(parse(["band", "--help"]).groupHelp, true);
  const s = parse(["band", "set", "board", "release", "--y", "600", "--to", "800"]);
  assert.equal(s.name, "band set");
  assert.equal(s.page, "board");
  assert.deepEqual(s.args, { name: "release" });
  assert.equal(parse(["band", "set", "board", "r", "--x=-50"]).flags.x, "-50");
  assert.equal(parse(["band", "set", "--help"]).help, true);
  usage(["band", "move"], "unknown_command");
  usage(["band", "set", "board"], "missing_argument");
  usage(["band", "set", "board", "r"], "invalid_argument"); // neither --x nor --y
  usage(["band", "set", "board", "r", "--x", "1", "--y", "2"], "invalid_argument");
  usage(["band", "set", "board", "r", "--y", "600", "--to", "500"], "invalid_argument");
  usage(["band", "set", "board", "r", "--y", "abc"], "invalid_argument");
  usage(["band", "set", "board", "r", "--y", "-5"], "invalid_argument"); // ambiguous; message suggests --y=-5
  usage(["band", "list", "board", "--y", "5"], "unknown_option");
  usage(["band", "delete", "board", "a", "b"], "invalid_argument");
});

test("export: formats, pages and flag combinations", () => {
  const p = parse(["export", "flow", "more", "--format", "html", "--out", "d.html", "--title", "T"]);
  assert.deepEqual(p.pages, ["flow", "more"]);
  assert.equal(p.page, "flow");
  assert.equal(parse(["export", "flow", "--format", "png", "--frames", "--out", "dir", "--order", "a,b"]).flags.order, "a,b");
  usage(["export", "--format", "svg", "--out", "x"], "missing_argument");
  usage(["export", "flow", "--format", "svg"], "missing_argument"); // --out is required
  usage(["export", "flow", "--out", "x"], "missing_argument"); // --format is required
  usage(["export", "flow", "--format", "gif", "--out", "x"], "invalid_argument");
  usage(["export", "a", "b", "--format", "svg", "--out", "x"], "invalid_argument");
  usage(["export", "a", "--format", "svg", "--out", "x", "--frame", "f", "--frames"], "invalid_argument");
  usage(["export", "a", "--format", "pdf", "--out", "x", "--frame", "f"], "invalid_argument");
  usage(["export", "a", "--format", "html", "--out", "x", "--embed-scene"], "invalid_argument");
  usage(["export", "a", "--format", "svg", "--out", "x", "--title", "t"], "invalid_argument");
  usage(["export", "a", "--format", "svg", "--out", "x", "--order", "f"], "invalid_argument");
  usage(["export", "a", "--format", "html", "--out", "x", "--order", "a,,b"], "invalid_argument");
  usage(["export", "a|b", "--format", "html", "--out", "x"], "invalid_argument");
  assert.deepEqual(parse(["export", "project-a/overview", "--format", "svg", "--out", "x.svg"]).pages, ["project-a/overview"], "a page in a folder");
  assert.equal(parse(["get", "Cafe\u0301"]).page, "Café", "page names are normalized to NFC");
  usage(["describe", "board", "--format", "pdf"], "invalid_argument");
  // Image options: svg and png only; padding is 0-400 whole pixels.
  const img = parse(["export", "a", "--format", "png", "--out", "x.png", "--padding", "0", "--no-background", "--dark"]).flags;
  assert.deepEqual([img.padding, img["no-background"], img.dark], ["0", true, true]);
  for (const f of [["--dark"], ["--no-background"], ["--padding", "10"]]) usage(["export", "a", "--format", "html", "--out", "x", ...f], "invalid_argument");
  for (const p of ["-1", "401", "2.5", "lots"]) usage(["export", "a", "--format", "svg", "--out", "x", `--padding=${p}`], "invalid_argument");
});

test("library: subcommands parse; insert takes the item before the page", () => {
  assert.equal(parse(["library"]).groupHelp, true);
  assert.deepEqual(parse(["library", "search", "cloud", "icons", "--limit", "5"]).words, ["cloud", "icons"]);
  assert.deepEqual(parse(["library", "show", "aws", "--sheet", "a.png"]).args, { lib: "aws" });
  assert.deepEqual(parse(["library", "add", "./kit.excalidrawlib", "--as", "kit"]).args, { source: "./kit.excalidrawlib" });
  assert.deepEqual(parse(["library", "remove", "kit"]).args, { lib: "kit" });
  const p = parse(["library", "insert", "html-input-elements/button", "board", "--at", "120,80", "--frame", "f1", "--id", "btn"]);
  assert.equal(p.name, "library insert");
  assert.equal(p.page, "board");
  assert.deepEqual(p.args, { item: "html-input-elements/button" });
  assert.equal(parse(["library", "insert", "a.b/c", "board", "--at=-40,-5.5"]).flags.at, "-40,-5.5");
  usage(["library", "search"], "missing_argument");
  usage(["library", "search", "x", "--limit", "0"], "invalid_argument");
  usage(["library", "show"], "missing_argument");
  usage(["library", "list", "extra"], "invalid_argument");
  usage(["library", "insert"], "missing_argument");
  usage(["library", "insert", "a/b"], "missing_argument");
  usage(["library", "insert", "a/b", "board"], "missing_argument"); // --at
  usage(["library", "insert", "button", "board", "--at", "1,2"], "invalid_argument");
  usage(["library", "insert", "a/b", "board", "--at", "1"], "invalid_argument");
  usage(["library", "insert", "a/b", "board", "--at", "1,2", "--id", "has space"], "invalid_argument");
  assert.equal(parse(["library", "insert", "a/b", "board", "--at", "1,2", "--id", "SC-S1.1-search-img0"]).flags.id, "SC-S1.1-search-img0"); // dotted ids (story-map style)
});
