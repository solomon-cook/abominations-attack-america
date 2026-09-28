import type { GameCommand, GameCommandEnvelope } from "@abominations/game-engine";
import { isHexKey } from "@abominations/game-engine";

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord => value !== null && typeof value === "object" && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isNonnegativeSafeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
const isHexKeyString = (value: unknown): value is string => isString(value) && isHexKey(value);
const isOneOf = (value: unknown, choices: readonly string[]) => isString(value) && choices.includes(value);
const optionalField = (record: JsonRecord, key: string, isValid: (value: unknown) => boolean) => record[key] === undefined || isValid(record[key]);
const isRetreatDestinationMap = (value: unknown) => isRecord(value) && Object.values(value).every((destination) => destination === "disappeared" || isHexKeyString(destination));

const mutationCards = ["Berserk", "Son of a Monster"] as const;
const researchCards = [
  "Defense Satellites",
  "Antimatter",
  "Stabilizer Ray",
  "Laser Fence",
  "Mecha-Monster",
  "Captain Colossal",
  "Blonde Lure",
  "Cutbacks",
  "Molecular Cannon",
  "Chopper Lift",
] as const;

/** Runtime shape check for the complete public game-command union. Game legality stays in the engine. */
export function isGameCommand(value: unknown): value is GameCommand {
  if (!isRecord(value) || !isString(value.type)) return false;
  switch (value.type) {
    case "move":
      return isStringArray(value.path) && optionalField(value, "continueMovement", isBoolean);
    case "move-unit":
      return isString(value.unitId) && isStringArray(value.path);
    case "disappear-monster":
    case "pass-move":
    case "draw-research":
    case "pass-deploy":
    case "concede":
    case "advance":
      return true;
    case "stay-piece":
      return isString(value.pieceId);
    case "resolve-fight":
      return optionalField(value, "battleId", isString)
        && optionalField(value, "spendInfamy", isNonnegativeSafeInteger)
        && optionalField(value, "targetUnitId", isString);
    case "launch-submarine":
      return isString(value.battleId) && isString(value.unitId);
    case "launch-submarine-at-monster":
      return isString(value.unitId) && isString(value.monsterId);
    case "use-mutation":
      return isOneOf(value.cardId, mutationCards) && optionalField(value, "battleId", isString);
    case "choose-mutation-card":
    case "choose-stabilizer-ray-mutation":
      return isString(value.cardId);
    case "resolve-chopper-lift":
      return isString(value.targetMonsterId) && isHexKeyString(value.destination);
    case "use-monster-ability":
      return value.ability === "gargantis-heal" && isStringArray(value.mutationCardIds);
    case "use-research":
      return isOneOf(value.cardId, researchCards)
        && optionalField(value, "battleId", isString)
        && optionalField(value, "mutationCardId", isString)
        && optionalField(value, "researchCardId", isString)
        && optionalField(value, "researchPlayerIndex", isNonnegativeSafeInteger)
        && optionalField(value, "choice", (choice) => isOneOf(choice, ["infamy", "retreat"]))
        && optionalField(value, "destination", isHexKeyString)
        && optionalField(value, "targetMonsterId", isString);
    case "retreat":
      return isRetreatDestinationMap(value.destinations);
    case "resolve-encounter":
      return optionalField(value, "choice", (choice) => isOneOf(choice, ["health", "infamy"]))
        && optionalField(value, "trophyUnitId", isString);
    case "deploy":
      return optionalField(value, "unitId", isString) && optionalField(value, "destination", isHexKeyString);
    case "redeploy":
      return isString(value.unitId) && optionalField(value, "destination", isHexKeyString);
    case "challenge-opponent":
      return isString(value.opponentMonsterId);
    case "challenge-giant":
      return isString(value.giantUnitId);
    case "resolve-challenge":
      return optionalField(value, "spendInfamy", isBoolean) && optionalField(value, "endTurn", isBoolean);
    default:
      return false;
  }
}

export function isGameCommandEnvelope(value: unknown): value is GameCommandEnvelope {
  if (!isRecord(value)) return false;
  if (typeof value.actionId !== "string" || value.actionId.length < 1 || value.actionId.length > 128) return false;
  if (typeof value.actorId !== "string" || value.actorId.length < 1 || value.actorId.length > 128) return false;
  if (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 0) return false;
  if (!Number.isSafeInteger(value.protocolVersion)) return false;
  return isGameCommand(value.command);
}
