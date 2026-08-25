-- Make User.phone a unique login identifier (sparse: NULLs don't collide).
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
