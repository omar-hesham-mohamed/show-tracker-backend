-- DropIndex
DROP INDEX "Show_tmdbId_key";

-- AlterTable
ALTER TABLE "Show" ADD COLUMN     "watchProviders" JSONB,
ADD COLUMN     "watchProvidersSyncedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Show_tmdbId_mediaType_key" ON "Show"("tmdbId", "mediaType");
