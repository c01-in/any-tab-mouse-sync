# Privacy Policy - Any Tab Mouse Sync

Last updated: 2026-04-06

## Summary

Any Tab Mouse Sync does not collect, sell, or transmit your personal data to external servers.

## Data Handling

The extension stores only minimal local state in `chrome.storage.local`:

- joined tab IDs used for sync session state

This data stays on your device inside Chrome extension local storage.

## Network and Third Parties

- No analytics SDK
- No ad SDK
- No remote database/API for user tracking
- No data sale or sharing with third parties

## Permissions and Why They Are Needed

- `activeTab`: interact with the tab where the user activates the extension
- `tabs`: manage selected synced tabs and handle tab removal
- `storage`: persist sync membership locally
- `scripting`: inject the content script into selected tabs

## Security

The extension only works on supported web pages (`http://` and `https://`), and does not run on Chrome restricted pages such as `chrome://` pages.

## Contact

If you find a privacy or security issue, open an issue in this repository.
