import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "docs/release-evidence-schema.json");

const fail = (message) => {
  throw new Error(`release evidence schema verification failed: ${message}`);
};

const readJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`${path.relative(root, filePath)} is not valid JSON (${error.message})`);
  }
};

const resolveRef = (schema, ref) => {
  if (!ref.startsWith("#/$defs/")) fail(`unsupported schema reference ${ref}`);
  const definition = schema.$defs?.[ref.slice("#/$defs/".length)];
  if (!definition) fail(`missing schema definition for ${ref}`);
  return definition;
};

const matchesType = (value, type) =>
  type === "null" ? value === null :
  type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value) :
  type === "array" ? Array.isArray(value) :
  type === "string" ? typeof value === "string" : false;

const validate = (value, schema, rootSchema, location = "$", seen = new Set()) => {
  if (schema.$ref) {
    if (seen.has(schema.$ref)) fail(`${location} has a cyclic reference`);
    const nextSeen = new Set(seen).add(schema.$ref);
    return validate(value, resolveRef(rootSchema, schema.$ref), rootSchema, location, nextSeen);
  }
  if (schema.type && !(Array.isArray(schema.type) ? schema.type.some((type) => matchesType(value, type)) : matchesType(value, schema.type))) {
    fail(`${location} has the wrong type`);
  }
  if (schema.enum && !schema.enum.includes(value)) fail(`${location} has an unexpected value`);
  if (schema.required) {
    for (const key of schema.required) if (!Object.prototype.hasOwnProperty.call(value, key)) fail(`${location}.${key} is required`);
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) if (!schema.properties?.[key]) fail(`${location}.${key} is not allowed`);
  }
  for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
    if (Object.prototype.hasOwnProperty.call(value, key)) validate(value[key], childSchema, rootSchema, `${location}.${key}`, seen);
  }
  if (schema.items) for (const [index, item] of value.entries()) validate(item, schema.items, rootSchema, `${location}[${index}]`, seen);
};

const schema = readJson(schemaPath);
if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") fail("unexpected draft declaration");
if (schema.type !== "object" || schema.additionalProperties !== false) fail("root must be a closed object schema");

const required = ["environment", "commit", "migration", "soak", "smoke", "backup_restore", "security", "rollback", "approvals"];
if (JSON.stringify(schema.required) !== JSON.stringify(required)) fail("required release categories are incomplete or reordered");
for (const key of required) if (!schema.properties?.[key]?.$ref) fail(`${key} must use the shared evidence definition`);

const template = schema["x-empty-template"];
if (!template) fail("x-empty-template is missing");
validate(template, schema, schema, "x-empty-template");
for (const key of required) {
  if (template[key].status !== "not_recorded" || template[key].evidence.length !== 0) fail(`empty template ${key} must remain not_recorded with no evidence`);
}

console.log("release evidence schema: schema structure valid");
console.log("release evidence schema: explicitly empty template valid and not_recorded");
