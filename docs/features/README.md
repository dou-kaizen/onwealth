# Features Documentation

Reserved for per-feature documentation as features land in milestones M2+.

## Deferred Topics

Documents below will be added when respective features ship:

| Feature | Milestone | Notes |
|---|---|---|
| authentication / authorization | M3 | JWT + OAuth (Google, GitHub) |
| pagination | first paginated endpoint | RFC 8288 Link header |
| file upload | M3+ | presign flow |
| notification | M3+ | email + push |
| two-factor authentication | M3+ | |
| activity log | M3+ | |
| term policy | M3+ | |
| third-party integration | M3+ | |
| analytics | M3+ | |
| feature flags | M3+ | |
| device management | M3+ | |

## Convention

Each feature doc lives at `docs/features/<feature-name>.md` and follows the same
template as infrastructure docs:

```
# {Feature} Documentation

## Overview
## Related Documents
## Table of Contents
## Configuration
## Structure
## Usage
## Creating New {X}
## Behavior
<!-- REFERENCES -->
```

See `../infrastructure/README.md` for the template rationale and Standards table.
