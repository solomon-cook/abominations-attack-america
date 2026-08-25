-- CreateTable
CREATE TABLE "CommandReceipt" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommandReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommandReceipt_roomId_actionId_key" ON "CommandReceipt"("roomId", "actionId");

-- CreateIndex
CREATE INDEX "CommandReceipt_roomId_version_idx" ON "CommandReceipt"("roomId", "version");

-- AddForeignKey
ALTER TABLE "CommandReceipt" ADD CONSTRAINT "CommandReceipt_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "GameRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
