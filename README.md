<p align="center">
<img src="https://raw.githubusercontent.com/Burhanverse/assets/refs/heads/main/postify.png" alt="RSS-ify Bot" width="130">
</p>
<h1 align="center">Postify</h1>

<p align="center"><b>A Telegram channel management bot built with TypeScript, grammy, MongoDB & Agenda to manage your channel contents effortlessly!</b></p>

<div align="center">

[![GitHub commit activity](https://img.shields.io/github/commit-activity/m/Burhanverse/postify?logo=git&label=commit)](https://github.com/Burhanverse/postify/commits)
[![Code quality](https://img.shields.io/codefactor/grade/github/Burhanverse/postify?logo=codefactor)](https://www.codefactor.io/repository/github/Burhanverse/postify)
[![GitHub stars](https://img.shields.io/github/stars/Burhanverse/postify?style=social)](https://github.com/Burhanverse/postify/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/Burhanverse/postify?style=social)](https://github.com/Burhanverse/postify/fork)

</div>

## Features (Roadmap)

| Area                                  | Status              |
| ------------------------------------- | ------------------- |
| Channel connection (public & private) | Implemented         |
| Permission checks (admin rights)      | Basic (post rights) |
| Multiple channels per user            | Implemented         |
| Draft creation (text, media, buttons) | Implemented         |
| Inline buttons (no counters)          | Implemented         |
| Scheduling (presets + custom)         | Implemented         |
| Timezone preferences                  | Implemented         |
| Queues (scheduled list)               | Testing             |
| Send/Schedule & Pin the post          | Implemented         |
| Group Topic Support                   | Planned             |
| Link personal bot                     | Implemented         |

## Roadmap (Upcoming Ideas)

- Add support for shared-access to other channel admins
- Improve text formating of the response messages.

## Development

Create a `.env` file:

```
BOT_TOKEN=123456:ABC...
MONGODB_URI=mongodb://localhost:27017/postify
DB_NAME=postify
ENCRYPTION_KEY=
LOG_LEVEL=debug
```

Encryption: Provide `ENCRYPTION_KEY` (32‑byte hex or base64). Tokens are stored with AES‑256‑GCM in `tokenEncrypted`.

If `ENCRYPTION_KEY` is absent, an ephemeral key is used (NOT for production) and tokens become unreadable after restart.
Install deps and run in dev mode:

```
npm install
npm run dev
```

### Tests

Run unit tests:

```
npm test
```

## Text Formatting

Postify supports rich text formatting using HTML tags:

- `<b>bold text</b>` for **bold**
- `<i>italic text</i>` for _italic_
- `<code>inline code</code>` for `monospace`
- `<pre>code block</pre>` for code blocks
- `<blockquote>quoted text</blockquote>` for quotes

Example:

```
<b>Hello</b> <i>world</i>! Here's some <code>code</code>:

<pre>
function hello() {
  console.log("Hello world!");
}
</pre>

<blockquote>This is a quote</blockquote>
```

## Credits

AI assistants that helped in the development of this project:

- Claude 4
- ChatGPT 5
- Gemini 2.5 Pro
- Grok Code

_Made with ❤️ by Burhanverse_
