ALTER TABLE "GameEvent" ADD COLUMN "actionId" TEXT;

UPDATE "GameEvent"
SET "actionId" = "payload" #>> '{receipt,actionId}'
WHERE jsonb_typeof("payload" #> '{receipt,actionId}') = 'string';

CREATE UNIQUE INDEX "GameEvent_roomId_actionId_key" ON "GameEvent"("roomId", "actionId");
