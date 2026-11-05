ALTER TABLE "GameRoom" ADD COLUMN "matchStarted" BOOLEAN NOT NULL DEFAULT false;

-- Preserve rooms created by earlier builds that had already progressed beyond the new pre-match lobby.
UPDATE "GameRoom" SET "matchStarted" = true WHERE "status" <> 'WAITING' OR "version" > 0;
