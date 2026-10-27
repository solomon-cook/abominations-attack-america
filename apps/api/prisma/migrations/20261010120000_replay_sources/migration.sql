-- Preserve replay inputs for new matches. Existing rows remain null and are
-- explicitly non-replayable rather than being reconstructed from final state.
ALTER TABLE "GameRoom" ADD COLUMN "initialReplayState" JSONB;
ALTER TABLE "GameEvent" ADD COLUMN "replayCommand" JSONB;
