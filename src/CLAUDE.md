# BuhurtOS frontend rules

These rules apply when working in `src/`.

- Keep tournament-day UI mobile-first and usable one-handed on a phone.
- Prefer short, obvious actions and plain sporting language over database terminology.
- Do not rely on the UI as a security boundary. Authorization belongs in the database/RPC/RLS layer.
- Reuse existing components, data functions and interaction patterns before introducing new abstractions.
- Keep critical tournament actions usable without drag-and-drop.
- Avoid broad visual rewrites when the task is a focused feature or fix.
- For changed UI behaviour, verify the affected workflow in the running app at a phone viewport. Check desktop too when layout behaviour is affected.
