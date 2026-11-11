ALTER TABLE "GameRoom"
  ADD COLUMN "viewerInviteTokenHash" TEXT,
  ADD COLUMN "viewerInviteExpiresAt" TIMESTAMP(3);
