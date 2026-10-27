CREATE TABLE "ErrorReportAggregate" (
    "bucketDate" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErrorReportAggregate_pkey" PRIMARY KEY ("bucketDate", "category")
);
