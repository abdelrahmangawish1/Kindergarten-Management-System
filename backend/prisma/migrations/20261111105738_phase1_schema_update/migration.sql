/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,accessCode]` on the table `Child` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Child_accessCode_key";

-- CreateTable
CREATE TABLE "Homework" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "createdByStaffId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT [],
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Homework_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Homework_tenantId_classroomId_fkey" FOREIGN KEY ("tenantId", "classroomId") REFERENCES "Classroom" ("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Homework_tenantId_createdByStaffId_fkey" FOREIGN KEY ("tenantId", "createdByStaffId") REFERENCES "Staff" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HomeworkSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "homeworkId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attachments" JSONB NOT NULL DEFAULT [],
    "grade" DECIMAL,
    "feedback" TEXT,
    "gradedAt" DATETIME,
    "gradedByStaffId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HomeworkSubmission_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HomeworkSubmission_tenantId_homeworkId_fkey" FOREIGN KEY ("tenantId", "homeworkId") REFERENCES "Homework" ("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HomeworkSubmission_tenantId_childId_fkey" FOREIGN KEY ("tenantId", "childId") REFERENCES "Child" ("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HomeworkSubmission_tenantId_gradedByStaffId_fkey" FOREIGN KEY ("tenantId", "gradedByStaffId") REFERENCES "Staff" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Staff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "classroomId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "role" TEXT NOT NULL,
    "specialization" TEXT,
    "salary" DECIMAL,
    "hireDate" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Staff_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Staff_tenantId_classroomId_fkey" FOREIGN KEY ("tenantId", "classroomId") REFERENCES "Classroom" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Staff" ("createdAt", "email", "hireDate", "id", "name", "phone", "role", "salary", "specialization", "tenantId", "updatedAt") SELECT "createdAt", "email", "hireDate", "id", "name", "phone", "role", "salary", "specialization", "tenantId", "updatedAt" FROM "Staff";
DROP TABLE "Staff";
ALTER TABLE "new_Staff" RENAME TO "Staff";
CREATE INDEX "Staff_tenantId_role_idx" ON "Staff"("tenantId", "role");
CREATE INDEX "Staff_tenantId_classroomId_idx" ON "Staff"("tenantId", "classroomId");
CREATE UNIQUE INDEX "Staff_tenantId_id_key" ON "Staff"("tenantId", "id");
CREATE UNIQUE INDEX "Staff_tenantId_email_key" ON "Staff"("tenantId", "email");
CREATE TABLE "new_Tenant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nextStudentAccessCodeSequence" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Tenant" ("createdAt", "id", "name", "slug", "status", "updatedAt") SELECT "createdAt", "id", "name", "slug", "status", "updatedAt" FROM "Tenant";
DROP TABLE "Tenant";
ALTER TABLE "new_Tenant" RENAME TO "Tenant";
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");
CREATE INDEX "Tenant_status_idx" ON "Tenant"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Homework_tenantId_classroomId_dueDate_idx" ON "Homework"("tenantId", "classroomId", "dueDate");

-- CreateIndex
CREATE INDEX "Homework_tenantId_createdByStaffId_idx" ON "Homework"("tenantId", "createdByStaffId");

-- CreateIndex
CREATE UNIQUE INDEX "Homework_tenantId_id_key" ON "Homework"("tenantId", "id");

-- CreateIndex
CREATE INDEX "HomeworkSubmission_tenantId_childId_submittedAt_idx" ON "HomeworkSubmission"("tenantId", "childId", "submittedAt");

-- CreateIndex
CREATE INDEX "HomeworkSubmission_tenantId_homeworkId_status_idx" ON "HomeworkSubmission"("tenantId", "homeworkId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HomeworkSubmission_tenantId_homeworkId_childId_key" ON "HomeworkSubmission"("tenantId", "homeworkId", "childId");

-- CreateIndex
CREATE UNIQUE INDEX "Child_tenantId_accessCode_key" ON "Child"("tenantId", "accessCode");
