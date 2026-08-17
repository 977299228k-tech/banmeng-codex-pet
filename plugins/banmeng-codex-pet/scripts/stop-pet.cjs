const { petHealthKind, requestPet } = require("./pet-http.cjs");

(async () => {
  if (petHealthKind(await requestPet("/health"))) await requestPet("/quit", "POST");
})();
