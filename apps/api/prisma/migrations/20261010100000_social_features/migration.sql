ALTER TABLE "UserAccount"
ADD COLUMN "presenceEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "presenceExpiresAt" TIMESTAMP(3);

CREATE TABLE "FriendInvitation" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FriendInvitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Friendship" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FriendInviteLink" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FriendInviteLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SavedOpponent" (
    "ownerId" TEXT NOT NULL,
    "opponentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SavedOpponent_pkey" PRIMARY KEY ("ownerId", "opponentId")
);

CREATE INDEX "FriendInvitation_recipientId_acceptedAt_declinedAt_revokedAt_expiresAt_idx"
ON "FriendInvitation"("recipientId", "acceptedAt", "declinedAt", "revokedAt", "expiresAt");
CREATE INDEX "FriendInvitation_senderId_createdAt_idx"
ON "FriendInvitation"("senderId", "createdAt");
CREATE UNIQUE INDEX "Friendship_userAId_userBId_key"
ON "Friendship"("userAId", "userBId");
CREATE INDEX "Friendship_userAId_createdAt_idx"
ON "Friendship"("userAId", "createdAt");
CREATE INDEX "Friendship_userBId_createdAt_idx"
ON "Friendship"("userBId", "createdAt");
CREATE UNIQUE INDEX "FriendInviteLink_tokenHash_key" ON "FriendInviteLink"("tokenHash");
CREATE INDEX "FriendInviteLink_senderId_createdAt_idx" ON "FriendInviteLink"("senderId", "createdAt");
CREATE INDEX "FriendInviteLink_expiresAt_acceptedAt_revokedAt_idx"
ON "FriendInviteLink"("expiresAt", "acceptedAt", "revokedAt");
CREATE INDEX "SavedOpponent_opponentId_idx" ON "SavedOpponent"("opponentId");

ALTER TABLE "FriendInvitation"
ADD CONSTRAINT "FriendInvitation_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "FriendInvitation_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Friendship"
ADD CONSTRAINT "Friendship_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "Friendship_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FriendInviteLink"
ADD CONSTRAINT "FriendInviteLink_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SavedOpponent"
ADD CONSTRAINT "SavedOpponent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "SavedOpponent_opponentId_fkey" FOREIGN KEY ("opponentId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
