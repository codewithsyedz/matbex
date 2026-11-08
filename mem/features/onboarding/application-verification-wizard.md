---
name: Application Verification Wizard
description: Post-signup document upload wizard at /application/:id?email= for CR, VAT, IBAN, logo, cover, menu, opening hours; gated by edge function application-verification.
type: feature
---
After Register inserts a `tenant_applications` row (status=submitted) it navigates to `/application/:id?email=…`.

Stages: Welcome → Verify checklist → per-doc sub-views → Submit. On submit, edge function flips status to `pending_approval`. Already-pending/approved/rejected applications short-circuit to `UnderReviewScreen`.

- DB: `application_documents` (unique on application_id+doc_type), enum `application_doc_type`, plus url columns on `tenant_applications`.
- Storage: public bucket `application-docs`, writes locked to service_role (edge function only).
- Edge function `application-verification` (verify_jwt=false) actions: list, upload (multipart), delete, save-hours, submit. Validates by matching email to tenant_applications.email.
- Admin: `ApplicationDocumentsPanel` in `AdminApplicationQueue` review dialog allows per-doc approve/reject with reviewer notes.

Hook: `useApplicationVerification(applicationId, email)` exposes documents, upload, remove, saveOpeningHours, submit.
