import { setFailed } from "@actions/core";

import { run } from "./action.js";

run().catch((error) => {
  setFailed(error instanceof Error ? error.message : String(error));
});
