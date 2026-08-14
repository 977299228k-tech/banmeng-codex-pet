const http = require("node:http");
const request = http.request({ hostname: "127.0.0.1", port: 47831, path: "/quit", method: "POST", timeout: 1000 });
request.on("error", () => process.exit(0));
request.end();
