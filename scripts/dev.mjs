import { spawn } from "node:child_process";
import { join } from "node:path";

const children = [];

function start(command, args, label) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: "inherit",
    shell: false,
  });
  child.on("exit", (code) => {
    if (code && code !== 0) console.error(`${label} exited with code ${code}.`);
  });
  children.push(child);
  return child;
}

start(process.execPath, [join(process.cwd(), "server", "downloader-server.mjs")], "Downloader service");
start(process.execPath, [join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "dev"], "Next.js");

function stop() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});
