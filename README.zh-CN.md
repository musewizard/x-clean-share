# X 干净分享链接

[English](README.md) | **简体中文**

X（Twitter）的「分享 → 复制链接」会往地址里塞追踪参数：

```
https://x.com/user/status/1234567890?a=xxxxxxxxxxxx&s=20
```

装上脚本后复制出来的是：

```
https://x.com/user/status/1234567890
```

`a` 是账号维度的标识，`s` 是来源标识。别人打开带参数的链接时，X 能看出这条链接是哪个账号分享出去的。删掉问号及之后的内容不影响链接本身。

## 安装

GreasyFork：https://greasyfork.org/zh-CN/scripts/602753

手动：装 Tampermonkey 或 Violentmonkey，新建脚本，粘贴 `x-clean-share.user.js` 全文。

## 会请求剪贴板权限

第一次点「复制链接」时，浏览器会询问是否允许读取剪贴板。

X 写剪贴板的方式换过几版。脚本除了拦截写入，还会读一次剪贴板做核对，发现参数还在就改掉。这个核对需要读权限。

拒绝也能用。写入拦截和菜单点击接管都不依赖它，只是少一层保险。

不想看到这个询问：把脚本里的 `CFG.fallbackClipboardFix` 改成 `false`。

## 它不做什么

- 不发任何网络请求
- 不读剪贴板以外的内容
- 只改推文链接（`x.com/<user>/status/<id>`）。主页、搜索页、其它网站原样放行
- 复制多行文字时不动，避免把正文改坏

## 用法

点分享菜单里的「复制链接」，没有别的步骤。

也可以按 `Ctrl + Shift + C`（macOS 是 `⌘ + Shift + C`）直接复制当前推文链接，这条路不经过 X 的任何代码。

## 已知限制

- 分享到其它平台时 X 用的是 t.co 短链，跳转后的地址仍带参数，脚本改不到
- 菜单接管靠匹配「复制链接」/「Copy link」这几个文案，X 改文案后会失效，其余拦截层不受影响

## 配置

脚本顶部 `CFG`：

| 项 | 默认 | 作用 |
|---|---|---|
| `dropAllQuery` | `true` | 推文链接 `?` 之后全丢；改 `false` 只删已知追踪参数 |
| `interceptMenu` | `true` | 接管菜单里「复制链接」的点击 |
| `fallbackClipboardFix` | `true` | 读剪贴板核对并修正（需授权） |
| `toast` | `true` | 右下角提示 |
| `extraHosts` | `[]` | 顺带清理的其它域名 |

## 许可

MIT
