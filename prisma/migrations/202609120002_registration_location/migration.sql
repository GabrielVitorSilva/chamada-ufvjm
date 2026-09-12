CREATE TABLE "registration_locations" (
 "id" SERIAL NOT NULL,
 "user_id" INTEGER NOT NULL,
 "latitude" DOUBLE PRECISION NOT NULL,
 "longitude" DOUBLE PRECISION NOT NULL,
 "accuracy" DOUBLE PRECISION NOT NULL,
 "created_at" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "registration_locations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "registration_locations_user_id_key" ON "registration_locations"("user_id");
CREATE INDEX "registration_locations_created_at_idx" ON "registration_locations"("created_at");
ALTER TABLE "registration_locations" ADD CONSTRAINT "registration_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
