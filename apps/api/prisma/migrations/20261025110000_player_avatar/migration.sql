-- a player's own photo (storage key under branding/), shown instead of the Google picture
ALTER TABLE "User" ADD COLUMN "avatarKey" TEXT;
