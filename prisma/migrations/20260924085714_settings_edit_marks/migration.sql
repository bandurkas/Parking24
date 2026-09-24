-- AlterTable
ALTER TABLE "AutomationRule" ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "editedById" TEXT;

-- AlterTable
ALTER TABLE "MessageTemplate" ADD COLUMN     "defaultBody" TEXT,
ADD COLUMN     "defaultName" TEXT,
ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "editedById" TEXT;

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
