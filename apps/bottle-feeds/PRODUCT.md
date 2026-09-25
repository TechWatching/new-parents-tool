# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

New parents recording bottle feeds and growth measurements, often while tired or managing a busy care routine. They need to log information quickly, understand recent patterns, and share a clear record with a clinician when needed.

## Product Purpose

Little Sips is a privacy-first, local-first tracker for bottle feeds and baby growth. It helps families keep reliable records without adding pressure, while optional sync, export, and clinician-ready reports keep information available when it matters.

## Positioning

Records stay in the browser by default. Cloud sync is an explicit opt-in; families can also export a recovery backup and create a clinician-readable PDF locally without uploading report data.

## Operating Context

Parents record feeds and weights during routine care, review trends, and share selected records with a clinician. They can export and import backups; families who opt into cloud sync can share a baby's history with a second parent. Local records can be lost when browser site data is cleared, so backups matter.

## Capabilities and Constraints

- The static web app stores records locally in IndexedDB and works without cloud configuration. Offline reopening requires a completed first visit and cached app assets.
- Optional Supabase sync uses Google or Microsoft sign-in. One family holds one baby's history and at most two parents; guest records are never silently uploaded when joining or creating a family.
- Import and export provide JSON recovery backups. Clinician-readable PDFs are generated on the device for a selected date range; PDFs are not recovery backups.
- Pending local edits survive network interruptions, and sync conflicts require an explicit choice rather than silently discarding either version.

## Brand Commitments

Little Sips is cosy, reassuring, and quietly capable. The interface should help parents feel calm, confident, and supported—never judged, alarmed, or overwhelmed. Avoid cold clinical dashboards, high-pressure productivity tools, and overly whimsical baby-app aesthetics. Do not make routine care feel like a performance metric or a complex data-management task.

## Evidence on Hand

The implemented app and its documented behavior are in `src/` and `README.md`; browser regression paths are in `e2e/`. No testimonials, customer claims, or performance benchmarks are established here.

## Product Principles

- Keep routine logging simple enough for a tired moment.
- Reassure through clear, gentle feedback rather than urgency.
- Make privacy and user control easy to understand.
- Surface useful context without turning care into a scorecard.
- Support confident handoffs to clinicians and co-parents.

## Accessibility & Inclusion

Use strong contrast, clear language, familiar controls, and a reduced-motion experience. No additional accessibility requirements are currently specified.
