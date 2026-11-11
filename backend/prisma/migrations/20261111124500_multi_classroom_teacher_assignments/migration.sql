CREATE TABLE "StaffClassroom" (
    "tenantId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    PRIMARY KEY ("tenantId", "staffId", "classroomId"),
    CONSTRAINT "StaffClassroom_tenantId_staffId_fkey"
      FOREIGN KEY ("tenantId", "staffId") REFERENCES "Staff" ("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StaffClassroom_tenantId_classroomId_fkey"
      FOREIGN KEY ("tenantId", "classroomId") REFERENCES "Classroom" ("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "StaffClassroom" ("tenantId", "staffId", "classroomId")
SELECT "tenantId", "id", "classroomId"
FROM "Staff"
WHERE "classroomId" IS NOT NULL;

CREATE INDEX "StaffClassroom_tenantId_classroomId_idx"
ON "StaffClassroom"("tenantId", "classroomId");
