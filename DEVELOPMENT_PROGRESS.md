# Kindergarten Management System — Development Progress

## Architecture

- Frontend: React + TypeScript + Vite, with login/registration and a role-aware workspace UI.
- API: Express + TypeScript + Zod validation.
- Data: SQLite via Prisma for local development. Tenant ownership is part of every core record and composite foreign keys prevent cross-tenant references.
- Authentication: short-lived JWT bearer tokens; the tenant is taken from the authenticated database user, never from a client-supplied tenant header.

## Completed in this milestone

### Authentication and RBAC
- `POST /api/auth/register` creates a kindergarten, default settings, and its first `ADMIN`.
- `POST /api/auth/login` authenticates using workspace slug, email, and password.
- `GET /api/auth/me` validates the current token and returns the user and tenant profile.
- Passwords use bcrypt; tokens expire after eight hours; inactive accounts and tenants cannot use an issued token.
- `ADMIN`, `TEACHER`, and `PARENT` roles have separate route permissions. The last active administrator cannot be removed or deactivated.

### Tenant-scoped operations
- CRUD endpoints are available for users, children, classrooms, enrollments, and payments.
- Attendance is recorded per classroom and day, with one status per child per day.
- Workspace events support audience-targeted CRUD for administrators and teachers.
- Financial endpoints provide revenue/expense summaries and tenant-scoped expense and payment management.
- All lookups, updates, and deletes include the authenticated `tenantId`.
- Child-to-classroom, child-to-parent, enrollment-to-child, and payment-to-child references are tenant-scoped.
- Parents can only read children and payments linked to their own parent profile.
- Teachers can read classroom, child, and enrollment records; administrative writes and financial records are restricted to `ADMIN`.

### Frontend
- Login and workspace registration screens are connected to the API.
- The JWT is kept in `sessionStorage` and restored through `/api/auth/me`.
- Dashboard cards, children, classrooms, and payment views are loaded from authenticated API endpoints.
- The default Overview view contains KPI cards and summary charts only; management panels are shown separately when selected from the sidebar.
- Admins can upload or remove workspace logos from Workspace Settings; uploaded logos are tenant-scoped, served by the API, and shown in the dashboard and workspace sign-in branding.
- Teachers sign in to a dedicated portal with no admin overview, finance, or workspace settings; their classroom and student lists are limited to classrooms assigned to their matching staff record.
- Administrators can assign a teacher to multiple classrooms from Staff Management. Teacher accounts must use the same email address as their staff record.
- Teachers can publish classroom homework with a title, description, instructions, due date, and external reference links; the grading view accepts parent text/file submissions and supports scores and feedback.
- The parent portal displays assignments only for the linked child's classroom, accepts written responses or PNG/JPEG/WebP/PDF uploads, and displays teacher grading and feedback.
- Admins can create, edit, and delete users, children, classrooms, enrollments, and payments from the dashboard.
- Attendance, calendar/events, and finance views are available in the role-aware dashboard.
- Teachers have read access to children, classrooms, and enrollments; parent users only see their linked children and payment records.
- Admins can manage staff and import children/staff from validated CSV or XLSX files.
- Parents sign in to a child-specific portal with their linked account credentials and that child's access code; non-homework records remain read-only.
- Admins and teachers can open the in-app AI Assistant for classroom ideas and aggregate, role-scoped workspace summaries. The backend uses Vercel AI SDK with `gpt-4o-mini` when `OPENAI_API_KEY` is configured; without a key, it provides a streamed demo response.
- English and Arabic UI translations are available with RTL layout support.
- Notification center, financial exports, and attendance PDF/Excel reports are available to authorized workspace users.

### Staff, family portal, and workspace operations
- Staff records support tenant-scoped CRUD; child access codes are sequential (`KG-YYYY-NNN`), unique per workspace, transactionally allocated, and hidden from teacher listings.
- Parent login requires the linked parent email, password, and student access code. Its separate, four-hour token is rate-limited and revoked when the parent-child link or active account is removed.
- CSV/XLSX imports are capped at 2 MB and 1,000 data rows; data is validated before transactional writes.
- Notifications are scoped to the authenticated workspace and user; finance exports include a summary sheet/section.

### Persistence and setup
- The Prisma schema is in `backend/prisma/schema.prisma`.
- SQLite database: `backend/prisma/dev.db`.
- Migrations are stored in `backend/prisma/migrations/`.
- Configure `backend/.env` from `.env.example`, then run:

  ```powershell
  npm --prefix backend run prisma:generate
  npm --prefix backend run prisma:migrate
  npm run dev
  ```

- `OPENAI_API_KEY` is optional. Set it in `backend/.env` to enable generated assistant responses; leave it empty to use demo responses.

- `JWT_SECRET` must be at least 32 characters in production. Set `DATABASE_URL` and `CORS_ORIGIN` for the deployment environment.

## Validation and limitation

- Prisma schema validation passes and all four SQLite migrations are applied.
- Frontend production build, backend TypeScript build, and frontend lint pass (lint reports the existing Fast Refresh export warning in `i18n.tsx`).
- API smoke tests covered staff creation/listing/deletion, parent portal access, attendance, payments/finance calculations, events, notifications, CSV and XLSX import, and PDF/XLSX report downloads.
- Workspace branding smoke test verified public sign-in lookup, admin-only logo upload, static image serving, `/api/auth/me` updates, and logo removal.
- Homework workflow smoke test verified multi-classroom teacher scoping, classroom-specific assignment creation, parent/child homework isolation, text and PDF submission, protected file access, grading, parent grade visibility, and denial of the teacher global dashboard endpoint.
- Automated API tests should additionally cover tenant isolation, RBAC, import rollback, and rate-limit behavior.

## Remaining work

1. Add automated API tests using a disposable SQLite test database, including tenant-isolation, RBAC, import rollback, and rate-limit cases.
2. Complete production deployment configuration and broader end-to-end testing.
