import assert from "node:assert/strict";
import { resolveApiBaseUrl } from "../apps/web/src/api-origin";

assert.equal(resolveApiBaseUrl(undefined, "http://localhost:8787/"), "http://localhost:8787");
assert.equal(resolveApiBaseUrl(undefined, "https://play.example.test/"), "https://play.example.test");
assert.equal(resolveApiBaseUrl(" https://api.example.test/// ", "https://play.example.test"), "https://api.example.test");
assert.equal(resolveApiBaseUrl("https://api.example.test/path///", "https://play.example.test"), "https://api.example.test/path");

console.log("Web API origin resolution passed for development, same-origin production, and explicit API URLs.");
