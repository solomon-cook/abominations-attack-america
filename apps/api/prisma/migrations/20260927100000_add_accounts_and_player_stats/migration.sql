CREATE TYPE "AccountTokenPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

CREATE TABLE "UserAccount" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "emailVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "purpose" "AccountTokenPurpose" NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountToken_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Participant"
  ADD COLUMN "userId" TEXT,
  ADD COLUMN "disconnectedAt" TIMESTAMP(3),
  ADD COLUMN "botControlled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "botAssisted" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "GameRoom"
  ADD COLUMN "playerStats" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "GameEvent" ADD COLUMN "controlSource" TEXT NOT NULL DEFAULT 'human';

CREATE TABLE "WebSocketTicket" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "participantTokenHash" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebSocketTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlayerMatchStat" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "playerIndex" INTEGER NOT NULL,
  "username" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "monsterId" TEXT NOT NULL,
  "monsterName" TEXT NOT NULL,
  "branch" TEXT NOT NULL,
  "stompedTiles" INTEGER NOT NULL DEFAULT 0,
  "damageTaken" INTEGER NOT NULL DEFAULT 0,
  "healthGained" INTEGER NOT NULL DEFAULT 0,
  "luckTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "luckRolls" INTEGER NOT NULL DEFAULT 0,
  "botAssisted" BOOLEAN NOT NULL DEFAULT false,
  "rounds" INTEGER NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlayerMatchStat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserAccount_email_key" ON "UserAccount"("email");
CREATE UNIQUE INDEX "UserAccount_username_key" ON "UserAccount"("username");
CREATE UNIQUE INDEX "AccountSession_tokenHash_key" ON "AccountSession"("tokenHash");
CREATE INDEX "AccountSession_userId_expiresAt_idx" ON "AccountSession"("userId", "expiresAt");
CREATE UNIQUE INDEX "AccountToken_tokenHash_key" ON "AccountToken"("tokenHash");
CREATE INDEX "AccountToken_userId_purpose_expiresAt_idx" ON "AccountToken"("userId", "purpose", "expiresAt");
CREATE INDEX "Participant_userId_role_idx" ON "Participant"("userId", "role");
CREATE UNIQUE INDEX "Participant_roomId_userId_key" ON "Participant"("roomId", "userId");
CREATE INDEX "Participant_botControlled_disconnectedAt_idx" ON "Participant"("botControlled", "disconnectedAt");
CREATE UNIQUE INDEX "WebSocketTicket_tokenHash_key" ON "WebSocketTicket"("tokenHash");
CREATE INDEX "WebSocketTicket_roomId_participantId_expiresAt_idx" ON "WebSocketTicket"("roomId", "participantId", "expiresAt");
CREATE UNIQUE INDEX "PlayerMatchStat_roomId_participantId_key" ON "PlayerMatchStat"("roomId", "participantId");
CREATE INDEX "PlayerMatchStat_userId_completedAt_idx" ON "PlayerMatchStat"("userId", "completedAt");
CREATE INDEX "PlayerMatchStat_outcome_completedAt_idx" ON "PlayerMatchStat"("outcome", "completedAt");

ALTER TABLE "AccountSession" ADD CONSTRAINT "AccountSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountToken" ADD CONSTRAINT "AccountToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WebSocketTicket" ADD CONSTRAINT "WebSocketTicket_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "GameRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebSocketTicket" ADD CONSTRAINT "WebSocketTicket_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerMatchStat" ADD CONSTRAINT "PlayerMatchStat_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "GameRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerMatchStat" ADD CONSTRAINT "PlayerMatchStat_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerMatchStat" ADD CONSTRAINT "PlayerMatchStat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
