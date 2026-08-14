const http = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", async () => {
  let payload = {};
  try { payload = input ? JSON.parse(input) : {}; } catch {}
  if (!(await post(payload))) {
    const start = spawn(process.execPath, [path.join(__dirname, "start-pet.cjs")], { detached: true, windowsHide: true, stdio: "ignore" });
    start.unref();
    await new Promise((resolve) => setTimeout(resolve, 900));
    await post(payload);
  }
  process.stdout.write("{}");
});

function post(payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const request = http.request({
      hostname: "127.0.0.1",
      port: 47831,
      path: "/event",
      method: "POST",
      timeout: 800,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    }, (response) => { response.resume(); resolve(response.statusCode === 200); });
    request.on("error", () => resolve(false));
    request.on("timeout", () => { request.destroy(); resolve(false); });
    request.end(body);
  });
}
