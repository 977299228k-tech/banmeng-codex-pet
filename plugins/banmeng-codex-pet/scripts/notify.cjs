const { spawn } = require("node:child_process");
const path = require("node:path");
const { petHealthKind, requestPet } = require("./pet-http.cjs");
const packageInfo = require("../package.json");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", async () => {
  let payload = {};
  try { payload = input ? JSON.parse(input) : {}; } catch {}
  if (typeof payload?.hook_event_name !== "string") {
    process.stdout.write("{}");
    return;
  }
  if (!(await post(payload))) {
    const start = spawn(process.execPath, [path.join(__dirname, "start-pet.cjs")], { detached: true, windowsHide: true, stdio: "ignore" });
    start.unref();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (await post(payload)) break;
    }
  }
  process.stdout.write("{}");
});

function post(payload) {
  return requestPet("/health").then((health) => {
    if (petHealthKind(health) !== "current" || health.data.version !== packageInfo.version) return false;
    return requestPet("/event", "POST", payload).then((result) => result.ok);
  });
}
