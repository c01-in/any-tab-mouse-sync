# Any Tab Mouse Sync (Chrome Extension)

Any Tab Mouse Sync provides two-way mouse and scroll syncing between selected tabs.

Chrome Web Store:
<https://chromewebstore.google.com/detail/any-tab-mouse-sync/cclfnohkciiakolplcccpijkofpjikeo>

## Features

- Mouse movement (with remote cursor visualization)
- Hover behavior (via remote move replay)
- Click, right-click, and double-click (with ripple feedback)
- Drag interactions (pointer down/move/up replay)
- Wheel interactions
- Scrolling (synchronized by scroll ratio)

## Install (Developer Mode)

1. Open Chrome: `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this project folder (the folder that contains `manifest.json`)

## Usage

1. Open two tabs you want to sync
2. Click the extension icon in each tab
3. Click **Join Sync**
4. Start moving/clicking/scrolling in either tab

## Permissions Explained

This extension requests:

- `activeTab`: operate on the tab where you click the extension
- `tabs`: track joined tab IDs and tab lifecycle (close/remove)
- `storage`: persist joined tab IDs locally
- `scripting`: inject `content.js` when a tab is joined

No remote server is required for sync.

## Privacy

See [PRIVACY.md](./PRIVACY.md).

## Limitations

- Restricted pages such as `chrome://*` and Chrome Web Store pages do not allow script injection
- If page heights differ a lot, scroll sync uses ratio alignment instead of exact pixel matching

## License

MIT - see [LICENSE](./LICENSE).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Security

See [SECURITY.md](./SECURITY.md).
