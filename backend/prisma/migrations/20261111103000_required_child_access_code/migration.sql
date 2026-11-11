-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Child" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "dateOfBirth" DATETIME NOT NULL,
    "gender" TEXT,
    "accessCode" TEXT NOT NULL,
    "classId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Child_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Child_tenantId_classId_fkey" FOREIGN KEY ("tenantId", "classId") REFERENCES "Classroom" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Child" ("accessCode", "classId", "createdAt", "dateOfBirth", "fullName", "gender", "id", "tenantId", "updatedAt") SELECT "accessCode", "classId", "createdAt", "dateOfBirth", "fullName", "gender", "id", "tenantId", "updatedAt" FROM "Child";
DROP TABLE "Child";
ALTER TABLE "new_Child" RENAME TO "Child";
CREATE UNIQUE INDEX "Child_accessCode_key" ON "Child"("accessCode");
CREATE INDEX "Child_tenantId_fullName_idx" ON "Child"("tenantId", "fullName");
CREATE UNIQUE INDEX "Child_tenantId_id_key" ON "Child"("tenantId", "id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
