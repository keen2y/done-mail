<div align="center">
  <img src="./public/static/logo-mark.svg" alt="DoneMail" width="96" height="96">

  <h1>DoneMail</h1>

  <p><strong>A high-performance, self-hosted private mail service based on Cloudflare Email Routing.</strong></p>

  <p>
    <a href="./README.md">简体中文</a> |
    English |
    <a href="https://sow.us.kg">Documentation</a>
  </p>

  <p>
    <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-16a34a"></a>
    <a href="https://github.com/keen2y/done-mail/fork"><img alt="Fork" src="https://img.shields.io/badge/deploy-Fork%20%2B%20Cloudflare-f38020"></a>
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178c6">
    <img alt="Vue" src="https://img.shields.io/badge/Vue-3-42b883">
  </p>

  <p>DoneMail is a high-performance, single-admin mail service running on Cloudflare Workers. It receives messages delivered by Cloudflare Email Routing and provides inbox browsing, search, automation rules (including forwarding), share links, and public APIs.</p>
</div>

---

## Why DoneMail

- **Centralized configuration**: connect Cloudflare, set Worker/entry URLs, and mail retention in **Config Center**; attach domains under Domain Management.
- **High-performance service**: full-text body search is backed by FTS, keeping search clear and responsive even over long messages.
- **Complete workflow**: fully covers receiving, searching, attachments, sharing, policy automation, and public APIs.
- **Multi-domain management**: connect Cloudflare root domains and subdomains, then inspect DNS, Email Routing, and Worker forwarding state.
- **Automation**: trigger forwarding, HTTP requests, and Telegram notifications from mail conditions to reduce repetitive manual work.
- **Long-term self-hosting**: single-admin model with low maintenance, without tenants, complex permissions, or enterprise-suite overhead.

## Quick Deploy

1. [**Fork**](https://github.com/keen2y/done-mail/fork) this repository  
2. In the [Cloudflare Dashboard](https://dash.cloudflare.com/): **Compute** → **Workers & Pages** → **Create** → **Continue with GitHub**, select **your fork**  
3. Build settings:

| Mode | Build command | Deploy command | Notes |
| --- | --- | --- | --- |
| Default (no R2) | `npm run build` | `npm run deploy` | Attachment metadata only (if the UI defaults to `npx wrangler deploy`, change it to this) |
| With R2 attachments | `npm run build` | `npm run deploy:r2` | Store and download attachment content |

See the [documentation](https://sow.us.kg/deploy/one-click) for details and updates.

### Updates

When a new upstream release is available: open your fork → Sync fork → Update branch → wait for Cloudflare to redeploy.

## Technical Architecture

- **Runtime platform**: [Cloudflare Workers](https://workers.cloudflare.com/)
- **Web framework**: [Hono](https://hono.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Frontend framework**: [Vue 3](https://vuejs.org/)
- **UI framework**: [Element Plus](https://element-plus.org/)
- **Data fetching**: [TanStack Query](https://tanstack.com/query)
- **Mail receiving**: [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/)
- **Mail parsing**: [postal-mime](https://github.com/postalsys/postal-mime)
- **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/)
- **Config cache**: [Cloudflare KV](https://developers.cloudflare.com/kv/)
- **Attachment storage**: [Cloudflare R2](https://developers.cloudflare.com/r2/) (optional)

## Contributing

Issues and PRs are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) first.

## Thanks

Thanks to the [linux.do](https://linux.do) community.

## License

[MIT](./LICENSE)
