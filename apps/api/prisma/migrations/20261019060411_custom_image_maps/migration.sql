-- CreateEnum
CREATE TYPE "GeoMapMode" AS ENUM ('world', 'image');

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "geoMapMediaId" UUID,
ADD COLUMN     "geoMapMode" "GeoMapMode";

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_geoMapMediaId_fkey" FOREIGN KEY ("geoMapMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
