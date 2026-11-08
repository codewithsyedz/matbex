# Fix recurring backend warning

## Goal
Stop the healthy backend from being reported as unavailable after short preview-network or expired-session failures.

## Changes
- Replace the signed-in table request used by the warning banner with the backend's public health endpoint, so authentication state cannot cause a false outage warning.
- Add a short request timeout and check immediately on load.
- While degraded, retry more frequently and hide the banner after the first successful health response.
- Keep the existing two-failure threshold so one transient request does not show a warning.

## Verification
- Confirm the health request succeeds independently of login state.
- Verify the warning appears after two simulated failures and clears after recovery.
- Check the preview build and browser console.
