# X Clean Share Link

[简体中文](README.zh-CN.md) | **English**

X's "Share → Copy link" appends tracking parameters to the URL:

```
https://x.com/user/status/1234567890?a=xxxxxxxxxxxx&s=20
```

With this script you get:

```
https://x.com/user/status/1234567890
```

`a` identifies the sharing account, `s` the source. When someone opens a tagged link, X can tell which account shared it. Dropping everything after the `?` does not affect the link itself.

## Install

GreasyFork: https://greasyfork.org/scripts/602753

Or manually: install Tampermonkey or Violentmonkey, create a new script, paste the whole `x-clean-share.user.js`.

## Clipboard permission

The first time you click "Copy link", the browser asks whether the page may read the clipboard.

X has changed how it writes to the clipboard more than once. Besides hooking the write, the script reads the clipboard once to check the result and rewrites it if the parameters are still there. That check needs read access.

You can deny it and still use the script. The write hooks and the menu-click interception do not depend on it; you just lose one fallback layer.

To skip the prompt entirely, set `CFG.fallbackClipboardFix` to `false`.

## What it does not do

- No network requests
- Reads nothing but the clipboard
- Only rewrites post links (`x.com/<user>/status/<id>`). Profiles, search pages and other sites pass through untouched
- Leaves multi-line text alone, so pasted content is never mangled

## Usage

Click "Copy link" in the share menu. Nothing else.

You can also press `Ctrl + Shift + C` (`⌘ + Shift + C` on macOS) to copy the current post link directly, bypassing X's code entirely.

## Known limits

- When sharing to other platforms X uses t.co short links; the destination still carries parameters and cannot be rewritten here
- Menu interception matches the labels "复制链接" / "Copy link". If X renames them this layer stops working; the other layers are unaffected

## Config

`CFG` at the top of the script:

| Key | Default | Effect |
|---|---|---|
| `dropAllQuery` | `true` | Drop everything after `?`; set `false` to remove only known tracking params |
| `interceptMenu` | `true` | Take over the "Copy link" menu click |
| `fallbackClipboardFix` | `true` | Read back the clipboard and fix it (needs permission) |
| `toast` | `true` | Bottom-right notice |
| `extraHosts` | `[]` | Extra domains to clean |

## License

MIT
