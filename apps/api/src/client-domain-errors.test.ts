import assert from "node:assert/strict";
import test from "node:test";
import { additionalClientDomainErrors } from "./client-domain-errors.js";

test("stale room snapshot conflicts are classified as client domain errors", () => {
  assert.equal(additionalClientDomainErrors.has("The room changed before this action was committed. Refresh and try again."), true);
  assert.equal(additionalClientDomainErrors.has("database connection failed"), false);
});
