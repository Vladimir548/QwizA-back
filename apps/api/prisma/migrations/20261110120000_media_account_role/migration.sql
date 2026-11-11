ALTER TABLE "UserAccount" DROP CONSTRAINT "UserAccount_role_check";
ALTER TABLE "UserAccount" ADD CONSTRAINT "UserAccount_role_check"
  CHECK ("role" IN ('user', 'media', 'admin'));
