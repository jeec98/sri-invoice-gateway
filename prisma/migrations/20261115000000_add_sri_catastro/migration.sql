-- CreateEnum
CREATE TYPE "SriCatalogSource" AS ENUM ('AGENTS', 'SPECIAL', 'RIMPE');

-- CreateEnum
CREATE TYPE "SriSyncStatus" AS ENUM ('IDLE', 'SYNCING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "SriRegimenType" AS ENUM ('GENERAL', 'RIMPE_EMPRENDEDOR', 'RIMPE_NEGOCIO_POPULAR');

-- CreateTable
CREATE TABLE "sri_catalog_sync_states" (
    "source" "SriCatalogSource" NOT NULL,
    "package_slug" VARCHAR(120) NOT NULL,
    "resource_id" VARCHAR(80),
    "resource_url" TEXT,
    "etag" VARCHAR(128),
    "last_modified" VARCHAR(80),
    "remote_modified_at" VARCHAR(80),
    "content_length" INTEGER,
    "file_sha256" VARCHAR(64),
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "status" "SriSyncStatus" NOT NULL DEFAULT 'IDLE',
    "last_error" TEXT,
    "last_checked_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sri_catalog_sync_states_pkey" PRIMARY KEY ("source")
);

-- CreateTable
CREATE TABLE "sri_taxpayer_specials" (
    "ruc" VARCHAR(13) NOT NULL,
    "razon_social" VARCHAR(300),
    "regimen" "SriRegimenType" NOT NULL DEFAULT 'GENERAL',
    "is_special_taxpayer" BOOLEAN NOT NULL DEFAULT false,
    "special_taxpayer_res" VARCHAR(30),
    "is_withholding_agent" BOOLEAN NOT NULL DEFAULT false,
    "withholding_agent_res" VARCHAR(30),
    "obligated_accounting" BOOLEAN,
    "taxpayer_state" VARCHAR(40),
    "in_agents_catalog" BOOLEAN NOT NULL DEFAULT false,
    "in_special_catalog" BOOLEAN NOT NULL DEFAULT false,
    "in_rimpe_catalog" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sri_taxpayer_specials_pkey" PRIMARY KEY ("ruc")
);

-- CreateTable
CREATE TABLE "sri_taxpayer_profiles" (
    "ruc" VARCHAR(13) NOT NULL,
    "razon_social" VARCHAR(300) NOT NULL,
    "nombre_comercial" VARCHAR(300),
    "tipo_persona" VARCHAR(20) NOT NULL,
    "tipo_contribuyente" VARCHAR(120),
    "regimen" "SriRegimenType" NOT NULL DEFAULT 'GENERAL',
    "obligated_accounting" BOOLEAN NOT NULL DEFAULT false,
    "is_special_taxpayer" BOOLEAN NOT NULL DEFAULT false,
    "special_taxpayer_res" VARCHAR(30),
    "is_withholding_agent" BOOLEAN NOT NULL DEFAULT false,
    "withholding_agent_res" VARCHAR(30),
    "taxpayer_state" VARCHAR(40) NOT NULL DEFAULT 'ACTIVO',
    "actividad_economica" VARCHAR(300),
    "direccion_matriz" VARCHAR(300),
    "source" VARCHAR(30) NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sri_taxpayer_profiles_pkey" PRIMARY KEY ("ruc")
);

-- CreateIndex
CREATE INDEX "sri_taxpayer_specials_regimen_idx" ON "sri_taxpayer_specials"("regimen");

-- CreateIndex
CREATE INDEX "sri_taxpayer_specials_is_withholding_agent_idx" ON "sri_taxpayer_specials"("is_withholding_agent");

-- CreateIndex
CREATE INDEX "sri_taxpayer_specials_is_special_taxpayer_idx" ON "sri_taxpayer_specials"("is_special_taxpayer");

-- CreateIndex
CREATE INDEX "sri_taxpayer_profiles_expires_at_idx" ON "sri_taxpayer_profiles"("expires_at");

