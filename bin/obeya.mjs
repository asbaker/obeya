#!/usr/bin/env node
import { run } from "../src/cli/main.mjs";

const { stdout, stderr, code } = await run(process.argv.slice(2), {
  onStderr: (line) => process.stderr.write(line + "\n"),
});
if (stderr) process.stderr.write(stderr + "\n");
if (stdout) process.stdout.write(stdout + "\n");
process.exitCode = code;
